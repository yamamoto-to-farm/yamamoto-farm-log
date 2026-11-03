"""shift-api Lambda のテスト（AWS・ネットワークに接続しないインメモリモック）.

実行: python -B -m unittest discover -s lambda\\shift-api -p "test_*.py"
"""
import importlib.util
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

    def request(self, route="POST /shift/work-plans", body=None, claims=None, raw_body=None):
        event = {
            "routeKey": route, "queryStringParameters": {"date": "2026-11-02"},
            "body": raw_body if raw_body is not None else json.dumps(body if body is not None else {
                "date": "2026-11-02", "revision": None, "plan": self.plan,
            }, ensure_ascii=False),
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
        self.existing({"担当A": {"old": True}, "別担当": {"keep": True}})
        status, body = self.request("GET /shift/work-plans")
        self.assertEqual(body["revision"], self.revision)
        self.existing({"担当A": {"old": True}, "別担当": {"keep": True}})
        status, _ = self.request(body={"date": "2026-11-02", "revision": self.revision, "plan": self.plan})
        self.assertEqual(status, 200)
        kwargs = fake_s3.put_object.call_args.kwargs
        self.assertEqual(kwargs["IfMatch"], self.revision)
        people = json.loads(kwargs["Body"])["people"]
        self.assertEqual(len(people), 3)
        self.assertNotIn("old", people["担当A"])
        self.assertEqual(people["別担当"], {"keep": True})

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


if __name__ == "__main__":
    unittest.main()
