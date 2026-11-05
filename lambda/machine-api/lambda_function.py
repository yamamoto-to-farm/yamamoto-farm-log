"""Private machine manuals and freeform operating notes, with conditional saves."""

import base64
import hashlib
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import work_plans as core

LOGGER = logging.getLogger(__name__)
S3 = boto3.client("s3", config=Config(
    signature_version="s3v4", s3={"addressing_style": "virtual"},
))
MACHINE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
TYPES = {"application/pdf": ("pdf", 20 * 1024 * 1024),
         "image/jpeg": ("jpg", 10 * 1024 * 1024),
         "image/png": ("png", 10 * 1024 * 1024)}
CONFLICTS = {"PreconditionFailed", "ConditionalRequestConflict", "409", "412"}
MAX_ASSETS = 50


def fail(status, message):
    raise core.RequestError(status, message)


def uid(value):
    if not isinstance(value, str):
        fail(400, "資料の識別子が不正です。")
    try:
        if str(uuid.UUID(value)) != value:
            raise ValueError
    except ValueError:
        fail(400, "資料の識別子が不正です。")
    return value


def text(data, name, maximum, required=True):
    value = data.get(name, "")
    if not isinstance(value, str) or len(value) > maximum or "\x00" in value:
        fail(400, f"{name} の形式・文字数を確認してください。")
    value = value.strip()
    if required and not value:
        fail(400, f"{name} を入力してください。")
    return value


def read_json(bucket, key, initial=None):
    try:
        result = S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return initial, None
        raise
    with result["Body"] as stream:
        return json.loads(stream.read()), result["ETag"]


def put_json(bucket, key, data, revision=None):
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if len(raw) > 256 * 1024:
        fail(400, "資料が大きすぎます。文章や添付数を減らしてください。")
    try:
        S3.put_object(
            Bucket=bucket, Key=key, Body=raw, ContentType="application/json",
            CacheControl="no-store", **({"IfMatch": revision} if revision else {"IfNoneMatch": "*"}),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] in CONFLICTS:
            fail(409, "別の更新があります。入力を控えてから最新状態を再取得してください。")
        raise


def machines():
    data, _ = read_json(os.environ["MACHINES_BUCKET"], "data/machines.json")
    if not isinstance(data, dict) or not isinstance(data.get("machines"), list):
        fail(500, "機械マスタを取得できません。")
    result = data["machines"]
    if (any(not isinstance(item, dict) or not isinstance(item.get("id"), str)
            or not MACHINE_ID.fullmatch(item["id"]) or not isinstance(item.get("name"), str)
            or not item["name"].strip() for item in result)
            or len({item["id"] for item in result}) != len(result)):
        fail(500, "機械マスタのID・名称を確認してください。")
    return result


class Service:
    def __init__(self, machine, author):
        self.machine = machine
        self.author = author
        self.bucket = os.environ["MACHINE_BUCKET"]
        self.prefix = "machine-library/"
        self.record_key = self.prefix + f"records/{machine}.json"

    def record(self):
        return read_json(self.bucket, self.record_key, {
            "machineId": self.machine, "entries": [], "assets": {},
        })

    def ticket_key(self, asset):
        return self.prefix + f"tickets/{self.machine}/{uid(asset)}.json"

    def ticket(self, asset):
        ticket, _ = read_json(self.bucket, self.ticket_key(asset))
        if ticket is None:
            fail(404, "添付情報が見つかりません。")
        return ticket

    def file_key(self, asset, content_type):
        return self.prefix + f"files/{self.machine}/{uid(asset)}.{TYPES[content_type][0]}"

    def upload(self, req):
        content_type = req.get("type")
        size = req.get("size")
        if not isinstance(content_type, str) or content_type not in TYPES or type(size) is not int or not 1 <= size <= TYPES[content_type][1]:
            fail(400, "PDFは20MB、JPEG・PNGは10MB以内で指定してください。")
        name = text(req, "name", 150)
        if any(char in name for char in "\\/\r\n"):
            fail(400, "ファイル名が不正です。")
        asset = str(uuid.uuid4())
        key = self.prefix + f"staging/{self.machine}/{asset}"
        ticket = {"id": asset, "name": name, "type": content_type, "size": size,
                  "author": self.author, "expires": int(time.time()) + 900}
        put_json(self.bucket, self.ticket_key(asset), ticket)
        post = S3.generate_presigned_post(
            self.bucket, key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", size, size]],
            ExpiresIn=900,
        )
        return {"id": asset, "upload": post}

    def complete(self, req):
        asset = uid(req.get("id"))
        ticket = self.ticket(asset)
        if ticket["author"] != self.author:
            fail(403, "自分がアップロードした添付だけを確定できます。")
        if time.time() >= ticket["expires"]:
            fail(409, "アップロードの有効期限が切れました。もう一度ファイルを選択してください。")
        key = self.prefix + f"staging/{self.machine}/{asset}"
        try:
            result = S3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as error:
            if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                fail(409, "ファイルのアップロードが完了していません。")
            raise
        with result["Body"] as stream:
            raw = stream.read(ticket["size"] + 1)
        if len(raw) != ticket["size"] or result.get("ContentType") != ticket["type"]:
            fail(400, "アップロードしたファイルのサイズ・形式が一致しません。")
        valid = (raw.startswith(b"%PDF-") if ticket["type"] == "application/pdf"
                 else raw.startswith(b"\xff\xd8\xff") if ticket["type"] == "image/jpeg"
                 else raw.startswith(b"\x89PNG\r\n\x1a\n"))
        if not valid:
            fail(400, "PDF・JPEG・PNGの内容を確認できませんでした。")
        try:
            S3.put_object(
                Bucket=self.bucket, Key=self.file_key(asset, ticket["type"]),
                Body=raw, ContentType=ticket["type"], CacheControl="private, no-store",
                Metadata={"sha256": hashlib.sha256(raw).hexdigest()}, IfNoneMatch="*",
            )
        except ClientError as error:
            if error.response["Error"]["Code"] not in CONFLICTS:
                raise
            existing = S3.head_object(
                Bucket=self.bucket, Key=self.file_key(asset, ticket["type"]))
            if existing.get("Metadata", {}).get("sha256") != hashlib.sha256(raw).hexdigest():
                fail(409, "確定済みの添付内容が異なります。別のファイルとして登録してください。")
        return self.asset_info(ticket)

    @staticmethod
    def asset_info(ticket):
        return {key: ticket[key] for key in ("id", "name", "type", "size")}

    def save(self, req):
        entries = req.get("entries")
        revision = req.get("revision")
        if (not isinstance(entries, list) or len(entries) > 100
                or (revision is not None and (not isinstance(revision, str) or not revision))):
            fail(400, "資料数・更新版が不正です。")
        current, etag = self.record()
        if revision != etag:
            fail(409, "別の更新があります。入力を控えてから最新状態を再取得してください。")
        old = {entry["id"]: entry for entry in current["entries"]}
        normalized, assets, used = [], {}, set()
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for entry in entries:
            if not isinstance(entry, dict):
                fail(400, "資料の形式が不正です。")
            identifier = uid(entry.get("id"))
            if identifier in used or entry.get("kind") not in ("manual", "operation", "setting"):
                fail(400, "資料IDの重複・分類を確認してください。")
            used.add(identifier)
            link = text(entry, "url", 2000, required=False)
            if link:
                try:
                    parsed = urlsplit(link)
                    valid_link = parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password
                except ValueError:
                    valid_link = False
                if not valid_link or any(ord(char) < 33 for char in link):
                    fail(400, "資料リンクは認証情報を含まないhttps URLを指定してください。")
            refs = entry.get("attachments", [])
            if not isinstance(refs, list) or len(refs) > 10 or any(not isinstance(ref, str) for ref in refs):
                fail(400, "1資料の添付は10件以内で指定してください。")
            if len(set(refs)) != len(refs):
                fail(400, "添付が重複しています。")
            value = {"id": identifier, "kind": entry["kind"],
                     "title": text(entry, "title", 100), "body": text(entry, "body", 10000, False),
                     "url": link, "attachments": [uid(ref) for ref in refs]}
            if not value["body"] and not link and not refs:
                fail(400, "本文・リンク・添付のいずれかを指定してください。")
            for ref in refs:
                if ref in assets:
                    continue
                if len(assets) >= MAX_ASSETS:
                    fail(400, "1台の添付は合計50件以内で指定してください。")
                if ref in current["assets"]:
                    assets[ref] = current["assets"][ref]
                else:
                    ticket = self.ticket(ref)
                    if ticket["author"] != self.author:
                        fail(403, "別の人の未保存添付は追加できません。")
                    try:
                        S3.head_object(Bucket=self.bucket, Key=self.file_key(ref, ticket["type"]))
                    except ClientError as error:
                        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                            fail(409, "添付を確定してから保存してください。")
                        raise
                    assets[ref] = self.asset_info(ticket)
            previous = old.get(identifier)
            unchanged = previous and all(previous.get(key) == val for key, val in value.items())
            value["updatedAt"] = previous["updatedAt"] if unchanged else now
            value["updatedBy"] = previous["updatedBy"] if unchanged else self.author
            normalized.append(value)
        data = {"machineId": self.machine, "entries": normalized, "assets": assets,
                "updatedAt": now, "updatedBy": self.author}
        put_json(self.bucket, self.record_key, data, revision)
        return {"saved": True}

    def file(self, req):
        asset = uid(req.get("id"))
        record, _ = self.record()
        info = record["assets"].get(asset)
        if not info:
            fail(404, "保存済み資料の添付が見つかりません。")
        url = S3.generate_presigned_url(
            "get_object", Params={
                "Bucket": self.bucket, "Key": self.file_key(asset, info["type"]),
                "ResponseContentType": info["type"],
                "ResponseContentDisposition": "inline; filename*=UTF-8''" + quote(info["name"], safe=""),
                "ResponseCacheControl": "private, no-store",
            }, ExpiresIn=300,
        )
        return {"url": url, "expiresIn": 300}


def body(event):
    try:
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        if len(raw.encode("utf-8")) > 512 * 1024:
            fail(400, "リクエストが大きすぎます。")
        value = json.loads(raw)
        if not isinstance(value, dict):
            fail(400, "JSONオブジェクトが必要です。")
        return value
    except (ValueError, UnicodeError):
        fail(400, "JSONが不正です。")


def lambda_handler(event, context):
    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        if (claims.get("token_use") != "access" or claims.get("client_id") != core.CLIENT_ID
                or claims.get("iss") != core.ISSUER or not claims.get("sub")
                or "openid" not in claims.get("scope", "").split()):
            fail(401, "ログインが必要です。")
        groups = core.user_groups(claims)
        if not groups & {"admin", "family", "worker"}:
            fail(403, "機械資料を閲覧する権限がありません。")
        can_edit = bool(groups & {"admin", "family"})
        route = event.get("routeKey")
        if route not in ("GET /machines", "POST /machines"):
            fail(404, "不明なルートです。")
        req = body(event) if route == "POST /machines" else event.get("queryStringParameters") or {}
        if route == "POST /machines" and req.get("action") != "file" and not can_edit:
            fail(403, "機械資料の編集は家族・管理者のみ可能です。")
        master = machines()
        machine = req.get("machine")
        if route == "GET /machines" and machine is None:
            return core.response(200, {"machines": master, "canEdit": can_edit})
        if not isinstance(machine, str) or not any(item["id"] == machine for item in master):
            fail(404, "機械が見つかりません。機械一覧から選択してください。")
        service = Service(machine, claims["sub"])
        if route == "GET /machines":
            record, revision = service.record()
            return core.response(200, {"record": record, "revision": revision, "canEdit": can_edit,
                                       "machine": next(item for item in master if item["id"] == machine)})
        action = req.get("action")
        if action not in ("save", "upload", "complete", "file"):
            fail(400, "操作が不正です。")
        return core.response(200, getattr(service, action)(req))
    except core.RequestError as error:
        LOGGER.warning("Machine library request rejected: %s", error.status)
        return core.response(error.status, {"message": error.message})
    except ClientError as error:
        LOGGER.error("Machine library AWS failure: %s", error.response["Error"]["Code"])
        return core.response(500, {"message": "AWS保存・取得に失敗しました。再取得し、アクセス権限を確認してください。"})
    except (ValueError, KeyError, TypeError, AttributeError):
        LOGGER.error("Machine library data/configuration invalid")
        return core.response(500, {"message": "機械資料の設定・保存形式が不正です。管理者に確認してください。"})
