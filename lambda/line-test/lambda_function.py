"""Isolated LINE webhook registration and manually invoked connection test."""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
SSM = boto3.client("ssm")
PREFIX = "/yamamoto-farm/line/"
WEBHOOK_PATH = "/line/webhook"
REGISTRATION_PREFIX = "REGISTER "
TEST_MESSAGE = "Yamamoto Farm OS: LINE connection test."
USER_ID = re.compile(r"U[0-9a-f]{32}")
MAX_BODY_BYTES = 256 * 1024


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(body),
    }


def parameter(name, optional=False):
    try:
        return SSM.get_parameter(
            Name=PREFIX + name, WithDecryption=True
        )["Parameter"]["Value"]
    except ClientError as error:
        if optional and error.response["Error"]["Code"] == "ParameterNotFound":
            return None
        raise


def prepare_registration():
    if parameter("test-user-id", optional=True) is not None:
        raise RequestError(409, "Test recipient is already registered.")
    code = secrets.token_urlsafe(24)
    expires_at = int(time.time()) + 15 * 60
    SSM.put_parameter(
        Name=PREFIX + "test-registration",
        Type="SecureString",
        Value=json.dumps({
            "code_hash": hashlib.sha256(code.encode("ascii")).hexdigest(),
            "expires_at": expires_at,
        }),
        Overwrite=True,
    )
    return {
        "registration_message": REGISTRATION_PREFIX + code,
        "expires_at": expires_at,
        "expires_in_seconds": 900,
    }


def register_user(text, user_id):
    if not isinstance(user_id, str) or not USER_ID.fullmatch(user_id):
        raise RequestError(400, "Registration requires a one-to-one LINE user.")
    raw = parameter("test-registration", optional=True)
    if raw is None:
        raise RequestError(403, "Prepare a registration code first.")
    registration = json.loads(raw)
    candidate = hashlib.sha256(
        text[len(REGISTRATION_PREFIX):].encode("utf-8")
    ).hexdigest()
    if not hmac.compare_digest(candidate, registration["code_hash"]):
        raise RequestError(403, "Invalid registration code.")
    existing = parameter("test-user-id", optional=True)
    if existing is not None:
        if existing == user_id:
            return
        raise RequestError(409, "Test recipient cannot be overwritten.")
    if time.time() >= registration["expires_at"]:
        raise RequestError(403, "Registration code has expired.")
    try:
        SSM.put_parameter(
            Name=PREFIX + "test-user-id",
            Type="SecureString",
            Value=user_id,
            Overwrite=False,
        )
    except ClientError as error:
        if error.response["Error"]["Code"] != "ParameterAlreadyExists":
            raise
        if parameter("test-user-id") != user_id:
            raise RequestError(409, "Test recipient cannot be overwritten.") from None


def verified_events(event):
    http = event.get("requestContext", {}).get("http", {})
    if event.get("version") != "2.0" or http.get("method") != "POST":
        raise RequestError(405, "HTTP API payload 2.0 POST is required.")
    if event.get("rawPath") != WEBHOOK_PATH:
        raise RequestError(404, "Unknown webhook path.")
    body = event.get("body")
    if not isinstance(body, str) or len(body) > MAX_BODY_BYTES * 2:
        raise RequestError(400, "Invalid webhook body.")
    try:
        raw = (
            base64.b64decode(body, validate=True)
            if event.get("isBase64Encoded")
            else body.encode("utf-8")
        )
    except (ValueError, binascii.Error):
        raise RequestError(400, "Invalid webhook encoding.") from None
    if len(raw) > MAX_BODY_BYTES:
        raise RequestError(413, "Webhook body is too large.")
    headers = event.get("headers")
    if not isinstance(headers, dict):
        raise RequestError(401, "Missing LINE signature.")
    signature = next(
        (value for key, value in headers.items()
         if key.lower() == "x-line-signature"), None
    )
    if not isinstance(signature, str) or not signature.isascii():
        raise RequestError(401, "Missing or invalid LINE signature.")
    expected = base64.b64encode(hmac.new(
        parameter("channel-secret").encode("utf-8"), raw, hashlib.sha256
    ).digest()).decode("ascii")
    if not hmac.compare_digest(signature, expected):
        raise RequestError(401, "Invalid LINE signature.")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise RequestError(400, "Invalid webhook JSON.") from None
    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list) or len(events) > 100:
        raise RequestError(400, "Invalid webhook events.")
    return events


def webhook(event):
    events = verified_events(event)
    registrations = []
    for item in events:
        if not isinstance(item, dict):
            raise RequestError(400, "Invalid webhook event.")
        if item.get("type") != "message":
            continue
        message, source = item.get("message"), item.get("source")
        if not isinstance(message, dict) or not isinstance(source, dict):
            raise RequestError(400, "Invalid message event.")
        if message.get("type") != "text":
            continue
        text = message.get("text")
        if not isinstance(text, str):
            raise RequestError(400, "Invalid text event.")
        if text.startswith(REGISTRATION_PREFIX):
            if source.get("type") != "user":
                raise RequestError(400, "Register in a one-to-one chat only.")
            registrations.append((text, source.get("userId")))
    for text, user_id in registrations:
        register_user(text, user_id)
    return {"registrations": len(registrations), "events_received": len(events)}


def send_test(event):
    retry_key = event.get("retry_key")
    try:
        if not isinstance(retry_key, str) or str(uuid.UUID(retry_key)) != retry_key:
            raise ValueError
    except ValueError:
        raise RequestError(400, "Provide a canonical UUID retry_key.") from None
    user_id = parameter("test-user-id", optional=True)
    if user_id is None:
        raise RequestError(409, "Test recipient is not registered.")
    if not USER_ID.fullmatch(user_id):
        raise RequestError(500, "Stored test recipient is invalid.")
    request = Request(
        "https://api.line.me/v2/bot/message/push",
        data=json.dumps({
            "to": user_id,
            "messages": [{"type": "text", "text": TEST_MESSAGE}],
        }).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + parameter("channel-access-token"),
            "Content-Type": "application/json",
            "X-Line-Retry-Key": retry_key,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as result:
            if result.status != 200:
                raise RequestError(502, "Unexpected LINE response.")
    except HTTPError as error:
        accepted = error.headers.get("x-line-accepted-request-id")
        error.close()
        if error.code == 409 and accepted:
            return {"status": "already_accepted", "delivery_confirmed": False}
        LOGGER.warning("LINE push rejected with HTTP %s", error.code)
        raise RequestError(
            502, f"LINE returned HTTP {error.code}; do not change retry_key on retry."
        ) from None
    except (URLError, TimeoutError):
        raise RequestError(
            504, "LINE result is unknown; retry with the SAME retry_key within 24 hours."
        ) from None
    return {"status": "accepted", "delivery_confirmed": False}


def lambda_handler(event, context):
    try:
        if not isinstance(event, dict):
            raise RequestError(400, "Invalid event.")
        if "requestContext" in event:
            result = webhook(event)
        elif event.get("action") == "prepare_registration":
            result = prepare_registration()
        elif event.get("action") == "send_test":
            result = send_test(event)
        else:
            raise RequestError(400, "Unknown action.")
        return response(200, result)
    except RequestError as error:
        LOGGER.warning("LINE test request rejected: %s", error)
        return response(error.status, {"error": str(error)})
    except ClientError as error:
        LOGGER.error("LINE test AWS failure: %s", error.response["Error"]["Code"])
        return response(500, {"error": "AWS operation failed; check IAM and parameters."})
    except (KeyError, TypeError, ValueError):
        LOGGER.error("LINE test configuration or event format is invalid.")
        return response(500, {"error": "Invalid stored configuration or event format."})
