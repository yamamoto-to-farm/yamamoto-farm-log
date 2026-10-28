import base64
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
S3 = boto3.client("s3", config=Config(signature_version="s3v4"))
MAX_BYTES = 5 * 1024 * 1024
PHOTO_ID = re.compile(r"^\d{8}T\d{12}Z_[0-9a-f]{32}$")
CLIENT_ID = "mg1q2dnn576jln28m5sja6eaf"
ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC"


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


def text(data, name, maximum, required=True):
    value = data.get(name, "")
    if not isinstance(value, str) or len(value) > maximum:
        raise RequestError(400, f"{name} が不正です。")
    value = value.strip()
    if required and not value:
        raise RequestError(400, f"{name} を入力してください。")
    return value


def read_json(bucket, key):
    try:
        result = S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            raise RequestError(404, "写真情報が見つかりません。") from error
        raise
    with result["Body"] as stream:
        return json.loads(stream.read())


def write_json(bucket, key, data):
    S3.put_object(
        Bucket=bucket, Key=key,
        Body=json.dumps(data, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json", CacheControl="no-store",
    )


def lambda_handler(event, context):
    try:
        # Trust only API Gateway's verified claims, never request body/localStorage roles.
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        if (
            claims.get("token_use") != "access"
            or claims.get("client_id") != CLIENT_ID
            or claims.get("iss") != ISSUER
            or "openid" not in claims.get("scope", "").split()
            or not claims.get("sub")
        ):
            raise RequestError(401, "写真用ログインが必要です。")

        bucket = os.environ["PHOTO_BUCKET"]
        prefix = os.environ["PHOTO_PREFIX"]
        if not prefix or prefix.startswith("/") or not prefix.endswith("/"):
            raise RuntimeError("PHOTO_PREFIX must be a nonempty relative prefix ending with /")
        route = event.get("routeKey")
        if route == "GET /photos":
            data = event.get("queryStringParameters") or {}
        else:
            raw = event.get("body") or "{}"
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            if len(raw) > 16384:
                raise RequestError(400, "リクエストが大きすぎます。")
            try:
                data = json.loads(raw)
            except (ValueError, TypeError) as error:
                raise RequestError(400, "JSONが不正です。") from error
            if not isinstance(data, dict):
                raise RequestError(400, "JSONオブジェクトを指定してください。")

        field = text(data, "field", 100)
        field_key = hashlib.sha256(field.encode("utf-8")).hexdigest()
        root = f"{prefix}fields/{field_key}/"

        if route == "POST /photos/uploads":
            taken_on = text(data, "takenOn", 10)
            try:
                if date.fromisoformat(taken_on).isoformat() != taken_on:
                    raise ValueError("noncanonical date")
            except ValueError as error:
                raise RequestError(400, "撮影日が不正です。") from error
            note = text(data, "note", 1000, required=False)
            photo_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ_") + uuid.uuid4().hex
            image_key = f"{root}images/{photo_id}.jpg"
            metadata = {
                "id": photo_id, "field": field, "takenOn": taken_on, "note": note,
                "uploadedAt": datetime.now(timezone.utc).isoformat(),
                "uploadedBy": claims["sub"], "imageKey": image_key,
            }
            write_json(bucket, f"{root}pending/{photo_id}.json", metadata)
            upload = S3.generate_presigned_post(
                Bucket=bucket, Key=image_key,
                Fields={"Content-Type": "image/jpeg", "Cache-Control": "no-store"},
                Conditions=[
                    {"Content-Type": "image/jpeg"}, {"Cache-Control": "no-store"},
                    ["content-length-range", 1, MAX_BYTES],
                ],
                ExpiresIn=300,
            )
            return response(200, {"id": photo_id, "upload": upload})

        if route == "POST /photos/complete":
            photo_id = text(data, "id", 80)
            if not PHOTO_ID.fullmatch(photo_id):
                raise RequestError(400, "写真IDが不正です。")
            metadata = read_json(bucket, f"{root}pending/{photo_id}.json")
            if metadata["uploadedBy"] != claims["sub"]:
                raise RequestError(403, "このアップロードを確定する権限がありません。")
            image_key = metadata["imageKey"]
            try:
                head = S3.head_object(Bucket=bucket, Key=image_key)
            except ClientError as error:
                if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    raise RequestError(409, "画像のアップロードが完了していません。") from error
                raise
            if head["ContentType"] != "image/jpeg" or not 0 < head["ContentLength"] <= MAX_BYTES:
                raise RequestError(400, "JPEG画像（5MB以下）のみ保存できます。")
            image = S3.get_object(Bucket=bucket, Key=image_key, Range="bytes=0-2")
            with image["Body"] as stream:
                if stream.read() != b"\xff\xd8\xff":
                    raise RequestError(400, "JPEG画像ではありません。")
            write_json(bucket, f"{root}records/{photo_id}.json", metadata)
            return response(200, {"id": photo_id})

        if route == "GET /photos":
            options = {"Bucket": bucket, "Prefix": f"{root}records/", "MaxKeys": 20}
            cursor = text(data, "cursor", 4096, required=False)
            if cursor:
                options["ContinuationToken"] = cursor
            try:
                listing = S3.list_objects_v2(**options)
            except ClientError as error:
                if cursor and error.response["Error"]["Code"] in ("InvalidArgument", "InvalidToken"):
                    raise RequestError(400, "一覧の続きの取得に失敗しました。一覧を更新してください。") from error
                raise
            photos = []
            for item in listing.get("Contents", []):
                metadata = read_json(bucket, item["Key"])
                metadata.pop("uploadedBy", None)
                image_key = metadata.pop("imageKey")
                metadata["url"] = S3.generate_presigned_url(
                    "get_object",
                    Params={
                        "Bucket": bucket, "Key": image_key,
                        "ResponseContentType": "image/jpeg",
                        "ResponseContentDisposition": "inline",
                        "ResponseCacheControl": "no-store",
                    },
                    ExpiresIn=300,
                )
                photos.append(metadata)
            return response(200, {"photos": photos, "cursor": listing.get("NextContinuationToken")})

        raise RequestError(404, "APIルートが見つかりません。")
    except RequestError as error:
        return response(error.status, {"message": error.message})
    except Exception:
        LOGGER.exception("Private photos API failed")
        return response(500, {"message": "写真の処理に失敗しました。管理者にお問い合わせください。"})
