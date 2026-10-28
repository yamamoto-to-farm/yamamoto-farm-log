import base64
import hashlib
import json
import logging
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
S3 = boto3.client("s3", config=Config(signature_version="s3v4"))
MAX_BYTES = 5 * 1024 * 1024
PAGE_SIZE = 24
MAX_SEARCH_KEYS = 2000
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


def valid_date(value, message):
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("noncanonical date")
    except ValueError as error:
        raise RequestError(400, message) from error


def public_photo(bucket, metadata):
    metadata = dict(metadata)
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
    return metadata


def user_groups(claims):
    # API Gateway検証済みの cognito:groups のみ信頼する。値は "[admin family]" 形式で届く。
    return set(str(claims.get("cognito:groups", "")).strip("[]").replace(",", " ").split())


def list_date_keys(bucket, prefix, start, end, field=None):
    base = f"{prefix}by-date/"
    if field is not None:
        digest = hashlib.sha256(field.encode("utf-8")).hexdigest()
        base = f"{prefix}by-field-date/{digest}/"
    options = {"Bucket": bucket, "Prefix": base, "StartAfter": f"{base}{start}/"}
    keys = []
    while True:
        listing = S3.list_objects_v2(**options)
        for item in listing.get("Contents", []):
            if item["Key"][len(base):len(base) + 10] > end:
                return keys
            keys.append(item["Key"])
            limit = 100000 if os.environ.get("PHOTO_SEARCH_INDEX_VERSION") == "2" else MAX_SEARCH_KEYS
            if len(keys) > limit:
                raise RequestError(400, "対象の写真が多すぎます。期間を狭めてください。")
        if not listing.get("IsTruncated"):
            return keys
        options["ContinuationToken"] = listing["NextContinuationToken"]


def read_json_or_none(bucket, key):
    try:
        return read_json(bucket, key)
    except RequestError:
        return None


def field_date_key(prefix, metadata):
    digest = hashlib.sha256(metadata["field"].encode("utf-8")).hexdigest()
    return f"{prefix}by-field-date/{digest}/{metadata['takenOn']}/{metadata['id']}.json"


def write_indexes(bucket, prefix, metadata):
    write_json(bucket, field_date_key(prefix, metadata), metadata)
    write_json(bucket, f"{prefix}by-date/{metadata['takenOn']}/{metadata['id']}.json", metadata)


def edit_photo(bucket, prefix, root, data, claims):
    if not {"admin", "family"} & user_groups(claims):
        raise RequestError(403, "写真を編集する権限がありません。")
    photo_id = text(data, "id", 80)
    if not PHOTO_ID.fullmatch(photo_id):
        raise RequestError(400, "写真IDが不正です。")
    taken_on = text(data, "takenOn", 10)
    valid_date(taken_on, "撮影日が不正です。")
    note = text(data, "note", 1000, required=False)
    original = read_json(bucket, f"{root}records/{photo_id}.json")
    metadata = {**original, "takenOn": taken_on, "note": note,
                "updatedAt": datetime.now(timezone.utc).isoformat()}
    # Keep pending metadata consistent so retrying /complete cannot undo an edit.
    write_json(bucket, f"{root}pending/{photo_id}.json", metadata)
    write_json(bucket, f"{root}records/{photo_id}.json", metadata)
    write_indexes(bucket, prefix, metadata)
    if original["takenOn"] != taken_on:
        S3.delete_object(Bucket=bucket, Key=field_date_key(prefix, original))
        S3.delete_object(
            Bucket=bucket, Key=f"{prefix}by-date/{original['takenOn']}/{photo_id}.json")
    return {"id": photo_id, "takenOn": taken_on, "note": note}


def search_photos(bucket, prefix, data, claims):
    start = text(data, "from", 10)
    end = text(data, "to", 10)
    valid_date(start, "開始日が不正です。")
    valid_date(end, "終了日が不正です。")
    if start > end:
        raise RequestError(400, "開始日は終了日以前にしてください。")
    field = text(data, "field", 100, required=False)
    fields = {field} if field else set()
    if "fields" in data:
        try:
            values = json.loads(data["fields"])
        except (ValueError, TypeError) as error:
            raise RequestError(400, "圃場の指定が不正です。") from error
        if not isinstance(values, list):
            raise RequestError(400, "圃場は配列で指定してください。")
        for value in values:
            fields.add(text({"field": value}, "field", 100))
    cursor = text(data, "cursor", 10, required=False)
    if cursor and not cursor.isdigit():
        raise RequestError(400, "一覧の続きの取得に失敗しました。一覧を更新してください。")
    offset = int(cursor or 0)

    indexed = os.environ.get("PHOTO_SEARCH_INDEX_VERSION") == "2"
    if indexed and fields:
        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = pool.map(lambda name: list_date_keys(bucket, prefix, start, end, name), sorted(fields))
            keys = [key for batch in batches for key in batch]
        keys.sort(key=lambda key: tuple(key.rsplit("/", 2)[-2:]), reverse=True)
    else:
        keys = sorted(list_date_keys(bucket, prefix, start, end), reverse=True)
    if fields and not indexed:
        with ThreadPoolExecutor(max_workers=8) as pool:
            records = list(pool.map(lambda key: read_json_or_none(bucket, key), keys))
        matched = [record for record in records if record and record.get("field") in fields]
    else:
        matched = None
    total = len(matched) if matched is not None else len(keys)
    end_index = offset + PAGE_SIZE
    if matched is not None:
        page = matched[offset:end_index]
    else:
        with ThreadPoolExecutor(max_workers=8) as pool:
            page = [r for r in pool.map(lambda key: read_json_or_none(bucket, key), keys[offset:end_index]) if r]
    groups = user_groups(claims)
    photos = []
    for record in page:
        mine = record.get("uploadedBy") == claims["sub"]
        photo = public_photo(bucket, record)
        photo["canDelete"] = mine or bool({"admin", "family"} & groups)
        photo["canEdit"] = bool({"admin", "family"} & groups)
        photos.append(photo)
    return {"photos": photos, "cursor": str(end_index) if end_index < total else None, "total": total}


def delete_photo(bucket, prefix, root, field_key, photo_id, claims):
    record = read_json(bucket, f"{root}records/{photo_id}.json")
    mine = record.get("uploadedBy") == claims["sub"]
    if not mine and not {"admin", "family"} & user_groups(claims):
        raise RequestError(403, "この写真を削除する権限がありません。")
    keys = [
        f"{root}images/{photo_id}.jpg",
        f"{root}records/{photo_id}.json",
        f"{root}pending/{photo_id}.json",
        f"{prefix}by-date/{record['takenOn']}/{photo_id}.json",
        field_date_key(prefix, record),
    ]
    for key in keys:
        S3.delete_object(Bucket=bucket, Key=key)
    top = read_json_or_none(bucket, f"{prefix}tops/{field_key}.json")
    if top and top.get("id") == photo_id:
        S3.delete_object(Bucket=bucket, Key=f"{prefix}tops/{field_key}.json")


def backfill_date_index(bucket, prefix):
    # Lambdaコンソールから {"action": "backfill"} で手動実行する(API経由では到達不可)。
    count = 0
    options = {"Bucket": bucket, "Prefix": f"{prefix}fields/"}
    while True:
        listing = S3.list_objects_v2(**options)
        for item in listing.get("Contents", []):
            if "/records/" not in item["Key"]:
                continue
            metadata = read_json(bucket, item["Key"])
            write_indexes(bucket, prefix, metadata)
            count += 1
        if not listing.get("IsTruncated"):
            return count
        options["ContinuationToken"] = listing["NextContinuationToken"]


def lambda_handler(event, context):
    if event.get("action") == "backfill" and "routeKey" not in event:
        return {"indexed": backfill_date_index(os.environ["PHOTO_BUCKET"], os.environ["PHOTO_PREFIX"])}
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
        if route in ("GET /photos", "GET /photos/by-date", "GET /photos/top", "GET /photos/search"):
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

        if route == "GET /photos/by-date":
            day = text(data, "date", 10)
            valid_date(day, "日付が不正です。")
            options = {"Bucket": bucket, "Prefix": f"{prefix}by-date/{day}/", "MaxKeys": 50}
            cursor = text(data, "cursor", 4096, required=False)
            if cursor:
                options["ContinuationToken"] = cursor
            try:
                listing = S3.list_objects_v2(**options)
            except ClientError as error:
                if cursor and error.response["Error"]["Code"] in ("InvalidArgument", "InvalidToken"):
                    raise RequestError(400, "一覧の続きの取得に失敗しました。一覧を更新してください。") from error
                raise
            photos = [public_photo(bucket, read_json(bucket, item["Key"])) for item in listing.get("Contents", [])]
            return response(200, {"photos": photos, "cursor": listing.get("NextContinuationToken")})

        if route == "GET /photos/search":
            return response(200, search_photos(bucket, prefix, data, claims))

        field = text(data, "field", 100)
        field_key = hashlib.sha256(field.encode("utf-8")).hexdigest()
        root = f"{prefix}fields/{field_key}/"

        if route == "GET /photos/top":
            try:
                top = read_json(bucket, f"{prefix}tops/{field_key}.json")
                record = read_json(bucket, f"{root}records/{top['id']}.json")
            except RequestError:
                return response(200, {"photo": None})
            return response(200, {"photo": public_photo(bucket, record)})

        if route == "POST /photos/top":
            if not {"admin", "family"} & user_groups(claims):
                raise RequestError(403, "トップ写真を設定する権限がありません。")
            photo_id = text(data, "id", 80)
            if not PHOTO_ID.fullmatch(photo_id):
                raise RequestError(400, "写真IDが不正です。")
            read_json(bucket, f"{root}records/{photo_id}.json")
            write_json(bucket, f"{prefix}tops/{field_key}.json", {
                "id": photo_id, "field": field, "setBy": claims["sub"],
                "setAt": datetime.now(timezone.utc).isoformat(),
            })
            return response(200, {"id": photo_id})

        if route == "POST /photos/delete":
            photo_id = text(data, "id", 80)
            if not PHOTO_ID.fullmatch(photo_id):
                raise RequestError(400, "写真IDが不正です。")
            delete_photo(bucket, prefix, root, field_key, photo_id, claims)
            return response(200, {"id": photo_id})

        if route == "POST /photos/edit":
            return response(200, edit_photo(bucket, prefix, root, data, claims))

        if route == "POST /photos/uploads":
            taken_on = text(data, "takenOn", 10)
            valid_date(taken_on, "撮影日が不正です。")
            note = text(data, "note", 1000, required=False)
            log_id = text(data, "logId", 100, required=False)
            photo_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ_") + uuid.uuid4().hex
            image_key = f"{root}images/{photo_id}.jpg"
            metadata = {
                "id": photo_id, "field": field, "takenOn": taken_on, "note": note,
                "uploadedAt": datetime.now(timezone.utc).isoformat(),
                "uploadedBy": claims["sub"], "imageKey": image_key,
            }
            if log_id:
                metadata["logId"] = log_id
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
            write_indexes(bucket, prefix, metadata)
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
                photos.append(public_photo(bucket, read_json(bucket, item["Key"])))
            return response(200, {"photos": photos, "cursor": listing.get("NextContinuationToken")})

        raise RequestError(404, "APIルートが見つかりません。")
    except RequestError as error:
        return response(error.status, {"message": error.message})
    except Exception:
        LOGGER.exception("Private photos API failed")
        return response(500, {"message": "写真の処理に失敗しました。管理者にお問い合わせください。"})
