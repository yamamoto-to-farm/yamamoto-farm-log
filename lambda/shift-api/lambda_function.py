"""シフト案 読み取り・設定編集API（Cognito JWT保護・admin/familyグループ限定）.

HTTP API（payload 2.0）のルート:
  GET  /shift/plan   … 最新（または ?month=YYYY-MM）の plan.json を返す
  GET  /shift/months … 保存済みの月の一覧を返す
  GET  /shift/config … スタッフマスタ（config.json）を返す
  POST /shift/config … 検証して config.json を保存（保存前に config-backups/ へ退避）

時給を含むため、photos と同じ Cognito プールの検証済みクレームに加えて、
cognito:groups に admin または family が必要（worker には返さない）。

環境変数:
  SHIFT_BUCKET … 非公開バケット名（必須）
  SHIFT_PREFIX … キーの接頭辞（既定 "shift/"）
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
    return cfg


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
