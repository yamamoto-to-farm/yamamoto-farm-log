"""Approved LINE account links and durable, administrator-confirmed deliveries."""

import base64
import copy
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError
import line_webhook
import work_plans as core

LOGGER = logging.getLogger(__name__)
SSM = boto3.client("ssm")
USER_ID = re.compile(r"U[0-9a-f]{32}")
CONFLICTS = {"PreconditionFailed", "ConditionalRequestConflict", "409", "412"}
LINK_PREFIX = "LINK "


def fail(status, message):
    raise core.RequestError(status, message)


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def identifier(value):
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError
    except ValueError:
        fail(400, "識別子が不正です。")
    return value


def read_json(bucket, key, initial):
    try:
        result = core.S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return copy.deepcopy(initial), None
        raise
    with result["Body"] as stream:
        return json.loads(stream.read().decode("utf-8")), result["ETag"]


def put_json(bucket, key, data, revision):
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if len(raw) > 2 * 1024 * 1024:
        fail(409, "保存上限です。管理者に連絡してください（送信処理を停止しました）。")
    try:
        core.S3.put_object(
            Bucket=bucket, Key=key, Body=raw,
            ContentType="application/json; charset=utf-8",
            **({"IfMatch": revision} if revision else {"IfNoneMatch": "*"}),
        )
    except ClientError as error:
        if error.response["Error"]["Code"] in CONFLICTS:
            fail(409, "別の操作と競合しました。最新状態を取得して再試行してください。")
        raise


def credentials(name):
    return SSM.get_parameter(
        Name="/yamamoto-farm/line/" + name, WithDecryption=True
    )["Parameter"]["Value"]


def line_request(path, data=None, retry_key=None):
    headers = {"Authorization": "Bearer " + credentials("channel-access-token")}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if retry_key:
        headers["X-Line-Retry-Key"] = retry_key
    request = Request(
        "https://api.line.me/v2/bot/" + path,
        data=json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None,
        headers=headers, method="POST" if data is not None else "GET",
    )
    with urlopen(request, timeout=8) as result:
        return json.loads(result.read().decode("utf-8"))


def workers():
    data, revision = read_json(os.environ["WORKERS_BUCKET"], "data/workers.json", None)
    if not revision or not isinstance(data, list):
        fail(500, "作業者マスタを取得できません。")
    selected = [item for item in data if item.get("role") in ("worker", "family")
                and item.get("active") is not False]
    if (any(not isinstance(item.get("name"), str) or not item["name"]
            or not isinstance(item.get("display"), str) or not item["display"]
            for item in selected)
            or len({item["name"] for item in selected}) != len(selected)
            or len({item["display"] for item in selected}) != len(selected)):
        fail(500, "作業者マスタが曖昧です。氏名と識別名を確認してください。")
    return selected


class Service:
    def __init__(self):
        self.bucket = os.environ["SHIFT_BUCKET"]
        prefix = os.environ.get("SHIFT_PREFIX", "shift/")
        if not prefix or prefix.startswith("/") or not prefix.endswith("/"):
            fail(500, "SHIFT_PREFIX が不正です。")
        self.prefix = prefix
        self.state_key = prefix + "line/links.json"

    def links(self):
        return read_json(self.bucket, self.state_key, {"members": {}})

    def day(self, date):
        key = self.prefix + f"line/deliveries/{date}.json"
        data, revision = read_json(self.bucket, key, {"jobs": {}})
        return key, data, revision

    def plans(self, date):
        return core.read_work_plans(
            self.bucket, self.prefix + f"work-plans/{date}.json", date
        )

    def webhook(self, event):
        events = line_webhook.verified_events(event)
        for item in events:
            if not isinstance(item, dict):
                fail(400, "イベントが不正です。")
            source, message = item.get("source", {}), item.get("message", {})
            if not isinstance(source, dict) or not isinstance(message, dict):
                fail(400, "イベントの送信元・本文が不正です。")
            if item.get("type") == "unfollow" and source.get("type") == "user":
                state, revision = self.links()
                for member in state["members"].values():
                    if member.get("user_id") == source.get("userId"):
                        member["blocked"] = True
                put_json(self.bucket, self.state_key, state, revision)
                continue
            text = message.get("text") if isinstance(message, dict) else None
            if (item.get("type") != "message" or not isinstance(text, str)
                    or not text.startswith(LINK_PREFIX)):
                continue
            uid = source.get("userId")
            if source.get("type") != "user" or not isinstance(uid, str) or not USER_ID.fullmatch(uid):
                fail(400, "登録は個人チャットから送ってください。")
            code_hash = hashlib.sha256(text[len(LINK_PREFIX):].encode("utf-8")).hexdigest()
            state, revision = self.links()
            matches = [member for member in state["members"].values()
                       if hmac.compare_digest(code_hash, member.get("code_hash", ""))]
            if len(matches) != 1:
                fail(403, "登録コードが一致しません。")
            member = matches[0]
            if member.get("pending", {}).get("user_id") == uid:
                continue
            if member.get("user_id") or member.get("pending") or time.time() >= member["expires_at"]:
                fail(409, "登録コードは期限切れ、または使用済みです。")
            if any(uid == other.get("user_id") or uid == other.get("pending", {}).get("user_id")
                   for other in state["members"].values()):
                fail(409, "このLINEはすでに別の作業者に登録されています。")
            profile = line_request("profile/" + uid)
            name = profile.get("displayName")
            if not isinstance(name, str) or not name.strip():
                fail(502, "LINE表示名を確認できませんでした。")
            member["pending"] = {
                "id": str(uuid.uuid4()), "user_id": uid,
                "display_name": name[:200], "received_at": stamp(),
            }
            put_json(self.bucket, self.state_key, state, revision)
        return {"received": True}

    def public_job(self, job):
        return {key: copy.deepcopy(job[key]) for key in
                ("id", "date", "message", "names", "targets", "created_at", "closed", "recorded")} | {
                    "results": {name: {key: value for key, value in result.items()
                                     if key not in ("user_id", "retry_key")}
                                for name, result in job["results"].items()}
                }

    def state(self, date):
        state, _ = self.links()
        members = []
        for worker in workers():
            saved = state["members"].get(worker["name"], {})
            pending = saved.get("pending")
            members.append({
                "worker": worker["name"], "name": worker["display"],
                "linked": bool(saved.get("user_id")), "blocked": saved.get("blocked", False),
                "display_name": saved.get("display_name", ""),
                "pending": ({key: pending[key] for key in ("id", "display_name", "received_at")}
                            if pending else None),
                "expires_at": saved.get("expires_at"),
            })
        _, day, _ = self.day(date)
        return {"members": members, "jobs": [self.public_job(job) for job in day["jobs"].values()]}

    def registration(self, req, author):
        worker = next((worker for worker in workers() if worker["name"] == req.get("worker")), None)
        if worker is None:
            fail(400, "有効な作業者（パート・家族）を選択してください。")
        state, revision = self.links()
        members = state["members"]
        member = members.setdefault(worker["name"], {})
        action = req["action"]
        if action == "issue":
            if member.get("user_id"):
                fail(409, "登録済みです。変更する場合は先に解除してください。")
            code = secrets.token_urlsafe(24)
            members[worker["name"]] = {
                "code_hash": hashlib.sha256(code.encode("ascii")).hexdigest(),
                "expires_at": int(time.time()) + 900, "issued_by": author,
            }
            put_json(self.bucket, self.state_key, state, revision)
            return {"registration_message": LINK_PREFIX + code, "expires_in_seconds": 900}
        if action == "approve":
            pending = member.get("pending")
            if not pending or pending["id"] != req.get("pending_id") or member.get("user_id"):
                fail(409, "承認待ちの内容が変わりました。再取得してください。")
            if any(other.get("user_id") == pending["user_id"] for other in members.values()):
                fail(409, "このLINEは別の作業者に登録済みです。")
            members[worker["name"]] = {
                "user_id": pending["user_id"], "display_name": pending["display_name"],
                "approved_by": author, "approved_at": stamp(), "blocked": False,
            }
        elif action == "unlink":
            if req.get("confirm") is not True:
                fail(400, "解除の確認が必要です。")
            members[worker["name"]] = {}
        else:
            fail(400, "登録操作が不正です。")
        put_json(self.bucket, self.state_key, state, revision)
        return {"saved": True}

    def validate_group(self, req):
        date = core.plan_date(req.get("date"))
        record, _ = self.plans(date)
        targets, names = req.get("targets"), req.get("names")
        if (not isinstance(targets, list) or not 1 <= len(targets) <= 100
                or any(not isinstance(target, dict) or set(target) != {"id", "plan_revision"}
                       or not isinstance(target["id"], str) or not isinstance(target["plan_revision"], str)
                       for target in targets)
                or len({target["id"] for target in targets}) != len(targets)
                or not isinstance(names, list) or not 1 <= len(names) <= 30
                or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names)):
            fail(400, "宛先・対象予定が不正です。")
        plans = record["plans"]
        ids = {core.work_plan_id(target["id"]) for target in targets}
        for target in targets:
            plan = plans.get(target["id"])
            if not plan or plan.get("updated_at") != target["plan_revision"]:
                fail(409, "予定が変更されました。予定を再取得して文面を確認してください。")
            if not set(names) <= set(plan["recipients"]):
                fail(400, "宛先が予定の連絡対象に含まれていません。")
            if not plan["off"]:
                if (not plan.get("attendance") or not plan["blocks"]
                        or any(not block["start"] or not block["end"]
                               or not (block["shed"] or block["fields"]) for block in plan["blocks"])
                        or (plan["kind"] == "2" and plan["reporter"] not in plan["recipients"])):
                    fail(400, "予定の勤務時間・圃場・連絡係を確認してください。")
        signatures = []
        for name in names:
            if {pid for pid, plan in plans.items() if name in plan["recipients"]} != ids:
                fail(409, "宛先の予定が追加・変更されました。予定を再取得してください。")
            signatures.append([
                [plan.get("attendance", {}).get(name, []),
                 [block.get("participation", {}).get(name, []) for block in plan["blocks"]]]
                for pid, plan in sorted(plans.items()) if pid in ids
            ])
        if any(signature != signatures[0] for signature in signatures):
            fail(400, "参加時間が違う宛先は別々のカードで送信してください。")
        return date, [core.plan_snapshot(plans[target["id"]]) for target in targets]

    def prepare(self, req, author):
        date, snapshots = self.validate_group(req)
        text = req.get("message")
        if not isinstance(text, str) or not text.strip() or len(text.encode("utf-16-le")) // 2 > 5000:
            fail(400, "LINE送信文面は空欄不可・5000文字以内です。長文はコピーで送ってください。")
        state, _ = self.links()
        master = {worker["display"]: worker["name"] for worker in workers()}
        results = {}
        for name in req["names"]:
            worker = master.get(name)
            member = state["members"].get(worker, {})
            if not worker or not member.get("user_id") or member.get("blocked"):
                fail(409, f"{name} のLINEが未登録、またはブロックされています。登録状態を確認してください。")
            results[name] = {
                "worker": worker, "user_id": member["user_id"], "status": "ready",
                "retry_key": str(uuid.uuid4()), "first_attempt": None, "error": "",
            }
        key, day, revision = self.day(date)
        ids = sorted(target["id"] for target in req["targets"])
        relevant = [job for job in day["jobs"].values() if set(job["names"]) & set(req["names"])]
        for job in relevant:
            if not job["closed"] and not job["recorded"]:
                if (sorted(job["names"]) == sorted(req["names"])
                        and sorted(target["id"] for target in job["targets"]) == ids
                        and job["message"] == text and job["targets"] == req["targets"]):
                    return self.public_job(job)
                fail(409, "この宛先には未完了の送信があります。下の送信履歴から確認・再試行または終了してください。")
        if relevant and req.get("confirm_resend") is not True:
            fail(409, "過去の送信があります。再連絡の確認をしてから準備してください。")
        if len(day["jobs"]) >= 100:
            fail(409, "この日の送信準備が上限に達しました。")
        job = {
            "id": str(uuid.uuid4()), "date": date, "message": text,
            "names": req["names"], "targets": req["targets"], "snapshots": snapshots,
            "created_at": stamp(), "author": author, "results": results,
            "closed": False, "recorded": False,
        }
        day["jobs"][job["id"]] = job
        put_json(self.bucket, key, day, revision)
        return self.public_job(job)

    def record_history(self, job):
        date = job["date"]
        key = self.prefix + f"work-plans/{date}.json"
        for _ in range(3):
            record, revision = self.plans(date)
            at = max(result["accepted_at"] for result in job["results"].values())
            for snapshot in job["snapshots"]:
                cid = str(uuid.uuid5(uuid.UUID(job["id"]), snapshot["id"]))
                if not any(item["id"] == cid for item in record["communications"]):
                    record["communications"].append({
                        "id": cid, "plan_id": snapshot["id"], "status": "sent", "at": at,
                        "author": job["author"], "plan": snapshot,
                        "plan_revision": snapshot["updated_at"], "message": job["message"],
                        "recipients": job["names"],
                    })
            record["communications"].sort(key=lambda item: core.validate_timestamp(item["at"]))
            core.apply_communication_metadata(record["plans"], record["communications"])
            record["people"] = core.project_work_plans(record["plans"])
            record["updated_at"] = stamp()
            core.validate_communications(record["communications"])
            try:
                put_json(self.bucket, key, record, revision)
                return
            except core.RequestError as error:
                if error.status != 409:
                    raise
        fail(409, "送信受付済みですが、予定の控えが競合しました。履歴から再試行してください（再送信しません）。")

    def send(self, req, closing=False):
        date = core.plan_date(req.get("date"))
        jid = identifier(req.get("job_id"))
        key, day, revision = self.day(date)
        job = day["jobs"].get(jid)
        if job is None:
            fail(404, "送信準備が見つかりません。")
        if closing:
            if any(result["status"] == "unknown" for result in job["results"].values()):
                fail(409, "送信結果が不明です。先に同じ送信の再確認をしてください。")
            if all(result["status"] == "accepted" for result in job["results"].values()) and not job["recorded"]:
                fail(409, "全員受付済みですが控えが未保存です。先に同じ履歴から再試行してください。")
            if req.get("confirm") is not True:
                fail(400, "終了の確認が必要です。")
            job["closed"] = True
            put_json(self.bucket, key, day, revision)
            return self.public_job(job)
        if job["closed"]:
            fail(409, "終了した送信です。")
        requested_name = req.get("name")
        if requested_name not in job["names"]:
            fail(400, "送信する宛先を指定してください。")
        for name in [requested_name]:
            key, day, revision = self.day(date)
            job = day["jobs"][jid]
            result = job["results"][name]
            if job["closed"]:
                fail(409, "別の端末で終了されました。")
            if result["status"] == "accepted":
                continue
            if result["first_attempt"] is not None and time.time() - result["first_attempt"] >= 23 * 3600:
                fail(409, "再試行の安全期限を超えました。到着を手動確認してください。新規送信は行いません。")
            state, _ = self.links()
            member = state["members"].get(result["worker"], {})
            active = {worker["display"]: worker["name"] for worker in workers()}
            if (member.get("user_id") != result["user_id"] or member.get("blocked")
                    or active.get(name) != result["worker"]):
                fail(409, "宛先の登録状態が変わりました。未送信分は停止しました。")
            if result["status"] != "unknown":
                self.validate_group(job)
            result.update(status="unknown", first_attempt=result["first_attempt"] or time.time(),
                          error="送信結果を確認中。同じ送信として再試行してください。")
            put_json(self.bucket, key, day, revision)
            outcome, message = "unknown", "通信結果が不明です。同じ送信を再試行してください。"
            accepted = False
            try:
                line_request("message/push", {
                    "to": result["user_id"], "messages": [{"type": "text", "text": job["message"]}],
                }, result["retry_key"])
                outcome, message, accepted = "accepted", "", True
            except HTTPError as error:
                code = error.code
                duplicate = code == 409 and error.headers.get("x-line-accepted-request-id")
                error.close()
                if duplicate:
                    outcome, message, accepted = "accepted", "", True
                else:
                    outcome = "unknown" if code >= 500 else "failed"
                    message = f"LINE HTTP {code}。登録・トークン・通数を確認し、同じ送信を再試行してください。"
                    LOGGER.warning("LINE send rejected: HTTP %s", code)
            except (URLError, TimeoutError, ValueError):
                LOGGER.warning("LINE send outcome is unknown")
            for _ in range(3):
                key, day, revision = self.day(date)
                saved = day["jobs"][jid]["results"][name]
                if saved["status"] == "accepted":
                    break
                saved.update(status=outcome, error=message)
                if accepted:
                    saved["accepted_at"] = stamp()
                try:
                    put_json(self.bucket, key, day, revision)
                    break
                except core.RequestError as error:
                    if error.status != 409:
                        raise
            else:
                fail(409, "結果の保存が競合しました。送信履歴を再取得してください。")
        key, day, revision = self.day(date)
        job = day["jobs"][jid]
        if all(result["status"] == "accepted" for result in job["results"].values()) and not job["recorded"]:
            self.record_history(job)
            job["recorded"] = True
            put_json(self.bucket, key, day, revision)
        return self.public_job(job)


def request_body(event):
    try:
        raw = event.get("body") or ""
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        if len(raw.encode("utf-8")) > 65536:
            fail(400, "リクエストが大きすぎます。")
        req = json.loads(raw)
        if not isinstance(req, dict):
            fail(400, "JSONオブジェクトが必要です。")
        return req
    except (ValueError, UnicodeError):
        fail(400, "JSONが不正です。")


def lambda_handler(event, context):
    try:
        service = Service()
        route = event.get("routeKey")
        if route == "POST /line/webhook" and event.get("rawPath") == "/line/webhook":
            return core.response(200, service.webhook(event))
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        if (claims.get("token_use") != "access" or claims.get("client_id") != core.CLIENT_ID
                or claims.get("iss") != core.ISSUER or not claims.get("sub")
                or "openid" not in claims.get("scope", "").split()):
            fail(401, "ログインが必要です。")
        if not core.user_groups(claims) & core.ALLOWED_GROUPS:
            fail(403, "LINE連絡を管理する権限がありません。")
        if route == "GET /line/manage":
            date = core.plan_date((event.get("queryStringParameters") or {}).get("date"))
            return core.response(200, service.state(date))
        if route != "POST /line/manage":
            fail(404, "不明なルートです。")
        req = request_body(event)
        action = req.get("action")
        author = claims.get("username") or claims["sub"]
        if action in ("issue", "approve", "unlink"):
            result = service.registration(req, author)
        elif action == "prepare":
            result = service.prepare(req, author)
        elif action in ("send", "close"):
            result = service.send(req, closing=action == "close")
        else:
            fail(400, "操作が不正です。")
        return core.response(200, result)
    except line_webhook.RequestError as error:
        LOGGER.warning("LINE signature/event rejected: %s", error.status)
        return core.response(error.status, {"message": str(error)})
    except core.RequestError as error:
        LOGGER.warning("LINE operation rejected: %s", error.status)
        return core.response(error.status, {"message": error.message})
    except (URLError, TimeoutError, HTTPError):
        LOGGER.error("LINE profile/API unavailable")
        return core.response(502, {"message": "LINE APIへ接続できません。設定を確認して再試行してください。"})
    except ClientError as error:
        LOGGER.error("LINE AWS operation failed: %s", error.response["Error"]["Code"])
        return core.response(500, {"message": "AWS保存・取得に失敗しました。履歴を再取得し、IAM設定を確認してください。"})
    except (ValueError, KeyError, TypeError, AttributeError):
        LOGGER.error("LINE configuration or event format invalid")
        return core.response(500, {"message": "設定またはデータ形式が不正です。管理者に確認してください。"})
