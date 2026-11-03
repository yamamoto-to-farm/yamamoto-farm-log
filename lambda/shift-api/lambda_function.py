"""シフト案 読み取り・設定編集API（Cognito JWT保護・admin/familyグループ限定）.

HTTP API（payload 2.0）のルート:
  GET  /shift/plan       … 最新（または ?month=YYYY-MM）の plan.json を返す。
                           ?month=YYYY-MM&run=list でその月のスナップショット一覧、
                           &run=<日時> で生成実行時点のスナップショット plan.json を返す
  GET  /shift/months     … 保存済みの月の一覧を返す
  GET  /shift/config     … スタッフマスタ（config.json）を返す
  POST /shift/config     … 検証して config.json を保存（保存前に config-backups/ へ退避）
  POST /shift/regenerate … 生成 Lambda を非同期で起動して案を再計算（body: {"month": "YYYY-MM"} 任意）
  GET  /shift/edits      … 月の編集データ（個別編集・基本時間帯・チェック状態）を返す（?month= 必須）
  POST /shift/edits      … 月の編集データを保存（body: {"month", "data"}。端末間で共有される）
  GET  /shift/work-plans … 日別の連絡用予定と更新リビジョンを取得（?date=YYYY-MM-DD）
  POST /shift/work-plans … 予定の保存・削除・コピー履歴の追記（競合時409）

時給を含むため、photos と同じ Cognito プールの検証済みクレームに加えて、
cognito:groups に admin または family が必要（worker には返さない）。

環境変数:
  SHIFT_BUCKET  … 非公開バケット名（必須）
  SHIFT_PREFIX  … キーの接頭辞（既定 "shift/"）
  PLAN_FUNCTION … 生成 Lambda の関数名（再計算に必要。例 yamamoto-farm-shift-plan）
"""
import base64
import copy
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
S3 = boto3.client("s3")
CLIENT_ID = "mg1q2dnn576jln28m5sja6eaf"
ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC"
ALLOWED_GROUPS = {"admin", "family"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
RUN_RE = re.compile(r"^\d{8}-\d{6}$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
WEEKDAYS = set("月火水木金土日")
MAX_CONFIG_BYTES = 32768


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


def list_runs(bucket, prefix, month):
    """生成実行ごとのスナップショット（<prefix><月>/runs/<日時>/）の日時一覧"""
    runs, token = [], None
    base = f"{prefix}{month}/runs/"
    while True:
        kw = {"Bucket": bucket, "Prefix": base, "Delimiter": "/"}
        if token:
            kw["ContinuationToken"] = token
        listing = S3.list_objects_v2(**kw)
        for item in listing.get("CommonPrefixes", []):
            name = item["Prefix"][len(base):].rstrip("/")
            if RUN_RE.fullmatch(name):
                runs.append(name)
        token = listing.get("NextContinuationToken")
        if not token:
            return sorted(runs, reverse=True)


def _num(cfg, key, minimum=0):
    value = cfg.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= minimum:
        raise RequestError(400, f"{key} は {minimum} より大きい数値にしてください。")
    return value


def _time(value, label):
    if not isinstance(value, str) or not TIME_RE.fullmatch(value):
        raise RequestError(400, f"{label} は HH:MM 形式で入力してください。")


def _window(cfg, key):
    win = cfg.get(key)
    if not isinstance(win, dict):
        raise RequestError(400, f"{key} が不正です。")
    _time(win.get("start"), f"{key}.start")
    _time(win.get("end"), f"{key}.end")


def validate_config(cfg):
    """スタッフマスタの検証。認証情報キーは除去して返す。"""
    if not isinstance(cfg, dict):
        raise RequestError(400, "JSONオブジェクトを指定してください。")
    cfg = dict(cfg)
    cfg.pop("timetree_email", None)      # 認証情報は Secrets Manager で管理する
    cfg.pop("timetree_password", None)
    for key in ("base_hourly", "hours_per_day_target", "min_work_hours",
                "max_work_hours", "peak_max_work_hours", "flex_all_day_assumed_hours"):
        _num(cfg, key)
    if not cfg["min_work_hours"] <= cfg["max_work_hours"] <= cfg["peak_max_work_hours"]:
        raise RequestError(400, "実働の下限・上限・繁忙期上限の大小関係が不正です。")
    tpd = cfg.get("target_person_days")
    if (not isinstance(tpd, dict)
            or not all(isinstance(tpd.get(k), (int, float)) and tpd.get(k) > 0 for k in ("min", "center", "max"))
            or not tpd["min"] <= tpd["center"] <= tpd["max"]):
        raise RequestError(400, "target_person_days（min/center/max）が不正です。")
    budget = cfg.get("labor_budget_yen")
    if (not isinstance(budget, dict)
            or not all(isinstance(budget.get(k), (int, float)) and budget.get(k) > 0 for k in ("min", "max"))
            or budget["min"] > budget["max"]):
        raise RequestError(400, "labor_budget_yen（min/max）が不正です。")
    commute = cfg.get("commute")
    if (not isinstance(commute, dict)
            or not all(isinstance(commute.get(k), (int, float)) and commute.get(k) >= 0
                       for k in ("per_day", "monthly_cap"))):
        raise RequestError(400, "commute（per_day/monthly_cap）が不正です。")
    brk = cfg.get("break_minutes")
    if (not isinstance(brk, dict)
            or not all(isinstance(brk.get(k), (int, float)) and brk.get(k) >= 0
                       for k in ("not_spanning_noon", "spanning_noon"))):
        raise RequestError(400, "break_minutes が不正です。")
    for key in ("weekly_max_days", "consecutive_max_days"):
        value = cfg.get(key)
        if not isinstance(value, int) or not 1 <= value <= 7:
            raise RequestError(400, f"{key} は 1〜7 の整数にしてください。")
    for key in ("am_default", "pm_default", "allday_default"):
        _window(cfg, key)
    staff = cfg.get("staff")
    if not isinstance(staff, list) or not staff:
        raise RequestError(400, "staff を1人以上設定してください。")
    names = set()
    for i, member in enumerate(staff):
        where = f"staff[{i}]"
        if not isinstance(member, dict):
            raise RequestError(400, f"{where} が不正です。")
        name = member.get("name")
        if not isinstance(name, str) or not name.strip():
            raise RequestError(400, f"{where} の name を入力してください。")
        name = name.strip()
        if name in names:
            raise RequestError(400, f"name「{name}」が重複しています。")
        names.add(name)
        member["name"] = name
        match = member.get("match") or [name]
        if not isinstance(match, list) or not all(isinstance(m, str) and m.strip() for m in match):
            raise RequestError(400, f"{where} の match が不正です。")
        member["match"] = [m.strip() for m in match]
        fw = member.get("fixed_weekdays", [])
        if not isinstance(fw, list) or not set(fw) <= WEEKDAYS:
            raise RequestError(400, f"{where} の fixed_weekdays は 月〜日 で指定してください。")
        hourly = member.get("hourly")
        if not isinstance(hourly, (int, float)) or isinstance(hourly, bool) or hourly <= 0:
            raise RequestError(400, f"{where} の hourly（時給）が不正です。")
        target = member.get("target_days")
        if target is not None and (not isinstance(target, int) or target < 0):
            raise RequestError(400, f"{where} の target_days が不正です。")
        member["protected"] = bool(member.get("protected"))
        latest = member.get("latest_end", {})
        if not isinstance(latest, dict) or not set(latest) <= WEEKDAYS:
            raise RequestError(400, f"{where} の latest_end の曜日が不正です。")
        for wd, tm in latest.items():
            _time(tm, f"{where} の latest_end[{wd}]")
        days = member.get("unavailable_days_of_month", [])
        if not isinstance(days, list) or not all(isinstance(d, int) and 1 <= d <= 31 for d in days):
            raise RequestError(400, f"{where} の unavailable_days_of_month は 1〜31 の数値にしてください。")
        login = member.get("login", "")
        if not isinstance(login, str):
            raise RequestError(400, f"{where} の login（ログイン連携）が不正です。")
        member["login"] = login.strip()   # workers.json の識別名（在籍状況の表示用・任意）
    return cfg


def plan_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise RequestError(400, "date は YYYY-MM-DD 形式で指定してください。")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as error:
        raise RequestError(400, "date が不正です。") from error
    return value


def plan_text(value, label, maximum=200, allow_empty=True):
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()):
        raise RequestError(400, f"{label} が不正です。")
    return value.strip()


def validate_work_plan(plan):
    if not isinstance(plan, dict):
        raise RequestError(400, "plan が不正です。")
    source = plan.get("source", "message")
    if source not in ("message", "direct"):
        raise RequestError(400, "source が不正です。")
    direct = source == "direct"
    names = plan.get("names")
    if not isinstance(names, list) or not 1 <= len(names) <= 20:
        raise RequestError(400, "担当者を1〜20人指定してください。")
    names = [plan_text(name, "担当者", 80, False) for name in names]
    if len(set(names)) != len(names):
        raise RequestError(400, "担当者が重複しています。")
    off = plan.get("off", False if direct else None)
    manual = plan.get("manual_text", False)
    if not isinstance(off, bool) or not isinstance(manual, bool):
        raise RequestError(400, "予定の状態が不正です。")
    kind = plan.get("kind", "1" if direct else None)
    if kind not in ("1", "2", "3"):
        raise RequestError(400, "作業形態が不正です。")
    reporter = plan_text(plan.get("reporter", ""), "連絡係", 80)
    blocks = plan.get("blocks")
    if not isinstance(blocks, list) or len(blocks) > 30 or (not off and not blocks):
        raise RequestError(400, "作業時間帯を指定してください。")
    validated = []
    for block in blocks:
        if not isinstance(block, dict):
            raise RequestError(400, "作業時間帯が不正です。")
        start, end = block.get("start", ""), block.get("end", "")
        if not (start == end == ""):
            for value in (start, end):
                if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                    raise RequestError(400, "時間は HH:MM 形式で指定してください。")
            if start >= end:
                raise RequestError(400, "終了時刻は開始時刻より後にしてください。")
        shed = block.get("shed", False if direct else None)
        if not isinstance(shed, bool):
            raise RequestError(400, "集合場所が不正です。")
        fields = block.get("fields")
        if "fields" in block:
            if not isinstance(fields, list) or len(fields) > 30:
                raise RequestError(400, "圃場が不正です。")
            fields = [plan_text(field, "圃場", 200, False) for field in fields]
        field = plan_text(block.get("field", "" if direct or fields is not None else None), "圃場")
        companions = block.get("companions", [])
        if "companions" in block and kind != "1":
            raise RequestError(400, "同伴者は作業形態1のみ指定できます。")
        if not isinstance(companions, list) or len(companions) > 20:
            raise RequestError(400, "同伴者が不正です。")
        companions = [plan_text(name, "同伴者", 80, False) for name in companions]
        if len(set(companions)) != len(companions) or set(companions) & set(names):
            raise RequestError(400, "同伴者が重複しています。")
        item = {
            "start": start, "end": end,
            "field": field,
            "task": plan_text(block.get("task"), "作業内容", 200, False),
            "shed": shed,
        }
        if fields is not None:
            item["fields"] = fields
        if "companions" in block:
            item["companions"] = companions
        validated.append(item)
    workers = set(names) | {name for block in validated for name in block.get("companions", [])}
    recipients = validate_recipients(plan.get("recipients", [] if direct else names), workers, allow_empty=True)
    if kind == "2" and not off and reporter not in recipients:
        raise RequestError(400, "連絡係は連絡先から選択してください。")
    message = plan.get("message", "")
    plan_text(message, "コピー文面", 10000)
    return {
        "source": source, "names": names, "recipients": recipients,
        "off": off, "kind": kind, "reporter": reporter,
        "blocks": validated,
        "off_reason": plan_text(plan.get("off_reason", ""), "中止理由", 500),
        "memo": plan_text(plan.get("memo", ""), "メモ", 2000),
        "message": message,
        "manual_text": manual,
    }


def validate_recipients(value, workers, allow_empty=False):
    if not isinstance(value, list) or not (0 if allow_empty else 1) <= len(value) <= 20:
        raise RequestError(400, "連絡先を1〜20人指定してください。")
    names = [plan_text(name, "連絡先", 80, False) for name in value]
    if len(set(names)) != len(names) or not set(names) <= workers:
        raise RequestError(400, "連絡先は予定の担当者・同伴者から重複なく選択してください。")
    return names


def plan_snapshot(plan):
    return copy.deepcopy({key: value for key, value in plan.items()
                          if key not in ("last_communication", "communication_changed", "communications")})


def apply_communication_metadata(plans, communications):
    for identifier, plan in plans.items():
        history = [item for item in communications if item["plan_id"] == identifier]
        last = history[-1] if history else None
        plan["last_communication"] = ({
            "status": last["status"], "at": last["at"], "plan_revision": last["plan_revision"],
        } if last else None)
        plan["communication_changed"] = bool(
            last and validate_work_plan(last["plan"]) != validate_work_plan(plan))


def validate_communications(value):
    if not isinstance(value, list):
        raise RequestError(400, "communications が不正です。")
    seen = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
                "id", "plan_id", "status", "at", "author", "plan",
                "plan_revision", "message", "recipients"}:
            raise RequestError(400, "保存済み連絡履歴が不正です。")
        try:
            identifier = str(uuid.UUID(item["id"]))
        except (ValueError, TypeError, AttributeError) as error:
            raise RequestError(400, "連絡履歴idが不正です。") from error
        if identifier != item["id"] or identifier in seen or item["status"] not in ("copied", "sent"):
            raise RequestError(400, "連絡履歴の状態・idが不正です。")
        seen.add(identifier)
        work_plan_id(item["plan_id"])
        for key in ("at", "plan_revision"):
            validate_timestamp(item[key])
        plan_text(item["author"], "author", 200, False)
        plan_text(item["message"], "message", 10000, False)
        snapshot = item["plan"]
        plan = validate_work_plan(snapshot)
        if (snapshot.get("id") != item["plan_id"]
                or snapshot.get("updated_at") != item["plan_revision"]
                or any(key in snapshot for key in ("communications", "last_communication", "communication_changed"))
                or snapshot != {**plan, "id": item["plan_id"], "updated_at": item["plan_revision"],
                                **({"updated_by": snapshot["updated_by"]} if "updated_by" in snapshot else {})}):
            raise RequestError(400, "連絡履歴の予定が不正です。")
        if "updated_by" in snapshot:
            plan_text(snapshot["updated_by"], "updated_by", 200, False)
        workers = set(plan["names"]) | {name for block in plan["blocks"] for name in block.get("companions", [])}
        validate_recipients(item["recipients"], workers)
    return copy.deepcopy(value)


def validate_timestamp(value):
    plan_text(value, "timestamp", 80, False)
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError("Timezone missing")
    except ValueError as error:
        raise RequestError(400, "timestamp が不正です。") from error
    return parsed


def projection_matches(stored, expected):
    # Old records lack these newly derived/default fields.
    if isinstance(stored, dict) and isinstance(expected, dict):
        optional = {"recipients", "last_communication", "communication_changed"}
        return (not (set(expected) - set(stored) - optional) and not (set(stored) - set(expected))
                and all(projection_matches(value, expected[key]) for key, value in stored.items()
                        if key not in ("last_communication", "communication_changed")))
    if isinstance(stored, list) and isinstance(expected, list):
        return len(stored) == len(expected) and all(projection_matches(a, b) for a, b in zip(stored, expected))
    return stored == expected


def message_plan_id(names):
    encoded = json.dumps(sorted(names), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "message-" + hashlib.sha256(encoded).hexdigest()


def work_plan_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value):
        raise RequestError(400, "id が不正です。")
    return value


def project_work_plans(plans):
    people = {}
    for identifier, plan in plans.items():
        workers = list(plan["names"])
        for block in plan["blocks"]:
            for name in block.get("companions", []):
                if name not in workers:
                    workers.append(name)
        for name in workers:
            blocks = plan["blocks"] if name in plan["names"] else [
                block for block in plan["blocks"] if name in block.get("companions", [])
            ]
            entry = {
                **plan, "id": identifier, "worker": name, "blocks": blocks,
                "source_label": "連絡予定" if plan["source"] == "message" else "直接入力",
            }
            if name not in people:
                people[name] = {**entry, "entries": []}
            people[name]["entries"].append(entry)
    for person in people.values():
        person["off"] = all(entry["off"] for entry in person["entries"])
        person["blocks"] = [block for entry in person["entries"] if not entry["off"] for block in entry["blocks"]]
    return people


def normalize_work_plans(record, date):
    if (not isinstance(record, dict) or record.get("date") != date
            or not isinstance(record.get("people"), dict)):
        raise RuntimeError("Stored work plans are invalid")
    plans = {}
    try:
        communications = validate_communications(record.get("communications", []))
        if "updated_at" in record:
            plan_text(record["updated_at"], "updated_at", 80, False)
        if "plans" in record:
            if not isinstance(record["plans"], dict):
                raise RequestError(400, "plans が不正です。")
            for identifier, stored in record["plans"].items():
                work_plan_id(identifier)
                plan = validate_work_plan(stored)
                if stored.get("id") != identifier:
                    raise RequestError(400, "保存済みidが不正です。")
                plans[identifier] = {**plan, "id": identifier}
                for key in ("updated_at", "updated_by"):
                    if key in stored:
                        plans[identifier][key] = plan_text(stored[key], key, 200, False)
            apply_communication_metadata(plans, communications)
            for stored in record["plans"].values():
                if "communication_changed" in stored and not isinstance(stored["communication_changed"], bool):
                    raise RequestError(400, "保存済み連絡状態が不正です。")
                last = stored.get("last_communication")
                if last is not None:
                    if (not isinstance(last, dict) or set(last) != {"status", "at", "plan_revision"}
                            or last["status"] not in ("copied", "sent")):
                        raise RequestError(400, "保存済み連絡状態が不正です。")
                    validate_timestamp(last["at"])
                    validate_timestamp(last["plan_revision"])
            if not projection_matches(record["people"], project_work_plans(plans)):
                raise RequestError(400, "保存済み担当者データが不正です。")
        else:
            groups = {}
            for name, stored in record["people"].items():
                plan_text(name, "担当者", 80, False)
                plan = validate_work_plan(stored)
                if plan["source"] != "message" or name not in plan["names"] or stored.get("worker") != name:
                    raise RequestError(400, "保存済み担当者が不正です。")
                group = tuple(sorted(plan["names"]))
                if group not in groups:
                    groups[group] = {"plan": plan, "names": [], "metadata": {}}
                if groups[group]["plan"] != plan:
                    raise RequestError(400, "保存済みグループが不正です。")
                groups[group]["names"].append(name)
                for key in ("updated_at", "updated_by"):
                    if key in stored:
                        value = plan_text(stored[key], key, 200, False)
                        groups[group]["metadata"][key] = max(value, groups[group]["metadata"].get(key, ""))
            for group in groups.values():
                plan = {**group["plan"], **group["metadata"]}
                # Legacy per-person overwrites may leave only part of a recipient group.
                plan["names"] = [name for name in plan["names"] if name in group["names"]]
                workers = set(plan["names"]) | {name for block in plan["blocks"] for name in block.get("companions", [])}
                plan["recipients"] = [name for name in plan["recipients"] if name in workers]
                if plan["kind"] == "2" and plan["reporter"] not in plan["names"]:
                    plan["reporter"] = plan["names"][0]
                identifier = message_plan_id(plan["names"])
                if identifier in plans:
                    raise RequestError(400, "保存済みグループが重複しています。")
                plans[identifier] = {**plan, "id": identifier}
        apply_communication_metadata(plans, communications)
    except RequestError as error:
        raise RuntimeError("Stored work plans are invalid") from error
    return {
        "date": date, "plans": plans, "people": project_work_plans(plans),
        "updated_at": record.get("updated_at"), "communications": communications,
    }


def read_work_plans(bucket, key, date):
    try:
        result = S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return {"date": date, "plans": {}, "people": {}, "updated_at": None, "communications": []}, None
        raise
    with result["Body"] as stream:
        record = json.loads(stream.read().decode("utf-8"))
    return normalize_work_plans(record, date), result["ETag"]


def work_plans_route(event, bucket, prefix, claims):
    if event["routeKey"] == "GET /shift/work-plans":
        date = plan_date((event.get("queryStringParameters") or {}).get("date"))
        record, revision = read_work_plans(bucket, f"{prefix}work-plans/{date}.json", date)
        return response(200, {"date": date, "revision": revision, "data": record})
    raw = event.get("body") or ""
    try:
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        if len(raw.encode("utf-8")) > 65536:
            raise RequestError(400, "予定データが大きすぎます。")
        req = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise RequestError(400, "JSONが不正です。") from error
    if not isinstance(req, dict):
        raise RequestError(400, "JSONオブジェクトを指定してください。")
    date = plan_date(req.get("date"))
    if "revision" not in req or (req["revision"] is not None and
                                (not isinstance(req["revision"], str) or not re.fullmatch(r'"[a-fA-F0-9]{32}"', req["revision"]))):
        raise RequestError(400, "revision が不正です。")
    operation = req.get("operation", "upsert")
    if operation not in ("upsert", "delete", "communicate"):
        raise RequestError(400, "operation が不正です。")
    identifier = work_plan_id(req["id"]) if "id" in req else None
    copies = req.get("copies") if operation == "communicate" else None
    if operation == "communicate" and "copies" in req:
        if (identifier is not None or not isinstance(copies, list) or not 1 <= len(copies) <= 100
                or any(not isinstance(item, dict) or set(item) != {"id", "plan_revision"} for item in copies)):
            raise RequestError(400, "copies に予定idと更新版を指定してください。")
        copy_ids = [work_plan_id(item["id"]) for item in copies]
        if len(set(copy_ids)) != len(copy_ids):
            raise RequestError(400, "copies の予定idが重複しています。")
    if operation != "upsert" and identifier is None and copies is None:
        raise RequestError(400, "予定のidを指定してください。")
    if operation == "communicate" and ("status" in req or "communication" in req):
        raise RequestError(400, "クライアントは連絡の送信状態を指定できません。")
    plan = validate_work_plan(req.get("plan")) if operation == "upsert" else None
    key = f"{prefix}work-plans/{date}.json"
    record, revision = read_work_plans(bucket, key, date)
    if req["revision"] != revision:
        raise RequestError(409, "別の端末で予定が更新されました。内容を確認して再度コピーしてください。")
    now = datetime.now(timezone.utc)
    if record["updated_at"]:
        previous = validate_timestamp(record["updated_at"])
        now = max(now, previous + timedelta(microseconds=1))
    stamp = now.isoformat(timespec="microseconds")
    author = claims.get("username") or claims["sub"]
    plans = record["plans"]
    if identifier is not None and identifier not in plans:
        raise RequestError(404, "指定された予定がありません。")
    communications = record["communications"]
    communication = None
    if operation == "communicate":
        targets = copies if copies is not None else [{"id": identifier, "plan_revision": req.get("plan_revision")}]
        message = req.get("message")
        plan_text(message, "コピー文面", 10000, False)
        pending = []
        names = []
        for target in targets:
            current = plans.get(target["id"])
            if current is None:
                raise RequestError(404, "指定された予定がありません。")
            if target["plan_revision"] != current.get("updated_at") or not target["plan_revision"]:
                raise RequestError(409, "予定が更新されました。最新の予定を確認して再度コピーしてください。")
            validate_timestamp(target["plan_revision"])
            workers = set(current["names"]) | {name for block in current["blocks"] for name in block.get("companions", [])}
            recipients = validate_recipients(req.get("recipients"), workers)
            pending.append({
                "id": str(uuid.uuid4()), "plan_id": target["id"], "status": "copied",
                "at": stamp, "author": author, "plan": plan_snapshot(current),
                "plan_revision": target["plan_revision"], "message": message, "recipients": recipients,
            })
            names.extend(name for name in current["names"] if name not in names)
        communications.extend(pending)
        communication = pending[0]
    elif operation == "delete":
        history = [item for item in communications if item["plan_id"] == identifier]
        if any(item["status"] == "sent" for item in history):
            raise RequestError(409, "送信済みの予定は削除できません。中止として保存してください。")
        if history and req.get("confirm_copied") is not True:
            raise RequestError(409, "コピー済みの予定です。履歴を残して削除するには confirm_copied:true が必要です。")
        names = plans.pop(identifier)["names"]
    else:
        if identifier is not None and plans[identifier]["source"] != plan["source"]:
            raise RequestError(400, "予定のsourceは変更できません。")
        if identifier is None:
            if plan["source"] == "message":
                identifier = message_plan_id(plan["names"])
                protected = {item["plan_id"] for item in communications}
                if any(old["source"] == "message" and set(old["names"]) & set(plan["names"])
                       and old_id in protected for old_id, old in plans.items()):
                    raise RequestError(409, "連絡履歴のある予定はidを指定して編集してください。")
                for old_id, old in list(plans.items()):
                    if old["source"] != "message" or old_id == identifier:
                        continue
                    remaining = [name for name in old["names"] if name not in plan["names"]]
                    if not remaining:
                        del plans[old_id]
                    elif remaining != old["names"]:
                        old["names"] = remaining
                        workers = set(remaining) | {name for block in old["blocks"] for name in block.get("companions", [])}
                        old["recipients"] = [name for name in old["recipients"] if name in workers]
                        if old["kind"] == "2" and old["reporter"] not in remaining:
                            old["reporter"] = remaining[0]
                        old.update(updated_at=stamp, updated_by=author)
                if identifier in plans and plans[identifier]["source"] != "message":
                    raise RequestError(400, "予定のsourceは変更できません。")
            else:
                identifier = "direct-" + uuid.uuid4().hex
        names = plan["names"]
        plans[identifier] = {
            **plan, "id": identifier, "updated_at": stamp, "updated_by": author,
        }
    apply_communication_metadata(plans, communications)
    record["people"] = project_work_plans(plans)
    record["updated_at"] = stamp
    condition = {"IfMatch": revision} if revision else {"IfNoneMatch": "*"}
    try:
        S3.put_object(
            Bucket=bucket, Key=key,
            Body=json.dumps(record, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json; charset=utf-8", **condition,
        )
    except ClientError as error:
        if error.response["Error"]["Code"] in ("PreconditionFailed", "ConditionalRequestConflict", "409", "412"):
            raise RequestError(409, "保存中に予定が更新されました。内容を確認して再度コピーしてください。") from error
        raise
    result = {"saved": True, "date": date, "id": identifier, "names": names, "updated_at": stamp}
    if communication:
        result["communication"] = communication
    return response(200, result)


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

        if route in ("GET /shift/work-plans", "POST /shift/work-plans"):
            return work_plans_route(event, bucket, prefix, claims)

        if route == "GET /shift/months":
            return response(200, {"months": list_months(bucket, prefix)})

        if route == "GET /shift/config":
            try:
                result = S3.get_object(Bucket=bucket, Key=prefix + "config.json")
            except ClientError as error:
                if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    raise RequestError(404, "config.json がまだありません。") from error
                raise
            with result["Body"] as stream:
                return raw_json_response(stream.read().decode("utf-8"))

        if route == "POST /shift/config":
            raw = event.get("body") or ""
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            if len(raw) > MAX_CONFIG_BYTES:
                raise RequestError(400, "設定が大きすぎます。")
            try:
                cfg = json.loads(raw)
            except (ValueError, TypeError) as error:
                raise RequestError(400, "JSONが不正です。") from error
            cfg = validate_config(cfg)
            # 保存前に現行の設定を退避する
            key = prefix + "config.json"
            try:
                current = S3.get_object(Bucket=bucket, Key=key)
                with current["Body"] as stream:
                    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                    S3.put_object(Bucket=bucket, Key=f"{prefix}config-backups/config-{stamp}.json",
                                  Body=stream.read(), ContentType="application/json; charset=utf-8")
            except ClientError as error:
                if error.response["Error"]["Code"] not in ("NoSuchKey", "404"):
                    raise
            body = json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
            S3.put_object(Bucket=bucket, Key=key, Body=body.encode("utf-8"),
                          ContentType="application/json; charset=utf-8")
            LOGGER.info("config.json updated by %s", claims.get("username") or claims.get("sub"))
            return response(200, {"saved": True, "staff": len(cfg["staff"]),
                                  "note": "次回の自動生成（毎月26日）から反映されます。"})

        if route == "POST /shift/regenerate":
            function_name = os.environ.get("PLAN_FUNCTION")
            if not function_name:
                raise RequestError(500, "再計算用の Lambda（PLAN_FUNCTION）が設定されていません。")
            raw = event.get("body") or "{}"
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            try:
                req = json.loads(raw) if raw.strip() else {}
            except (ValueError, TypeError) as error:
                raise RequestError(400, "JSONが不正です。") from error
            month = (req.get("month") or "").strip() if isinstance(req, dict) else ""
            if month and not MONTH_RE.fullmatch(month):
                raise RequestError(400, "month は YYYY-MM 形式で指定してください。")
            payload = {"month": month} if month else {}
            boto3.client("lambda").invoke(FunctionName=function_name, InvocationType="Event",
                                          Payload=json.dumps(payload).encode("utf-8"))
            LOGGER.info("regenerate requested (%s) by %s", month or "auto",
                        claims.get("username") or claims.get("sub"))
            return response(202, {"started": True, "month": month or None,
                                  "note": "再計算を開始しました。1分ほどで反映されます（結果はメールでも通知されます）。"})

        if route == "GET /shift/edits":
            month = (data.get("month") or "").strip()
            if not MONTH_RE.fullmatch(month):
                raise RequestError(400, "month は YYYY-MM 形式で指定してください。")
            try:
                result = S3.get_object(Bucket=bucket, Key=f"{prefix}{month}/edits.json")
            except ClientError as error:
                if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    raise RequestError(404, "編集データはまだありません。") from error
                raise
            with result["Body"] as stream:
                return raw_json_response(stream.read().decode("utf-8"))

        if route == "POST /shift/edits":
            raw = event.get("body") or ""
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw, validate=True).decode("utf-8")
            if len(raw) > 65536:
                raise RequestError(400, "編集データが大きすぎます。")
            try:
                req = json.loads(raw)
            except (ValueError, TypeError) as error:
                raise RequestError(400, "JSONが不正です。") from error
            month = (req.get("month") or "").strip() if isinstance(req, dict) else ""
            if not MONTH_RE.fullmatch(month):
                raise RequestError(400, "month は YYYY-MM 形式で指定してください。")
            payload = req.get("data")
            if not isinstance(payload, dict):
                raise RequestError(400, "data が不正です。")
            record = {
                "month": month,
                "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "updated_by": claims.get("username") or claims.get("sub"),
                "data": payload,
            }
            S3.put_object(Bucket=bucket, Key=f"{prefix}{month}/edits.json",
                          Body=json.dumps(record, ensure_ascii=False).encode("utf-8"),
                          ContentType="application/json; charset=utf-8")
            return response(200, {"saved": True, "month": month})

        if route == "GET /shift/plan":
            month = (data.get("month") or "").strip()
            if month and not MONTH_RE.fullmatch(month):
                raise RequestError(400, "month は YYYY-MM 形式で指定してください。")
            run = (data.get("run") or "").strip()
            if run:
                if not month:
                    raise RequestError(400, "run には month の指定が必要です。")
                if run == "list":
                    return response(200, {"month": month, "runs": list_runs(bucket, prefix, month)})
                if not RUN_RE.fullmatch(run):
                    raise RequestError(400, "run は YYYYMMDD-HHMMSS 形式か list を指定してください。")
                key = f"{prefix}{month}/runs/{run}/plan.json"
            else:
                key = f"{prefix}{month}/plan.json" if month else f"{prefix}latest.json"
            try:
                result = S3.get_object(Bucket=bucket, Key=key)
            except ClientError as error:
                if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    raise RequestError(404, "スナップショットが見つかりません。" if run
                                       else "シフト案がまだありません。") from error
                raise
            with result["Body"] as stream:
                return raw_json_response(stream.read().decode("utf-8"))

        raise RequestError(404, "不明なルートです。")
    except RequestError as error:
        return response(error.status, {"message": error.message})
    except Exception:
        LOGGER.exception("unhandled error")
        return response(500, {"message": "サーバーでエラーが発生しました。"})
