"""シフト案 読み取りAPI（Cognito JWT保護・admin/familyグループ限定）.

HTTP API（payload 2.0）のルート:
  GET /shift/plan   … 最新（または ?month=YYYY-MM）の plan.json を返す
  GET /shift/months … 保存済みの月の一覧を返す

時給を含むため、photos と同じ Cognito プールの検証済みクレームに加えて、
cognito:groups に admin または family が必要（worker には返さない）。

環境変数:
  SHIFT_BUCKET … 非公開バケット名（必須）
  SHIFT_PREFIX … キーの接頭辞（既定 "shift/"）
"""
import json
import logging
import os
import re

import boto3
from botocore.exceptions import ClientError

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
S3 = boto3.client("s3")
CLIENT_ID = "mg1q2dnn576jln28m5sja6eaf"
ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC"
ALLOWED_GROUPS = {"admin", "family"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class RequestError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def raw_json_response(raw):
    """S3の plan.json をそのまま返す（再エンコードしない）"""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": raw,
    }


def user_groups(claims):
    # API Gateway検証済みの cognito:groups のみ信頼する。値は "[admin family]" 形式で届く。
    return set(str(claims.get("cognito:groups", "")).strip("[]").replace(",", " ").split())


def list_months(bucket, prefix):
    months, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix, "Delimiter": "/"}
        if token:
            kw["ContinuationToken"] = token
        listing = S3.list_objects_v2(**kw)
        for item in listing.get("CommonPrefixes", []):
            name = item["Prefix"][len(prefix):].rstrip("/")
            if MONTH_RE.fullmatch(name):
                months.append(name)
        token = listing.get("NextContinuationToken")
        if not token:
            return sorted(months, reverse=True)


def lambda_handler(event, context):
    try:
        # API Gateway検証済みクレームのみ信頼する。
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        if (
            claims.get("token_use") != "access"
            or claims.get("client_id") != CLIENT_ID
            or claims.get("iss") != ISSUER
            or "openid" not in claims.get("scope", "").split()
            or not claims.get("sub")
        ):
            raise RequestError(401, "シフト管理のログインが必要です。")
        if not (user_groups(claims) & ALLOWED_GROUPS):
            raise RequestError(403, "シフト案を見る権限がありません。")

        bucket = os.environ["SHIFT_BUCKET"]
        prefix = os.environ.get("SHIFT_PREFIX", "shift/")
        if not prefix or prefix.startswith("/") or not prefix.endswith("/"):
            raise RuntimeError("SHIFT_PREFIX must be a nonempty relative prefix ending with /")
        route = event.get("routeKey")
        data = event.get("queryStringParameters") or {}

        if route == "GET /shift/months":
            return response(200, {"months": list_months(bucket, prefix)})

        if route == "GET /shift/plan":
            month = (data.get("month") or "").strip()
            if month and not MONTH_RE.fullmatch(month):
                raise RequestError(400, "month は YYYY-MM 形式で指定してください。")
            key = f"{prefix}{month}/plan.json" if month else f"{prefix}latest.json"
            try:
                result = S3.get_object(Bucket=bucket, Key=key)
            except ClientError as error:
                if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    raise RequestError(404, "シフト案がまだありません。") from error
                raise
            with result["Body"] as stream:
                return raw_json_response(stream.read().decode("utf-8"))

        raise RequestError(404, "不明なルートです。")
    except RequestError as error:
        return response(error.status, {"message": error.message})
    except Exception:
        LOGGER.exception("unhandled error")
        return response(500, {"message": "サーバーでエラーが発生しました。"})
