"""Offline tests: no AWS calls or LINE messages."""

import base64
import hashlib
import hmac
import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


ssm = MagicMock()
with patch.dict(sys.modules, {
    "boto3": types.SimpleNamespace(client=lambda service: ssm),
    "botocore": types.ModuleType("botocore"),
    "botocore.exceptions": types.SimpleNamespace(ClientError=FakeClientError),
}):
    spec = importlib.util.spec_from_file_location(
        "line_test", Path(__file__).with_name("lambda_function.py")
    )
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)

USER = "U" + "1" * 32
OTHER = "U" + "2" * 32
RETRY = "a620fb4b-8c37-46bc-9fd5-d28b4bdeee2d"


class LineTest(unittest.TestCase):
    def setUp(self):
        ssm.reset_mock(return_value=True, side_effect=True)
        self.values = {
            api.PREFIX + "channel-secret": "test-secret",
            api.PREFIX + "channel-access-token": "test-access-token",
        }

        def get_parameter(Name, WithDecryption):
            self.assertTrue(WithDecryption)
            if Name not in self.values:
                raise FakeClientError("ParameterNotFound")
            return {"Parameter": {"Value": self.values[Name]}}

        def put_parameter(Name, Type, Value, Overwrite):
            self.assertEqual(Type, "SecureString")
            if Name in self.values and not Overwrite:
                raise FakeClientError("ParameterAlreadyExists")
            self.values[Name] = Value
            return {"Version": 1}

        ssm.get_parameter.side_effect = get_parameter
        ssm.put_parameter.side_effect = put_parameter
        self.network = patch.object(api, "urlopen")
        self.urlopen = self.network.start()
        self.addCleanup(self.network.stop)
        self.urlopen.return_value.__enter__.return_value.status = 200

    def call(self, event):
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def prepare(self):
        status, result = self.call({"action": "prepare_registration"})
        self.assertEqual(status, 200)
        return result["registration_message"]

    def event(self, text="hello", user=USER, encoded=False):
        payload = {"destination": "bot", "events": [{
            "type": "message",
            "source": {"type": "user", "userId": user},
            "message": {"type": "text", "text": text},
        }]}
        return self.signed(payload, encoded)

    def signed(self, payload, encoded=False):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        signature = base64.b64encode(hmac.new(
            b"test-secret", raw, hashlib.sha256
        ).digest()).decode("ascii")
        return {
            "version": "2.0", "rawPath": "/line/webhook",
            "requestContext": {"http": {"method": "POST"}},
            "headers": {"X-Line-Signature": signature},
            "body": base64.b64encode(raw).decode() if encoded else raw.decode(),
            "isBase64Encoded": encoded,
        }

    def bind(self):
        text = self.prepare()
        self.assertEqual(self.call(self.event(text))[0], 200)

    def test_signature_is_checked_before_json_or_writes(self):
        event = self.event()
        event["body"] = "not json"
        self.assertEqual(self.call(event)[0], 401)
        ssm.put_parameter.assert_not_called()

    def test_missing_and_non_ascii_signatures(self):
        for signature in (None, "\u3042"):
            event = self.event()
            event["headers"] = {"x-line-signature": signature}
            self.assertEqual(self.call(event)[0], 401)

    def test_line_verification_empty_events(self):
        self.assertEqual(self.call(self.signed({"events": []})), (
            200, {"registrations": 0, "events_received": 0}
        ))

    def test_ordinary_messages_are_not_stored_or_sent(self):
        for text in ("hello", "\u4e86\u89e3\u3067\u3059"):
            self.assertEqual(self.call(self.event(text))[0], 200)
        ssm.put_parameter.assert_not_called()
        self.urlopen.assert_not_called()

    def test_prepare_stores_hash_and_fifteen_minute_expiry(self):
        with patch.object(api.time, "time", return_value=1000):
            text = self.prepare()
        stored = json.loads(self.values[api.PREFIX + "test-registration"])
        self.assertEqual(stored["expires_at"], 1900)
        self.assertNotIn(text[len(api.REGISTRATION_PREFIX):], json.dumps(stored))

    def test_valid_registration_plain_and_base64(self):
        text = self.prepare()
        for encoded in (False, True):
            self.assertEqual(self.call(self.event(text, encoded=encoded))[0], 200)
        self.assertEqual(self.values[api.PREFIX + "test-user-id"], USER)
        self.urlopen.assert_not_called()

    def test_invalid_code_and_missing_preparation(self):
        self.assertEqual(self.call(self.event("REGISTER wrong"))[0], 403)
        self.prepare()
        self.assertEqual(self.call(self.event("REGISTER wrong"))[0], 403)
        self.assertNotIn(api.PREFIX + "test-user-id", self.values)

    def test_expired_code(self):
        with patch.object(api.time, "time", return_value=1000):
            text = self.prepare()
        with patch.object(api.time, "time", return_value=1900):
            self.assertEqual(self.call(self.event(text))[0], 403)

    def test_cannot_rebind_or_prepare_after_registration(self):
        text = self.prepare()
        self.assertEqual(self.call(self.event(text))[0], 200)
        self.assertEqual(self.call(self.event(text, OTHER))[0], 409)
        self.assertEqual(self.call({"action": "prepare_registration"})[0], 409)
        self.assertEqual(self.values[api.PREFIX + "test-user-id"], USER)

    def test_registration_race_does_not_overwrite(self):
        text = self.prepare()

        def race(**kwargs):
            self.values[api.PREFIX + "test-user-id"] = OTHER
            raise FakeClientError("ParameterAlreadyExists")

        ssm.put_parameter.side_effect = race
        self.assertEqual(self.call(self.event(text))[0], 409)
        self.assertEqual(self.values[api.PREFIX + "test-user-id"], OTHER)

    def test_invalid_user_and_group_registration(self):
        text = self.prepare()
        self.assertEqual(self.call(self.event(text, "not-user"))[0], 400)
        event = {"events": [{
            "type": "message", "source": {"type": "group", "userId": USER},
            "message": {"type": "text", "text": text},
        }]}
        self.assertEqual(self.call(self.signed(event))[0], 400)

    def test_bad_route_method_encoding_json_and_event_shape(self):
        variants = [
            {**self.event(), "rawPath": "/other"},
            {**self.event(), "requestContext": {"http": {"method": "GET"}}},
            {**self.event(), "isBase64Encoded": True, "body": "!!!"},
            self.signed({"events": {}}),
            self.signed({"events": [None]}),
            self.signed({"events": [{"type": "message", "message": None}]}),
        ]
        for event, expected in zip(variants, (404, 405, 400, 400, 400, 400)):
            self.assertEqual(self.call(event)[0], expected)
        event = self.event()
        raw = b"not-json"
        event["body"] = raw.decode()
        event["headers"]["X-Line-Signature"] = base64.b64encode(
            hmac.new(b"test-secret", raw, hashlib.sha256).digest()
        ).decode()
        self.assertEqual(self.call(event)[0], 400)

    def test_http_request_cannot_execute_direct_actions(self):
        event = self.signed({"events": []})
        event["action"] = "send_test"
        event["retry_key"] = RETRY
        self.assertEqual(self.call(event)[0], 200)
        self.urlopen.assert_not_called()
        self.assertEqual(self.call({
            "requestContext": {}, "action": "prepare_registration"
        })[0], 405)

    def test_send_requires_registration_and_retry_key(self):
        self.assertEqual(self.call({"action": "send_test"})[0], 400)
        self.assertEqual(self.call({
            "action": "send_test", "retry_key": RETRY
        })[0], 409)
        self.urlopen.assert_not_called()

    def test_send_has_fixed_recipient_text_timeout_and_retry_key(self):
        self.bind()
        status, result = self.call({
            "action": "send_test", "retry_key": RETRY, "to": OTHER, "text": "ignored",
        })
        self.assertEqual((status, result["status"]), (200, "accepted"))
        self.assertFalse(result["delivery_confirmed"])
        request = self.urlopen.call_args.args[0]
        self.assertEqual(json.loads(request.data), {
            "to": USER, "messages": [{"type": "text", "text": api.TEST_MESSAGE}],
        })
        self.assertEqual(request.get_header("X-line-retry-key"), RETRY)
        self.assertEqual(self.urlopen.call_args.kwargs["timeout"], 10)

    def test_timeout_and_http_errors_never_report_success(self):
        self.bind()
        for error, expected in (
            (URLError("timeout"), 504),
            (TimeoutError(), 504),
            (HTTPError("url", 401, "error", {}, io.BytesIO(b"secret")), 502),
            (HTTPError("url", 429, "error", {}, io.BytesIO(b"secret")), 502),
            (HTTPError("url", 500, "error", {}, io.BytesIO(b"secret")), 502),
            (HTTPError("url", 409, "error", {}, io.BytesIO(b"secret")), 502),
        ):
            self.urlopen.side_effect = error
            status, body = self.call({"action": "send_test", "retry_key": RETRY})
            self.assertEqual(status, expected)
            self.assertNotIn("secret", json.dumps(body))

    def test_retry_accepted_by_line(self):
        self.bind()
        self.urlopen.side_effect = HTTPError(
            "url", 409, "error", {"x-line-accepted-request-id": "previous"},
            io.BytesIO(),
        )
        self.assertEqual(self.call({"action": "send_test", "retry_key": RETRY}), (
            200, {"status": "already_accepted", "delivery_confirmed": False}
        ))

    def test_aws_error_is_visible_and_does_not_leak_details(self):
        ssm.get_parameter.side_effect = FakeClientError("AccessDeniedException")
        status, body = self.call(self.event())
        self.assertEqual(status, 500)
        self.assertIn("AWS operation failed", body["error"])

    def test_oversized_and_unknown_events(self):
        self.assertEqual(self.call({
            **self.event(), "body": "x" * (api.MAX_BODY_BYTES + 1)
        })[0], 413)
        self.assertEqual(self.call({"action": "unknown"})[0], 400)
        self.assertEqual(self.call(None)[0], 400)


if __name__ == "__main__":
    unittest.main()
