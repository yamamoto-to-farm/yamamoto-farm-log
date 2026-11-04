"""Offline end-to-end LINE registration, authorization and delivery state tests."""

import base64
import copy
import hashlib
import hmac
import importlib.util
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


s3, ssm = MagicMock(), MagicMock()
root = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with patch.dict(sys.modules, {
    "boto3": types.SimpleNamespace(client=lambda service: s3 if service == "s3" else ssm),
    "botocore": types.ModuleType("botocore"),
    "botocore.exceptions": types.SimpleNamespace(ClientError=ClientError),
}):
    core = load("work_plans", root / "shift-api" / "lambda_function.py")
    webhook = load("line_webhook", root / "line-test" / "lambda_function.py")
    with patch.dict(sys.modules, {"work_plans": core, "line_webhook": webhook}):
        api = load("line_api", Path(__file__).with_name("lambda_function.py"))


DATE = "2026-11-05"
UID = "U" + "1" * 32
OTHER = "U" + "2" * 32
NAMES = ["Part A", "Part B"]


def plan():
    return {
        "id": "p1", "source": "direct", "names": NAMES, "recipients": NAMES,
        "kind": "2", "reporter": "Part A", "off": False, "off_reason": "",
        "memo": "", "manual_text": False, "message": "",
        "attendance": {name: [{"start": "08:00", "end": "12:00"}] for name in NAMES},
        "blocks": [{"task": "Work", "start": "08:00", "end": "12:00", "fields": ["Field"],
                    "field": "Field", "shed": False,
                    "participation": {name: [{"start": "08:00", "end": "12:00"}] for name in NAMES}}],
        "updated_at": "2026-11-04T09:00:00+00:00", "updated_by": "admin",
    }


class LineApiTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"SHIFT_BUCKET": "private", "WORKERS_BUCKET": "public"})
        self.env.start()
        self.addCleanup(self.env.stop)
        s3.reset_mock(return_value=True, side_effect=True)
        ssm.reset_mock(return_value=True, side_effect=True)
        self.objects, self.versions = {}, {}

        def get(Bucket, Key):
            target = (Bucket, Key)
            if target not in self.objects:
                raise ClientError("NoSuchKey")
            return {"Body": io.BytesIO(self.objects[target]), "ETag": self.versions[target]}

        def put(Bucket, Key, Body, **kwargs):
            target = (Bucket, Key)
            if kwargs.get("IfNoneMatch") == "*" and target in self.objects:
                raise ClientError("PreconditionFailed")
            if "IfMatch" in kwargs and kwargs["IfMatch"] != self.versions.get(target):
                raise ClientError("PreconditionFailed")
            self.objects[target] = Body
            self.versions[target] = '"' + hashlib.md5(Body).hexdigest() + '"'
            return {"ETag": self.versions[target]}

        s3.get_object.side_effect, s3.put_object.side_effect = get, put
        ssm.get_parameter.return_value = {"Parameter": {"Value": "secret"}}
        self.store("public", "data/workers.json", [
            {"name": "a", "display": NAMES[0], "role": "worker"},
            {"name": "b", "display": NAMES[1], "role": "worker"},
            {"name": "family", "display": "Family", "role": "family"},
        ])
        self.current = plan()
        self.save_plans()
        self.claims = {
            "token_use": "access", "client_id": core.CLIENT_ID, "iss": core.ISSUER,
            "scope": "openid", "sub": "admin", "cognito:groups": "[admin]",
        }
        self.network = patch.object(api, "line_request", return_value={})
        self.line = self.network.start()
        self.addCleanup(self.network.stop)
        self.service = api.Service()

    def store(self, bucket, key, value):
        raw = json.dumps(value).encode()
        self.objects[bucket, key] = raw
        self.versions[bucket, key] = '"' + hashlib.md5(raw).hexdigest() + '"'

    def get(self, bucket, key):
        return json.loads(self.objects[bucket, key])

    def save_plans(self):
        plans = {"p1": copy.deepcopy(self.current)}
        self.store("private", f"shift/work-plans/{DATE}.json", {
            "date": DATE, "plans": plans, "people": core.project_work_plans(plans),
            "communications": [], "updated_at": self.current["updated_at"],
        })

    def call(self, action=None, body=None, claims=None):
        event = {
            "routeKey": ("POST" if action else "GET") + " /line/manage",
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
            "queryStringParameters": {"date": DATE},
            "body": json.dumps({**(body or {}), "action": action}),
        }
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def signed(self, text, uid=UID, source_type="user", event_type="message"):
        raw = json.dumps({"events": [{
            "type": event_type, "source": {"type": source_type, "userId": uid},
            "message": {"type": "text", "text": text},
        }]}).encode()
        return {
            "version": "2.0", "routeKey": "POST /line/webhook", "rawPath": "/line/webhook",
            "requestContext": {"http": {"method": "POST"}},
            "headers": {"x-line-signature": base64.b64encode(
                hmac.new(b"secret", raw, hashlib.sha256).digest()).decode()},
            "body": raw.decode(),
        }

    def receive(self, text, **kwargs):
        result = api.lambda_handler(self.signed(text, **kwargs), None)
        return result["statusCode"], json.loads(result["body"])

    def approve(self, worker="a", uid=UID):
        status, issued = self.call("issue", {"worker": worker})
        self.assertEqual(status, 200)
        self.line.return_value = {"displayName": "LINE Person"}
        self.assertEqual(self.receive(issued["registration_message"], uid=uid)[0], 200)
        state = self.call()[1]
        member = next(member for member in state["members"] if member["worker"] == worker)
        self.assertFalse(member["linked"])
        self.assertEqual(self.call("approve", {
            "worker": worker, "pending_id": member["pending"]["id"],
        })[0], 200)
        self.line.return_value = {}

    def prepare(self):
        status, job = self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Test message",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })
        self.assertEqual(status, 200, job)
        return job

    def ready(self):
        self.approve("a", UID)
        self.approve("b", OTHER)
        self.line.reset_mock()
        return self.prepare()

    def send(self, job, name=NAMES[0]):
        return self.call("send", {"date": DATE, "job_id": job["id"], "name": name})

    def test_auth_is_checked_and_worker_is_rejected(self):
        for claims, expected in (({}, 401), ({**self.claims, "token_use": "id"}, 401),
                                 ({**self.claims, "cognito:groups": "[worker]"}, 403)):
            self.assertEqual(self.call("issue", {"worker": "a"}, claims)[0], expected)
        self.assertNotIn(("private", "shift/line/links.json"), self.objects)
        self.assertEqual(self.call(claims={**self.claims, "cognito:groups": "[family]"})[0], 200)

    def test_webhook_signature_and_ordinary_messages(self):
        event = self.signed("hello")
        event["body"] = "tampered"
        self.assertEqual(api.lambda_handler(event, None)["statusCode"], 401)
        self.assertEqual(self.receive("hello")[0], 200)
        self.assertNotIn(("private", "shift/line/links.json"), self.objects)
        self.line.assert_not_called()

    def test_registration_needs_approval_and_public_state_hides_ids_and_hash(self):
        self.approve()
        status, state = self.call()
        self.assertEqual(status, 200)
        raw = json.dumps(state)
        self.assertNotIn(UID, raw)
        self.assertNotIn("code_hash", raw)
        self.assertTrue(state["members"][0]["linked"])
        self.assertEqual(self.call("issue", {"worker": "a"})[0], 409)

    def test_wrong_code_expiry_group_and_duplicate_identity(self):
        self.assertEqual(self.receive("LINK wrong")[0], 403)
        _, issued = self.call("issue", {"worker": "a"})
        self.assertEqual(self.receive(issued["registration_message"], source_type="group")[0], 400)
        with patch.object(api.time, "time", return_value=time_far_future()):
            self.assertEqual(self.receive(issued["registration_message"])[0], 409)
        self.approve()
        _, second = self.call("issue", {"worker": "b"})
        self.assertEqual(self.receive(second["registration_message"])[0], 409)
        self.assertEqual(self.call("approve", {"worker": "b", "pending_id": "wrong"})[0], 409)

    def test_reissue_invalidates_old_code_and_rejects_pending_replacement(self):
        _, first = self.call("issue", {"worker": "a"})
        _, second = self.call("issue", {"worker": "a"})
        self.assertEqual(self.receive(first["registration_message"])[0], 403)
        self.line.return_value = {"displayName": "Person"}
        self.assertEqual(self.receive(second["registration_message"])[0], 200)
        self.assertEqual(self.receive(second["registration_message"])[0], 200)
        self.assertEqual(self.receive(second["registration_message"], uid=OTHER)[0], 409)

    def test_cannot_send_unapproved_or_unregistered(self):
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Text",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 409)
        self.line.assert_not_called()

    def test_prepare_is_idempotent_and_requires_complete_current_plans(self):
        job = self.ready()
        self.assertEqual(self.prepare()["id"], job["id"])
        self.current["updated_at"] = "2026-11-04T10:00:00+00:00"
        self.save_plans()
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Text",
            "targets": [{"id": "p1", "plan_revision": "2026-11-04T09:00:00+00:00"}],
        })[0], 409)

    def test_per_person_results_only_record_sent_history_after_all_accepted(self):
        job = self.ready()
        status, first = self.send(job)
        self.assertEqual(status, 200, first)
        self.assertEqual(first["results"][NAMES[0]]["status"], "accepted")
        self.assertEqual(first["results"][NAMES[1]]["status"], "ready")
        self.assertFalse(first["recorded"])
        status, final = self.send(job, NAMES[1])
        self.assertEqual(status, 200, final)
        self.assertTrue(final["recorded"])
        saved = self.get("private", f"shift/work-plans/{DATE}.json")
        self.assertEqual(len(saved["communications"]), 1)
        self.assertEqual(saved["communications"][0]["status"], "sent")
        self.assertEqual(saved["communications"][0]["recipients"], NAMES)
        self.assertEqual(self.line.call_count, 2)
        self.send(job)
        self.assertEqual(self.line.call_count, 2)

    def test_partial_failure_retry_skips_accepted_people_and_reuses_key(self):
        job = self.ready()
        self.send(job)
        self.line.side_effect = HTTPError("url", 429, "quota", {}, io.BytesIO())
        status, failed = self.send(job, NAMES[1])
        self.assertEqual(status, 200)
        self.assertEqual(failed["results"][NAMES[1]]["status"], "failed")
        retry = self.line.call_args.args[2]
        self.line.side_effect = None
        self.send(job)
        status, final = self.send(job, NAMES[1])
        self.assertEqual(status, 200, final)
        self.assertTrue(final["recorded"])
        self.assertEqual(self.line.call_args.args[2], retry)

    def test_timeout_remains_unknown_and_cannot_be_closed(self):
        job = self.ready()
        self.line.side_effect = URLError("timeout")
        _, result = self.send(job)
        self.assertEqual(result["results"][NAMES[0]]["status"], "unknown")
        retry = self.line.call_args.args[2]
        self.assertEqual(self.call("close", {"date": DATE, "job_id": job["id"], "confirm": True})[0], 409)
        self.current["updated_at"] = "2026-11-04T10:00:00+00:00"
        self.save_plans()
        self.line.side_effect = HTTPError("url", 409, "accepted",
                                         {"x-line-accepted-request-id": "old"}, io.BytesIO())
        _, result = self.send(job)
        self.assertEqual(result["results"][NAMES[0]]["status"], "accepted")
        self.assertEqual(self.line.call_args.args[2], retry)
        self.assertEqual(self.send(job, NAMES[1])[0], 409)

    def test_retry_expiry_never_sends_with_new_key(self):
        job = self.ready()
        self.line.side_effect = TimeoutError()
        self.send(job)
        self.line.reset_mock()
        with patch.object(api.time, "time", return_value=time_far_future()):
            self.assertEqual(self.send(job)[0], 409)
        self.line.assert_not_called()

    def test_unlink_block_and_plan_changes_stop_unsent_messages(self):
        job = self.ready()
        self.assertEqual(self.call("unlink", {"worker": "a", "confirm": True})[0], 200)
        self.assertEqual(self.send(job)[0], 409)
        self.line.assert_not_called()

    def test_unfollow_disables_approved_recipient(self):
        job = self.ready()
        self.assertEqual(self.receive("", event_type="unfollow")[0], 200)
        self.assertTrue(self.call()[1]["members"][0]["blocked"])
        self.assertEqual(self.send(job)[0], 409)

    def test_cas_conflict_before_send_never_calls_line(self):
        job = self.ready()
        s3.put_object.side_effect = ClientError("PreconditionFailed")
        self.assertEqual(self.send(job)[0], 409)
        self.line.assert_not_called()

    def test_missing_ssm_or_s3_permissions_return_error_not_success(self):
        s3.get_object.side_effect = ClientError("AccessDenied")
        self.assertEqual(self.call()[0], 500)

    def test_lost_result_write_can_be_recovered_without_changing_retry_key(self):
        job = self.ready()
        original_put = s3.put_object.side_effect
        count = 0

        def fail_result(**kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise ClientError("AccessDenied")
            return original_put(**kwargs)

        s3.put_object.side_effect = fail_result
        self.assertEqual(self.send(job)[0], 500)
        retry = self.line.call_args.args[2]
        s3.put_object.side_effect = original_put
        self.line.side_effect = HTTPError("url", 409, "accepted",
                                         {"x-line-accepted-request-id": "old"}, io.BytesIO())
        _, recovered = self.send(job)
        self.assertEqual(recovered["results"][NAMES[0]]["status"], "accepted")
        self.assertEqual(self.line.call_args.args[2], retry)

    def test_history_recovery_does_not_send_again(self):
        job = self.ready()
        self.send(job)
        with patch.object(api.Service, "record_history", side_effect=core.RequestError(409, "conflict")):
            self.assertEqual(self.send(job, NAMES[1])[0], 409)
        calls = self.line.call_count
        status, recovered = self.send(job)
        self.assertEqual(status, 200, recovered)
        self.assertTrue(recovered["recorded"])
        self.assertEqual(self.line.call_count, calls)

    def test_changed_text_cannot_replace_outstanding_job(self):
        self.ready()
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Different text",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 409)

    def test_5000_utf16_limit_and_worker_master_does_not_allow_family(self):
        self.ready()
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "\U0001f600" * 2501,
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 400)
        self.assertEqual(self.call("issue", {"worker": "family"})[0], 400)

    def test_exact_5000_utf16_units_are_accepted(self):
        self.approve("a", UID)
        self.approve("b", OTHER)
        status, job = self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "\U0001f600" * 2500,
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })
        self.assertEqual(status, 200, job)

    def test_existing_job_blocks_changed_recipient_subset(self):
        self.ready()
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": [NAMES[0]], "message": "Test message",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 409)

    def test_additional_plan_and_different_participation_are_rejected(self):
        self.approve("a", UID)
        self.approve("b", OTHER)
        self.current["blocks"][0]["participation"][NAMES[1]] = [{"start": "09:00", "end": "12:00"}]
        self.save_plans()
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Test",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 400)
        self.current = plan()
        self.save_plans()
        data = self.get("private", f"shift/work-plans/{DATE}.json")
        extra = copy.deepcopy(self.current)
        extra["id"] = "p2"
        data["plans"]["p2"] = extra
        data["people"] = core.project_work_plans(data["plans"])
        self.store("private", f"shift/work-plans/{DATE}.json", data)
        self.assertEqual(self.call("prepare", {
            "date": DATE, "names": NAMES, "message": "Test",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        })[0], 409)

    def test_new_delivery_requires_confirmation_after_completed_or_closed_job(self):
        job = self.ready()
        self.send(job)
        self.send(job, NAMES[1])
        request = {
            "date": DATE, "names": NAMES, "message": "New message",
            "targets": [{"id": "p1", "plan_revision": self.current["updated_at"]}],
        }
        self.assertEqual(self.call("prepare", request)[0], 409)
        self.assertEqual(self.call("prepare", {**request, "confirm_resend": True})[0], 200)

    def test_newer_plan_and_copy_history_survive_sent_snapshot_append(self):
        job = self.ready()
        self.send(job)
        self.send(job, NAMES[1])
        data = self.get("private", f"shift/work-plans/{DATE}.json")
        self.assertEqual(core.normalize_work_plans(data, DATE)["communications"][0]["message"], "Test message")
        data["communications"][0]["status"] = "copied"
        data["communications"][0]["id"] = "e37b179d-ddc9-4eba-bb47-4844e62bd506"
        data["plans"]["p1"]["updated_at"] = "2026-11-04T11:00:00+00:00"
        data["plans"]["p1"]["memo"] = "new plan"
        core.apply_communication_metadata(data["plans"], data["communications"])
        data["people"] = core.project_work_plans(data["plans"])
        self.store("private", f"shift/work-plans/{DATE}.json", data)
        private_job = self.get("private", f"shift/line/deliveries/{DATE}.json")["jobs"][job["id"]]
        self.service.record_history(private_job)
        final = self.get("private", f"shift/work-plans/{DATE}.json")
        self.assertEqual(final["plans"]["p1"]["memo"], "new plan")
        self.assertEqual(len(final["communications"]), 2)
        self.assertTrue(final["plans"]["p1"]["communication_changed"])

    def test_http_action_cannot_bypass_jwt_with_direct_lambda_event(self):
        self.assertEqual(api.lambda_handler({"action": "issue", "worker": "a"}, None)["statusCode"], 401)


def time_far_future():
    return 9999999999


if __name__ == "__main__":
    unittest.main()
