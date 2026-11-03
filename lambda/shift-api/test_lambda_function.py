"""shift-api Lambda のテスト（AWS・ネットワークに接続しないインメモリモック）.

実行: python -B -m unittest discover -s lambda\\shift-api -p "test_*.py"
"""
import importlib.util
import base64
import copy
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


fake_s3 = MagicMock()
with patch.dict(sys.modules, {
    "boto3": types.SimpleNamespace(client=lambda service, **kwargs: fake_s3),
    "botocore": types.ModuleType("botocore"),
    "botocore.exceptions": types.SimpleNamespace(ClientError=FakeClientError),
}):
    spec = importlib.util.spec_from_file_location("shift_api", Path(__file__).with_name("lambda_function.py"))
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)


def s3_body(raw):
    stream = io.BytesIO(raw.encode("utf-8"))
    stream.__enter__ = lambda *a: stream
    stream.__exit__ = lambda *a: None
    return {"Body": stream}


class ShiftApiTests(unittest.TestCase):
    def setUp(self):
        fake_s3.reset_mock(return_value=True, side_effect=True)
        self.env = patch.dict(os.environ, {"SHIFT_BUCKET": "private-shift-test", "SHIFT_PREFIX": "shift/"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.claims = {
            "token_use": "access", "client_id": api.CLIENT_ID, "iss": api.ISSUER,
            "scope": "email openid", "sub": "user-1", "cognito:groups": "[admin]",
        }

    def call(self, route, query=None, claims=None):
        event = {
            "routeKey": route,
            "queryStringParameters": query,
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
        }
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def test_invalid_claims_are_rejected_without_s3(self):
        variants = [{}, {**self.claims, "token_use": "id"},
                    {**self.claims, "client_id": "other"},
                    {**self.claims, "iss": "other"}, {**self.claims, "scope": "email"}]
        for claims in variants:
            with self.subTest(claims=claims):
                self.assertEqual(self.call("GET /shift/plan", claims=claims)[0], 401)
        fake_s3.get_object.assert_not_called()

    def test_worker_group_is_forbidden(self):
        for groups in ("", "[worker]", "[other worker]"):
            with self.subTest(groups=groups):
                status, body = self.call("GET /shift/plan", claims={**self.claims, "cognito:groups": groups})
                self.assertEqual(status, 403)
        fake_s3.get_object.assert_not_called()

    def test_family_group_is_allowed(self):
        fake_s3.get_object.return_value = s3_body('{"month": "2026-11"}')
        status, body = self.call("GET /shift/plan", claims={**self.claims, "cognito:groups": "[family]"})
        self.assertEqual(status, 200)
        self.assertEqual(body["month"], "2026-11")

    def test_plan_without_month_reads_latest(self):
        fake_s3.get_object.return_value = s3_body('{"month": "2026-11"}')
        status, body = self.call("GET /shift/plan")
        self.assertEqual(status, 200)
        fake_s3.get_object.assert_called_once_with(Bucket="private-shift-test", Key="shift/latest.json")

    def test_plan_with_month_reads_month_key(self):
        fake_s3.get_object.return_value = s3_body('{"month": "2026-10"}')
        status, body = self.call("GET /shift/plan", {"month": "2026-10"})
        self.assertEqual(status, 200)
        fake_s3.get_object.assert_called_once_with(Bucket="private-shift-test", Key="shift/2026-10/plan.json")

    def test_bad_month_is_rejected(self):
        for month in ("2026-13", "202611", "2026-1", "../x"):
            with self.subTest(month=month):
                self.assertEqual(self.call("GET /shift/plan", {"month": month})[0], 400)
        fake_s3.get_object.assert_not_called()

    def test_missing_plan_returns_404(self):
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        status, body = self.call("GET /shift/plan")
        self.assertEqual(status, 404)

    def test_plan_run_list_returns_snapshots(self):
        fake_s3.list_objects_v2.return_value = {
            "CommonPrefixes": [{"Prefix": "shift/2026-11/runs/20261026-070102/"},
                               {"Prefix": "shift/2026-11/runs/20261030-231501/"},
                               {"Prefix": "shift/2026-11/runs/broken/"}],
        }
        status, body = self.call("GET /shift/plan", {"month": "2026-11", "run": "list"})
        self.assertEqual(status, 200)
        self.assertEqual(body["runs"], ["20261030-231501", "20261026-070102"])

    def test_plan_run_reads_snapshot_key(self):
        fake_s3.get_object.return_value = s3_body('{"month": "2026-11"}')
        status, body = self.call("GET /shift/plan", {"month": "2026-11", "run": "20261026-070102"})
        self.assertEqual(status, 200)
        fake_s3.get_object.assert_called_once_with(
            Bucket="private-shift-test", Key="shift/2026-11/runs/20261026-070102/plan.json")

    def test_plan_run_requires_month_and_format(self):
        self.assertEqual(self.call("GET /shift/plan", {"run": "20261026-070102"})[0], 400)
        self.assertEqual(self.call("GET /shift/plan", {"month": "2026-11", "run": "../x"})[0], 400)
        fake_s3.get_object.assert_not_called()

    def test_months_lists_month_prefixes_only(self):
        fake_s3.list_objects_v2.return_value = {
            "CommonPrefixes": [{"Prefix": "shift/2026-11/"}, {"Prefix": "shift/2026-12/"},
                               {"Prefix": "shift/ics/"}],
        }
        status, body = self.call("GET /shift/months")
        self.assertEqual(status, 200)
        self.assertEqual(body["months"], ["2026-12", "2026-11"])


VALID_CONFIG = {
    "base_hourly": 1250, "hours_per_day_target": 6.5,
    "target_person_days": {"min": 44, "center": 45, "max": 46},
    "labor_budget_yen": {"min": 360000, "max": 380000},
    "commute": {"per_day": 160, "monthly_cap": 3000},
    "min_work_hours": 3.5, "max_work_hours": 6.5, "peak_max_work_hours": 9,
    "flex_all_day_assumed_hours": 6.5,
    "am_default": {"start": "06:00", "end": "12:00"},
    "pm_default": {"start": "13:00", "end": "17:10"},
    "allday_default": {"start": "06:00", "end": "17:10"},
    "break_minutes": {"not_spanning_noon": 10, "spanning_noon": 60},
    "weekly_max_days": 5, "consecutive_max_days": 5,
    "timetree_calendar_code": "CODE",
    "staff": [{"name": "土井", "match": ["土井"], "fixed_weekdays": ["日", "月"],
               "target_days": 12, "hourly": 1310, "latest_end": {"日": "15:00"},
               "unavailable_days_of_month": []}],
}


class ShiftConfigTests(unittest.TestCase):
    def setUp(self):
        fake_s3.reset_mock(return_value=True, side_effect=True)
        self.env = patch.dict(os.environ, {"SHIFT_BUCKET": "private-shift-test", "SHIFT_PREFIX": "shift/"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.claims = {
            "token_use": "access", "client_id": api.CLIENT_ID, "iss": api.ISSUER,
            "scope": "email openid", "sub": "user-1", "cognito:groups": "[admin]",
        }

    def post(self, body, claims=None):
        event = {
            "routeKey": "POST /shift/config", "body": json.dumps(body, ensure_ascii=False),
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
        }
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def test_get_config_reads_s3(self):
        fake_s3.get_object.return_value = s3_body(json.dumps(VALID_CONFIG, ensure_ascii=False))
        event = {"routeKey": "GET /shift/config",
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
        result = api.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 200)
        fake_s3.get_object.assert_called_once_with(Bucket="private-shift-test", Key="shift/config.json")

    def test_post_valid_config_backs_up_and_saves(self):
        fake_s3.get_object.return_value = s3_body('{"old": true}')
        status, body = self.post(VALID_CONFIG)
        self.assertEqual(status, 200)
        self.assertTrue(body["saved"])
        keys = [call.kwargs["Key"] for call in fake_s3.put_object.call_args_list]
        self.assertEqual(len(keys), 2)
        self.assertTrue(keys[0].startswith("shift/config-backups/config-"))
        self.assertEqual(keys[1], "shift/config.json")

    def test_post_strips_credentials(self):
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        cfg = {**VALID_CONFIG, "timetree_email": "a@example.com", "timetree_password": "secret"}
        status, _ = self.post(cfg)
        self.assertEqual(status, 200)
        saved = json.loads(fake_s3.put_object.call_args_list[-1].kwargs["Body"].decode("utf-8"))
        self.assertNotIn("timetree_email", saved)
        self.assertNotIn("timetree_password", saved)

    def test_post_rejects_bad_configs(self):
        bad = [
            {**VALID_CONFIG, "staff": []},
            {**VALID_CONFIG, "staff": [{**VALID_CONFIG["staff"][0], "hourly": 0}]},
            {**VALID_CONFIG, "staff": [{**VALID_CONFIG["staff"][0], "fixed_weekdays": ["曜"]}]},
            {**VALID_CONFIG, "staff": [{**VALID_CONFIG["staff"][0], "latest_end": {"日": "25時"}}]},
            {**VALID_CONFIG, "staff": [{**VALID_CONFIG["staff"][0], "login": 123}]},
            {**VALID_CONFIG, "labor_budget_yen": {"min": 400000, "max": 380000}},
            {**VALID_CONFIG, "min_work_hours": 7},
            {**VALID_CONFIG, "weekly_max_days": 8},
        ]
        for cfg in bad:
            with self.subTest(cfg=cfg):
                self.assertEqual(self.post(cfg)[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_post_keeps_login_link(self):
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        cfg = {**VALID_CONFIG, "staff": [{**VALID_CONFIG["staff"][0], "login": " doi "}]}
        status, _ = self.post(cfg)
        self.assertEqual(status, 200)
        saved = json.loads(fake_s3.put_object.call_args_list[-1].kwargs["Body"].decode("utf-8"))
        self.assertEqual(saved["staff"][0]["login"], "doi")

    def test_post_requires_admin_or_family(self):
        status, _ = self.post(VALID_CONFIG, claims={**self.claims, "cognito:groups": "[worker]"})
        self.assertEqual(status, 403)
        fake_s3.put_object.assert_not_called()

    def test_regenerate_invokes_plan_function(self):
        with patch.dict(os.environ, {"PLAN_FUNCTION": "yamamoto-farm-shift-plan"}):
            event = {"routeKey": "POST /shift/regenerate", "body": json.dumps({"month": "2026-11"}),
                     "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
            result = api.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 202)
        kwargs = fake_s3.invoke.call_args.kwargs
        self.assertEqual(kwargs["FunctionName"], "yamamoto-farm-shift-plan")
        self.assertEqual(kwargs["InvocationType"], "Event")
        self.assertEqual(json.loads(kwargs["Payload"].decode("utf-8")), {"month": "2026-11"})

    def test_regenerate_without_function_fails(self):
        event = {"routeKey": "POST /shift/regenerate", "body": "{}",
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
        result = api.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 500)
        fake_s3.invoke.assert_not_called()

    def test_edits_roundtrip(self):
        # 保存
        event = {"routeKey": "POST /shift/edits",
                 "body": json.dumps({"month": "2026-11", "data": {"overrides": {"2026-11-01:土井": {"status": "skip"}}}}),
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
        result = api.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 200)
        kwargs = fake_s3.put_object.call_args.kwargs
        self.assertEqual(kwargs["Key"], "shift/2026-11/edits.json")
        saved = json.loads(kwargs["Body"].decode("utf-8"))
        self.assertEqual(saved["data"]["overrides"]["2026-11-01:土井"]["status"], "skip")
        self.assertIn("updated_at", saved)
        # 取得
        fake_s3.get_object.return_value = s3_body(kwargs["Body"].decode("utf-8"))
        event = {"routeKey": "GET /shift/edits", "queryStringParameters": {"month": "2026-11"},
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
        result = api.lambda_handler(event, None)
        self.assertEqual(result["statusCode"], 200)
        fake_s3.get_object.assert_called_with(Bucket="private-shift-test", Key="shift/2026-11/edits.json")

    def test_edits_validation(self):
        for body in ({"month": "bad", "data": {}}, {"month": "2026-11", "data": "x"}, {"data": {}}):
            with self.subTest(body=body):
                event = {"routeKey": "POST /shift/edits", "body": json.dumps(body),
                         "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}}}
                self.assertEqual(api.lambda_handler(event, None)["statusCode"], 400)
        fake_s3.put_object.assert_not_called()


class WorkPlanTests(unittest.TestCase):
    def setUp(self):
        ShiftApiTests.setUp(self)
        self.plan = {
            "names": ["担当A", "担当B"], "off": False, "off_reason": "",
            "kind": "2", "reporter": "担当A", "memo": "テスト",
            "manual_text": True, "message": "編集した文面",
            "blocks": [{"start": "08:00", "end": "12:00", "field": "テスト圃場",
                        "task": "播種", "shed": False}],
        }
        self.revision = '"' + "a" * 32 + '"'
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")

    def request(self, route="POST /shift/work-plans", body=None, claims=None, raw_body=None, encoded=False):
        event = {
            "routeKey": route, "queryStringParameters": {"date": "2026-11-02"},
            "body": raw_body if raw_body is not None else json.dumps(body if body is not None else {
                "date": "2026-11-02", "revision": None, "plan": self.plan,
            }, ensure_ascii=False),
            "isBase64Encoded": encoded,
            "requestContext": {"authorizer": {"jwt": {"claims": claims or self.claims}}},
        }
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def existing(self, people=None, date="2026-11-02"):
        fake_s3.get_object.side_effect = None
        fake_s3.get_object.return_value = {
            **s3_body(json.dumps({"date": date, "people": people or {}})),
            "ETag": self.revision,
        }

    def stored(self, record):
        raw = json.dumps(record)
        fake_s3.get_object.side_effect = lambda **kwargs: {**s3_body(raw), "ETag": self.revision}

    def saved(self):
        return json.loads(fake_s3.put_object.call_args.kwargs["Body"])

    def save_next(self, plan, **kwargs):
        self.stored(self.saved())
        return self.request(body={
            "date": "2026-11-02", "revision": self.revision, "plan": plan, **kwargs,
        })

    def direct(self, names=None):
        return {"source": "direct", "names": names or ["担当A"], "blocks": [{"task": "耕耘"}]}

    def legacy_people(self, plan):
        return {name: {**copy.deepcopy(plan), "worker": name} for name in plan["names"]}

    def test_missing_day_returns_empty_without_writing(self):
        status, body = self.request("GET /shift/work-plans")
        self.assertEqual(status, 200)
        self.assertIsNone(body["revision"])
        self.assertEqual(body["data"]["people"], {})
        fake_s3.put_object.assert_not_called()

    def test_new_plan_saves_group_per_person_with_conditional_creation(self):
        self.plan["message"] = "\n編集した文面\n"
        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertTrue(body["saved"])
        kwargs = fake_s3.put_object.call_args.kwargs
        self.assertEqual(kwargs["Key"], "shift/work-plans/2026-11-02.json")
        self.assertEqual(kwargs["IfNoneMatch"], "*")
        saved = json.loads(kwargs["Body"])
        self.assertEqual(set(saved["people"]), {"担当A", "担当B"})
        self.assertEqual(saved["people"]["担当A"]["message"], "\n編集した文面\n")
        self.assertTrue(saved["people"]["担当B"]["manual_text"])
        self.assertEqual(saved["people"]["担当B"]["blocks"], self.plan["blocks"])

    def test_recopy_replaces_named_people_only_and_read_returns_revision(self):
        other = {**self.plan, "names": ["別担当"], "kind": "1", "reporter": "", "message": "残す"}
        legacy = {**self.legacy_people(self.plan), **self.legacy_people(other)}
        self.existing(legacy)
        status, body = self.request("GET /shift/work-plans")
        self.assertEqual(status, 200)
        self.assertEqual(body["revision"], self.revision)
        self.existing(legacy)
        self.plan["message"] = "新しい文面"
        status, _ = self.request(body={"date": "2026-11-02", "revision": self.revision, "plan": self.plan})
        self.assertEqual(status, 200)
        kwargs = fake_s3.put_object.call_args.kwargs
        self.assertEqual(kwargs["IfMatch"], self.revision)
        people = json.loads(kwargs["Body"])["people"]
        self.assertEqual(len(people), 3)
        self.assertEqual(people["担当A"]["message"], "新しい文面")
        self.assertEqual(people["別担当"]["message"], "残す")

    def test_old_revision_and_creation_race_return_conflict(self):
        self.existing()
        self.assertEqual(self.request()[0], 409)
        fake_s3.put_object.assert_not_called()
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        for code in ("PreconditionFailed", "ConditionalRequestConflict"):
            fake_s3.put_object.side_effect = FakeClientError(code)
            self.assertEqual(self.request()[0], 409)

    def test_cancellation_replaces_work_without_retaining_active_blocks(self):
        self.plan.update(off=True, blocks=[], off_reason="雨天")
        self.assertEqual(self.request()[0], 200)
        saved = json.loads(fake_s3.put_object.call_args.kwargs["Body"])
        self.assertTrue(saved["people"]["担当A"]["off"])
        self.assertEqual(saved["people"]["担当A"]["blocks"], [])

    def test_invalid_input_never_writes(self):
        import copy
        variants = [
            {"date": "2026-02-30", "revision": None, "plan": self.plan},
            {"date": "../x", "revision": None, "plan": self.plan},
            {"date": "2026-11-02", "plan": self.plan},
        ]
        for change in ({"names": []}, {"names": ["担当A", "担当A"]},
                       {"blocks": []}, {"off": "false"}, {"kind": "4"},
                       {"reporter": "不明"}, {"message": ""}, {"memo": "x" * 2001}, {"off": True}):
            variants.append({"date": "2026-11-02", "revision": None, "plan": {**self.plan, **change}})
        for change in ({"start": "25:00"}, {"end": "08:00"}, {"task": ""}, {"shed": "false"}):
            plan = copy.deepcopy(self.plan)
            plan["blocks"][0].update(change)
            variants.append({"date": "2026-11-02", "revision": None, "plan": plan})
        for body in variants:
            with self.subTest(body=body):
                self.assertEqual(self.request(body=body)[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_bad_json_and_oversize_fail_explicitly(self):
        for raw in ("{", "[]", "x" * 65537):
            self.assertEqual(self.request(raw_body=raw)[0], 400)

    def test_access_denied_and_corrupt_storage_are_not_empty_success(self):
        fake_s3.get_object.side_effect = FakeClientError("AccessDenied")
        with self.assertLogs(api.LOGGER, level="ERROR"):
            self.assertEqual(self.request("GET /shift/work-plans")[0], 500)
        self.existing(date="2026-11-03")
        with self.assertLogs(api.LOGGER, level="ERROR"):
            self.assertEqual(self.request()[0], 500)
        fake_s3.put_object.assert_not_called()

    def test_new_routes_require_privileged_cognito_session(self):
        for route in ("GET /shift/work-plans", "POST /shift/work-plans"):
            self.assertEqual(self.request(route, claims={**self.claims, "token_use": "id"})[0], 401)
            self.assertEqual(self.request(route, claims={**self.claims, "cognito:groups": "[worker]"})[0], 403)
        fake_s3.get_object.assert_not_called()
        fake_s3.put_object.assert_not_called()

    def test_group_migration_is_deterministic_without_duplicate_entries_or_writes(self):
        self.existing(self.legacy_people(self.plan))
        status, body = self.request("GET /shift/work-plans")
        self.assertEqual(status, 200)
        identifier = api.message_plan_id(self.plan["names"])
        self.assertEqual(list(body["data"]["plans"]), [identifier])
        self.assertEqual(len(body["data"]["people"]["担当A"]["entries"]), 1)
        self.assertEqual(len(body["data"]["people"]["担当B"]["blocks"]), 1)
        fake_s3.put_object.assert_not_called()
        self.existing(dict(reversed(list(self.legacy_people(self.plan).items()))))
        self.assertEqual(self.request("GET /shift/work-plans")[1]["data"], body["data"])
        self.existing(self.legacy_people(self.plan))
        self.assertEqual(self.request(body={
            "date": "2026-11-02", "revision": self.revision, "plan": self.direct(),
        })[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 2)

    def test_partial_legacy_group_does_not_resurrect_overwritten_recipients(self):
        replacement = {**self.plan, "names": ["担当A"], "kind": "1", "reporter": "", "message": "新"}
        legacy = self.legacy_people(self.plan)
        legacy["担当A"] = self.legacy_people(replacement)["担当A"]
        self.existing(legacy)
        status, body = self.request("GET /shift/work-plans")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["data"]["people"]["担当A"]["entries"]), 1)
        self.assertEqual(body["data"]["people"]["担当B"]["names"], ["担当B"])
        self.assertEqual(body["data"]["people"]["担当B"]["reporter"], "担当B")

    def test_sources_do_not_overwrite_and_multiple_direct_entries_survive(self):
        status, first = self.request(body={"date": "2026-11-02", "revision": None, "plan": self.direct()})
        self.assertEqual(status, 200)
        status, second = self.save_next(self.direct())
        self.assertEqual(status, 200)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(self.save_next(self.plan)[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 3)
        self.assertEqual(len(self.saved()["people"]["担当A"]["entries"]), 3)
        self.assertEqual(self.save_next({**self.plan, "message": "再コピー"})[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 3)
        self.assertEqual(self.save_next(self.direct(["担当B"]))[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 4)

    def test_direct_defaults_and_message_field_arrays(self):
        self.assertEqual(self.request(body={
            "date": "2026-11-02", "revision": None, "plan": self.direct(),
        })[0], 200)
        direct = next(iter(self.saved()["plans"].values()))
        for key, expected in (("source", "direct"), ("message", ""), ("manual_text", False),
                              ("kind", "1"), ("reporter", ""), ("off", False)):
            self.assertEqual(direct[key], expected)
        self.assertEqual(direct["blocks"][0]["start"], "")
        self.assertEqual(direct["blocks"][0]["end"], "")
        self.plan["blocks"][0].pop("field")
        self.plan["blocks"][0]["fields"] = ["第一圃場", "第二圃場"]
        self.assertEqual(self.save_next(self.plan)[0], 200)
        entry = self.saved()["people"]["担当B"]["entries"][0]
        self.assertEqual(entry["blocks"][0]["fields"], ["第一圃場", "第二圃場"])
        self.assertEqual(entry["blocks"][0]["field"], "")
        direct["blocks"][0]["fields"] = ["第一圃場"]
        self.assertEqual(self.save_next(direct, id=direct["id"])[0], 200)
        self.stored(self.saved())
        self.assertEqual(self.request("GET /shift/work-plans")[0], 200)

    def test_companions_receive_only_their_blocks(self):
        self.plan.update(kind="1", reporter="")
        first = {**self.plan["blocks"][0], "companions": ["同伴A", "同伴B"]}
        second = {**first, "start": "13:00", "end": "16:00", "companions": ["同伴B"]}
        self.plan["blocks"] = [first, second]
        self.assertEqual(self.request()[0], 200)
        people = self.saved()["people"]
        self.assertEqual(people["担当A"]["blocks"], [first, second])
        self.assertEqual(people["同伴A"]["blocks"], [first])
        self.assertEqual(people["同伴B"]["blocks"], [first, second])
        entry = people["同伴A"]["entries"][0]
        self.assertEqual(entry["names"], ["担当A", "担当B"])
        self.assertEqual(entry["source"], "message")
        self.assertTrue(entry["source_label"])
        self.assertEqual(entry["worker"], "同伴A")

    def test_recopy_removes_stale_companions_only_from_own_plan(self):
        self.plan.update(kind="1", reporter="", names=["担当A"])
        self.plan["blocks"][0]["companions"] = ["同伴"]
        self.assertEqual(self.request()[0], 200)
        other = copy.deepcopy(self.plan)
        other.update(names=["別担当"], message="別の連絡")
        self.assertEqual(self.save_next(other)[0], 200)
        self.assertEqual(self.save_next(self.direct(["同伴"]))[0], 200)
        self.plan["blocks"][0].pop("companions")
        self.assertEqual(self.save_next(self.plan)[0], 200)
        people = self.saved()["people"]
        self.assertEqual(len(people["同伴"]["entries"]), 2)
        self.assertEqual({entry["source"] for entry in people["同伴"]["entries"]}, {"message", "direct"})
        self.assertEqual([entry["names"] for entry in people["同伴"]["entries"]
                          if entry["source"] == "message"], [["別担当"]])

    def test_recopy_trims_overlapping_recipients_but_keeps_other_recipients(self):
        self.assertEqual(self.request()[0], 200)
        old_id = next(iter(self.saved()["plans"]))
        replacement = {**self.plan, "names": ["担当A"], "kind": "1", "reporter": "", "message": "更新"}
        self.assertEqual(self.save_next(replacement)[0], 200)
        plans = self.saved()["plans"]
        self.assertEqual(len(plans), 2)
        self.assertEqual(plans[old_id]["names"], ["担当B"])
        self.assertEqual(plans[old_id]["reporter"], "担当B")
        self.assertEqual(len(self.saved()["people"]["担当A"]["entries"]), 1)
        self.assertEqual(self.save_next(self.plan)[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 1)

    def test_off_message_does_not_cancel_direct_or_companion_work(self):
        self.assertEqual(self.request()[0], 200)
        companion = copy.deepcopy(self.plan)
        companion.update(names=["別担当"], kind="1", reporter="")
        companion["blocks"][0]["companions"] = ["担当A"]
        self.assertEqual(self.save_next(companion)[0], 200)
        self.assertEqual(self.save_next(self.direct(["担当B"]))[0], 200)
        off = {**self.plan, "off": True, "blocks": [], "off_reason": "雨"}
        self.assertEqual(self.save_next(off)[0], 200)
        people = self.saved()["people"]
        for name in ("担当A", "担当B"):
            self.assertFalse(people[name]["off"])
            self.assertEqual(len(people[name]["blocks"]), 1)
            self.assertEqual(len(people[name]["entries"]), 2)
            self.assertEqual(sum(entry["off"] for entry in people[name]["entries"]), 1)

    def test_edit_by_id_does_not_recopy_other_plans(self):
        self.assertEqual(self.request()[0], 200)
        identifier = next(iter(self.saved()["plans"]))
        self.assertEqual(self.save_next(self.direct())[0], 200)
        self.assertEqual(self.save_next({**self.plan, "message": "編集"}, id=identifier)[0], 200)
        self.assertEqual(len(self.saved()["plans"]), 2)
        self.assertEqual(self.saved()["plans"][identifier]["message"], "編集")

    def test_ids_are_stable_for_sorted_message_recipients(self):
        status, first = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(set(first), {"saved", "date", "id", "names", "updated_at"})
        self.assertEqual(self.save_next({**self.plan, "names": list(reversed(self.plan["names"]))})[1]["id"],
                         first["id"])
        self.assertEqual(len(self.saved()["plans"]), 1)

    def test_missing_ids_and_source_changes_are_rejected(self):
        self.assertEqual(self.request()[0], 200)
        identifier = next(iter(self.saved()["plans"]))
        self.stored(self.saved())
        fake_s3.put_object.reset_mock()
        for operation in ("upsert", "delete"):
            self.assertEqual(self.request(body={
                "date": "2026-11-02", "revision": self.revision, "plan": self.plan,
                "id": "missing", "operation": operation,
            })[0], 404)
        self.assertEqual(self.request(body={
            "date": "2026-11-02", "revision": self.revision, "plan": self.direct(), "id": identifier,
        })[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_direct_delete_is_conditional_and_preserves_message(self):
        self.assertEqual(self.request()[0], 200)
        message_id = next(iter(self.saved()["plans"]))
        status, body = self.save_next(self.direct())
        self.assertEqual(status, 200)
        identifier = body["id"]
        self.stored(self.saved())
        status, body = self.request(body={
            "date": "2026-11-02", "revision": self.revision, "id": identifier, "operation": "delete",
        })
        self.assertEqual(status, 200)
        self.assertTrue(body["saved"])
        self.assertEqual(body["id"], identifier)
        self.assertEqual(body["names"], ["担当A"])
        self.assertEqual(list(self.saved()["plans"]), [message_id])
        self.assertEqual(fake_s3.put_object.call_args.kwargs["IfMatch"], self.revision)
        fake_s3.delete_object.assert_not_called()
        self.stored(self.saved())
        fake_s3.put_object.reset_mock()
        self.assertEqual(self.request(body={
            "date": "2026-11-02", "revision": self.revision, "id": message_id, "operation": "delete",
        })[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_direct_delete_last_plan_and_conflicts(self):
        status, body = self.request(body={"date": "2026-11-02", "revision": None, "plan": self.direct()})
        self.assertEqual(status, 200)
        self.stored(self.saved())
        deletion = {"date": "2026-11-02", "revision": None, "id": body["id"], "operation": "delete"}
        fake_s3.put_object.reset_mock()
        self.assertEqual(self.request(body=deletion)[0], 409)
        fake_s3.put_object.assert_not_called()
        deletion["revision"] = self.revision
        for code in ("PreconditionFailed", "ConditionalRequestConflict", "409", "412"):
            fake_s3.put_object.side_effect = FakeClientError(code)
            self.assertEqual(self.request(body=deletion)[0], 409)
        fake_s3.put_object.side_effect = None
        self.assertEqual(self.request(body=deletion)[0], 200)
        self.assertEqual(self.saved()["plans"], {})
        self.assertEqual(self.saved()["people"], {})
        self.stored(self.saved())
        self.assertEqual(self.request("GET /shift/work-plans")[0], 200)
        fake_s3.delete_object.assert_not_called()

    def test_invalid_direct_times_fields_companions_and_states(self):
        variants = []
        for change in ({"start": "08:00"}, {"end": "12:00"}, {"start": None, "end": None},
                       {"start": "12:00", "end": "08:00"}, {"fields": "圃場"},
                       {"fields": [""]}, {"fields": [1]}, {"fields": ["圃場"] * 31},
                       {"companions": ["同伴"]}, {"task": ""}, {"shed": "false"}):
            plan = self.direct()
            plan["blocks"][0].update(change)
            variants.append(plan)
        for change in ({"off": True}, {"manual_text": True}, {"kind": "2"}, {"reporter": "担当A"},
                       {"message": "文面"}, {"names": ["担当A"] * 2}, {"names": ["人"] * 21}):
            variants.append({**self.direct(), **change})
        for plan in variants:
            with self.subTest(plan=plan):
                self.assertEqual(self.request(body={
                    "date": "2026-11-02", "revision": None, "plan": plan,
                })[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_invalid_message_fields_and_companions(self):
        variants = []
        for change in ({"companions": ["担当A"]}, {"companions": ["同伴", "同伴"]},
                       {"companions": ["同伴"] * 21}, {"companions": "同伴"},
                       {"companions": [1]}, {"fields": None}, {"fields": [None]}):
            plan = copy.deepcopy(self.plan)
            plan.update(kind="1", reporter="")
            plan["blocks"][0].update(change)
            variants.append(plan)
        for kind in ("2", "3"):
            plan = copy.deepcopy(self.plan)
            plan["kind"] = kind
            plan["blocks"][0]["companions"] = []
            variants.append(plan)
        plan = copy.deepcopy(self.plan)
        plan["blocks"][0].pop("field")
        variants.append(plan)
        for plan in variants:
            with self.subTest(plan=plan):
                self.assertEqual(self.request(body={
                    "date": "2026-11-02", "revision": None, "plan": plan,
                })[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_invalid_operations_and_ids(self):
        for change in ({"operation": "other"}, {"operation": "delete"}, {"id": None},
                       {"id": ""}, {"id": "../id"}, {"id": "a" * 129}, {"id": 12}):
            with self.subTest(change=change):
                self.assertEqual(self.request(body={
                    "date": "2026-11-02", "revision": None, "plan": self.plan, **change,
                })[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_malformed_stored_records_fail_instead_of_becoming_empty(self):
        malformed = [
            [], {"date": "2026-11-02", "people": []},
            {"date": "2026-11-02", "people": {"担当A": {"old": True}}},
            {"date": "2026-11-02", "people": {}, "plans": []},
            {"date": "2026-11-02", "people": {}, "plans": {"x": {}}},
            {"date": "2026-11-02", "people": {}, "updated_at": 1},
        ]
        self.assertEqual(self.request()[0], 200)
        canonical = self.saved()
        mismatched = copy.deepcopy(canonical)
        mismatched["people"] = {}
        malformed.append(mismatched)
        mismatched = copy.deepcopy(canonical)
        next(iter(mismatched["plans"].values()))["id"] = "other"
        malformed.append(mismatched)
        legacy = self.legacy_people(self.plan)
        legacy["担当B"]["message"] = "異なる文面"
        malformed.append({"date": "2026-11-02", "people": legacy})
        fake_s3.put_object.reset_mock()
        for record in malformed:
            with self.subTest(record=record), self.assertLogs(api.LOGGER, level="ERROR"):
                self.stored(record)
                self.assertEqual(self.request("GET /shift/work-plans")[0], 500)
        fake_s3.put_object.assert_not_called()

    def test_base64_requests_and_bad_encoding(self):
        raw = json.dumps({"date": "2026-11-02", "revision": None, "plan": self.plan}).encode()
        self.assertEqual(self.request(raw_body=base64.b64encode(raw).decode(), encoded=True)[0], 200)
        fake_s3.put_object.reset_mock()
        for raw in ("not-base64", base64.b64encode(b"\xff").decode(),
                    base64.b64encode(b"x" * 65537).decode()):
            self.assertEqual(self.request(raw_body=raw, encoded=True)[0], 400)
        fake_s3.put_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()
