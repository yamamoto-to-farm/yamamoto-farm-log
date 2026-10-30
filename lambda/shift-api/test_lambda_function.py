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

    def test_months_lists_month_prefixes_only(self):
        fake_s3.list_objects_v2.return_value = {
            "CommonPrefixes": [{"Prefix": "shift/2026-11/"}, {"Prefix": "shift/2026-12/"},
                               {"Prefix": "shift/ics/"}],
        }
        status, body = self.call("GET /shift/months")
        self.assertEqual(status, 200)
        self.assertEqual(body["months"], ["2026-12", "2026-11"])


if __name__ == "__main__":
    unittest.main()
