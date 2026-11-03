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
  POST /shift/work-plans … コピーしたグループの予定を担当者単位で更新（競合時409）

時給を含むため、photos と同じ Cognito プールの検証済みクレームに加えて、
cognito:groups に admin または family が必要（worker には返さない）。

環境変数:
  SHIFT_BUCKET  … 非公開バケット名（必須）
  SHIFT_PREFIX  … キーの接頭辞（既定 "shift/"）
  PLAN_FUNCTION … 生成 Lambda の関数名（再計算に必要。例 yamamoto-farm-shift-plan）
"""
import base64
import json
import logging
import os
import re
from datetime import datetime, timezone

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
    names = plan.get("names")
    if not isinstance(names, list) or not 1 <= len(names) <= 20:
        raise RequestError(400, "担当者を1〜20人指定してください。")
    names = [plan_text(name, "担当者", 80, False) for name in names]
    if len(set(names)) != len(names):
        raise RequestError(400, "担当者が重複しています。")
    off = plan.get("off")
    manual = plan.get("manual_text")
    if not isinstance(off, bool) or not isinstance(manual, bool):
        raise RequestError(400, "予定の状態が不正です。")
    kind = plan.get("kind")
    if kind not in ("1", "2", "3"):
        raise RequestError(400, "作業形態が不正です。")
    reporter = plan_text(plan.get("reporter", ""), "連絡係", 80)
    if kind == "2" and not off and reporter not in names:
        raise RequestError(400, "連絡係は担当者から選択してください。")
    blocks = plan.get("blocks")
    if not isinstance(blocks, list) or len(blocks) > 30 or (not off and not blocks) or (off and blocks):
        raise RequestError(400, "作業時間帯を指定してください。")
    validated = []
    for block in blocks:
        if not isinstance(block, dict):
            raise RequestError(400, "作業時間帯が不正です。")
        start, end = block.get("start"), block.get("end")
        for value in (start, end):
            if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                raise RequestError(400, "時間は HH:MM 形式で指定してください。")
        if start >= end:
            raise RequestError(400, "終了時刻は開始時刻より後にしてください。")
        if not isinstance(block.get("shed"), bool):
            raise RequestError(400, "集合場所が不正です。")
        validated.append({
            "start": start, "end": end,
            "field": plan_text(block.get("field"), "圃場"),
            "task": plan_text(block.get("task"), "作業内容", 200, False),
            "shed": block["shed"],
        })
    message = plan.get("message")
    plan_text(message, "コピー文面", 10000, False)
    return {
        "names": names, "off": off, "kind": kind, "reporter": reporter,
        "blocks": validated,
        "off_reason": plan_text(plan.get("off_reason", ""), "中止理由", 500),
        "memo": plan_text(plan.get("memo", ""), "メモ", 2000),
        "message": message,
        "manual_text": manual,
    }


def read_work_plans(bucket, key, date):
    try:
        result = S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return {"date": date, "people": {}}, None
        raise
    with result["Body"] as stream:
        record = json.loads(stream.read().decode("utf-8"))
    if not isinstance(record, dict) or record.get("date") != date or not isinstance(record.get("people"), dict):
        raise RuntimeError("Stored work plans are invalid")
    return record, result["ETag"]


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
    plan = validate_work_plan(req.get("plan"))
    key = f"{prefix}work-plans/{date}.json"
    record, revision = read_work_plans(bucket, key, date)
    if req["revision"] != revision:
        raise RequestError(409, "別の端末で予定が更新されました。内容を確認して再度コピーしてください。")
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    author = claims.get("username") or claims["sub"]
    for name in plan["names"]:
        record["people"][name] = {
            **plan, "worker": name, "updated_at": stamp, "updated_by": author,
        }
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
    return response(200, {"saved": True, "date": date, "names": plan["names"], "updated_at": stamp})


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
