"""Cognito-protected JA statement API and private-S3 invoice importer."""

import base64
import json
import logging
import os
import re
import tempfile
import traceback
import uuid
from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError
from pypdf.errors import PdfReadError

from classifier import (
    DEFAULT_RULES,
    HIGH_AMOUNT_REVIEW_REASON,
    HIGH_AMOUNT_REVIEW_THRESHOLD,
    ClassificationRule,
    classify,
)
from statement_parser import LineItem, ParsedStatement, normalize_text, parse_statement


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
S3 = boto3.client("s3")
CLIENT_ID = "mg1q2dnn576jln28m5sja6eaf"
ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC"
ALLOWED_GROUPS = {"admin", "family"}
ALLOWED_CATEGORIES = {
    "農薬費",
    "肥料費",
    "機械部品・装備",
    "機械整備工賃",
    "資材・消耗品",
    "未分類",
}
INVOICE_NO_RE = re.compile(r"^\d{6,12}$")
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_REQUEST_BYTES = 32768


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


def user_groups(claims):
    return set(str(claims.get("cognito:groups", "")).strip("[]").replace(",", " ").split())


def _read_json(bucket, key, missing_ok=False):
    try:
        result = S3.get_object(Bucket=bucket, Key=key)
    except ClientError as error:
        if missing_ok and error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        if error.response["Error"]["Code"] in ("NoSuchKey", "404"):
            raise RequestError(404, "指定された請求データがありません。") from error
        raise
    with result["Body"] as stream:
        return json.loads(stream.read().decode("utf-8"))


def _write_json(bucket, key, value):
    S3.put_object(
        Bucket=bucket,
        Key=key,
        Body=(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"),
        ContentType="application/json; charset=utf-8",
        CacheControl="no-store",
    )


def _list_keys(bucket, prefix):
    keys = []
    options = {"Bucket": bucket, "Prefix": prefix}
    while True:
        listing = S3.list_objects_v2(**options)
        keys.extend(item["Key"] for item in listing.get("Contents", []))
        token = listing.get("NextContinuationToken")
        if not token:
            return keys
        options["ContinuationToken"] = token


def _list_records(bucket, prefix):
    return [
        _read_json(bucket, key)
        for key in _list_keys(bucket, prefix)
        if key.endswith(".json")
    ]


def _item_json(item):
    return {
        "line_seq": item.line_seq,
        "trade_date": item.trade_date.isoformat(),
        "trade_no": item.trade_no,
        "item_name_raw": item.item_name_raw,
        "spec_raw": item.spec_raw,
        "item_name": item.item_name,
        "spec": item.spec,
        "quantity": str(item.quantity) if item.quantity is not None else None,
        "unit_price": str(item.unit_price) if item.unit_price is not None else None,
        "amount": item.amount,
        "tax_flag": item.tax_flag,
        "department": item.department,
        "note": item.note,
        "category": item.category,
        "subcategory": item.subcategory,
        "classified_by": item.classified_by,
        "needs_review": item.needs_review,
        "review_reason": item.review_reason,
    }


def _item_model(value):
    return LineItem(
        line_seq=value["line_seq"],
        trade_date=date.fromisoformat(value["trade_date"]),
        trade_no=value["trade_no"],
        item_name_raw=value["item_name_raw"],
        spec_raw=value["spec_raw"],
        item_name=value["item_name"],
        spec=value["spec"],
        quantity=Decimal(value["quantity"]) if value["quantity"] is not None else None,
        unit_price=Decimal(value["unit_price"]) if value["unit_price"] is not None else None,
        amount=value["amount"],
        tax_flag=value["tax_flag"],
        department=value["department"],
        note=value["note"],
        category=value.get("category", "未分類"),
        subcategory=value.get("subcategory", ""),
        classified_by=value.get("classified_by", "unclassified"),
        needs_review=value.get("needs_review", False),
        review_reason=value.get("review_reason", ""),
    )


def _statement_json(statement, items=None):
    return {
        "invoice_no": statement.invoice_no,
        "issue_date": statement.issue_date.isoformat(),
        "closing_date": statement.closing_date.isoformat(),
        "settlement_date": statement.settlement_date.isoformat(),
        "settlement_method": statement.settlement_method,
        "total_amount": statement.total_amount,
        "previous_amount": statement.previous_amount,
        "tax_amount": statement.tax_amount,
        "forecast_total": statement.forecast_total,
        "forecasts": [
            {"settlement_month": item.settlement_month, "amount": item.amount, "onwards": item.onwards}
            for item in statement.forecasts
        ],
        "items": [_item_json(item) for item in (items if items is not None else statement.items)],
        "unparsed_lines": statement.unparsed_lines,
        "validation_status": statement.validation_status,
        "validation_errors": statement.validation_errors,
        "warnings": statement.warnings,
    }


def _apply_manual_overrides(items, overrides):
    result = []
    for item in items:
        override = overrides.get(str(item.line_seq))
        if not override:
            result.append(item)
            continue
        reason = HIGH_AMOUNT_REVIEW_REASON if item.amount >= HIGH_AMOUNT_REVIEW_THRESHOLD else ""
        result.append(
            replace(
                item,
                category=override["category"],
                subcategory=override["subcategory"],
                classified_by="manual",
                needs_review=bool(reason),
                review_reason=reason,
            )
        )
    return result


def _load_custom_rules(bucket):
    stored = _read_json(bucket, "classification-rules.json", missing_ok=True) or []
    if not isinstance(stored, list):
        raise ValueError("classification-rules.json must contain a list")
    return [ClassificationRule(**rule) for rule in stored]


def _rule_json(rule):
    return {
        "keyword": rule.keyword,
        "category": rule.category,
        "subcategory": rule.subcategory,
        "department": rule.department,
        "priority": rule.priority,
        "needs_review": rule.needs_review,
        "review_reason": rule.review_reason,
    }


def _previous_invoice_total(bucket, closing_date, invoice_no):
    current_date = date.fromisoformat(closing_date)
    if current_date.month == 1:
        previous_month = (current_date.year - 1, 12)
    else:
        previous_month = (current_date.year, current_date.month - 1)
    previous = []
    for record in _list_records(bucket, "invoices/"):
        if record["invoice_no"] == invoice_no or record["validation_status"] == "failed":
            continue
        record_date = date.fromisoformat(record["closing_date"])
        if (record_date.year, record_date.month) == previous_month:
            previous.append((record_date, record["total_amount"]))
    return max(previous, default=(None, None), key=lambda item: item[0])[1]


def _import_record(bucket, source_key):
    if not re.fullmatch(r"uploads/[a-f0-9]{32}\.pdf", source_key):
        raise ValueError("Unexpected JA statement source key")
    source_id = source_key.rsplit("/", 1)[-1].removesuffix(".pdf")
    temp_path = None
    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        S3.download_file(bucket, source_key, str(temp_path))
        try:
            statement = parse_statement(temp_path)
        except (PdfReadError, ValueError, OSError, EOFError) as error:
            locations = [
                f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}"
                for frame in traceback.extract_tb(error.__traceback__)
            ]
            LOGGER.warning(
                "JA statement PDF could not be parsed (%s); locations=%s",
                type(error).__name__,
                " > ".join(locations),
            )
            report = {
                "import_id": source_id,
                "source_file": source_key,
                "imported_at": imported_at,
                "validation_status": "failed",
                "validation_errors": ["PDFを解析できませんでした。ファイル形式と請求書の内容を確認してください。"],
                "warnings": [],
                "unparsed_lines": [],
            }
            _write_json(bucket, f"imports/{source_id}.json", report)
            return report
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    previous_total = _previous_invoice_total(bucket, statement.closing_date.isoformat(), statement.invoice_no)
    if previous_total is not None and statement.previous_amount != previous_total:
        statement.warnings.append(
            f"前回請求金額{statement.previous_amount:,}円と前月請求書の請求金額"
            f"{previous_total:,}円が一致しません。"
        )

    old_record = _read_json(bucket, f"invoices/{statement.invoice_no}.json", missing_ok=True) or {}
    manual_overrides = old_record.get("manual_overrides", {})
    report = {
        "import_id": source_id,
        "source_file": source_key,
        "imported_at": imported_at,
        **_statement_json(statement),
    }
    if statement.validation_status == "failed":
        _write_json(bucket, f"imports/{source_id}.json", report)
        return report

    custom_rules = _load_custom_rules(bucket)
    items = _apply_manual_overrides(
        classify(statement.items, [*DEFAULT_RULES, *custom_rules]),
        manual_overrides,
    )
    invoice = {
        **_statement_json(statement, items),
        "source_file": source_key,
        "imported_at": imported_at,
        "manual_overrides": manual_overrides,
    }
    _write_json(bucket, f"invoices/{statement.invoice_no}.json", invoice)
    _write_json(bucket, f"imports/{source_id}.json", report)
    LOGGER.info(
        "JA invoice import completed (%d items, %s)",
        len(items),
        statement.validation_status,
    )
    return report


def _reclassify_invoices(bucket, rules):
    for key in _list_keys(bucket, "invoices/"):
        if not key.endswith(".json"):
            continue
        record = _read_json(bucket, key)
        items = classify(
            [_item_model(item) for item in record["items"]],
            rules,
        )
        items = _apply_manual_overrides(items, record.get("manual_overrides", {}))
        record["items"] = [_item_json(item) for item in items]
        _write_json(bucket, key, record)


def _text(data, key, maximum, required=True):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value) > maximum:
        raise RequestError(400, f"{key} が不正です。")
    value = value.strip()
    if required and not value:
        raise RequestError(400, f"{key} を入力してください。")
    return value


def _request_data(event, route):
    if route.startswith("GET "):
        return event.get("queryStringParameters") or {}
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as error:
            raise RequestError(400, "JSONが不正です。") from error
    if len(raw) > MAX_REQUEST_BYTES:
        raise RequestError(400, "リクエストが大きすぎます。")
    try:
        value = json.loads(raw)
    except (ValueError, TypeError) as error:
        raise RequestError(400, "JSONが不正です。") from error
    if not isinstance(value, dict):
        raise RequestError(400, "JSONオブジェクトを指定してください。")
    return value


def _invoice_no(value):
    invoice_no = _text(value, "invoice_no", 12)
    if not INVOICE_NO_RE.fullmatch(invoice_no):
        raise RequestError(400, "請求書番号が不正です。")
    return invoice_no


def _classify_request(bucket, data):
    invoice_no = _invoice_no(data)
    line_seq = data.get("line_seq")
    if not isinstance(line_seq, int) or isinstance(line_seq, bool) or line_seq < 1:
        raise RequestError(400, "line_seq が不正です。")
    category = _text(data, "category", 40)
    subcategory = _text(data, "subcategory", 80, required=False)
    if category not in ALLOWED_CATEGORIES:
        raise RequestError(400, "分類が不正です。")
    remember = data.get("remember", False)
    if not isinstance(remember, bool):
        raise RequestError(400, "remember は真偽値で指定してください。")

    key = f"invoices/{invoice_no}.json"
    record = _read_json(bucket, key)
    item = next((value for value in record["items"] if value["line_seq"] == line_seq), None)
    if item is None:
        raise RequestError(404, "指定された明細行がありません。")

    overrides = dict(record.get("manual_overrides", {}))
    overrides[str(line_seq)] = {"category": category, "subcategory": subcategory}
    record["manual_overrides"] = overrides
    if remember:
        keyword = normalize_text(_text(data, "keyword", 100, required=False) or item["item_name"])
        if not keyword:
            raise RequestError(400, "辞書に追加するキーワードを指定してください。")
        custom_rules = _load_custom_rules(bucket)
        custom_rules = [
            rule
            for rule in custom_rules
            if not (normalize_text(rule.keyword) == keyword and rule.department == item["department"])
        ]
        custom_rules.append(
            ClassificationRule(
                keyword=keyword,
                category=category,
                subcategory=subcategory,
                department=item["department"],
                priority=200,
            )
        )
        _write_json(bucket, "classification-rules.json", [_rule_json(rule) for rule in custom_rules])
        _write_json(bucket, key, record)
        _reclassify_invoices(bucket, [*DEFAULT_RULES, *custom_rules])
        record = _read_json(bucket, key)
    else:
        model = _apply_manual_overrides(
            [_item_model(item)],
            overrides,
        )[0]
        record["items"] = [
            _item_json(model) if current["line_seq"] == line_seq else current
            for current in record["items"]
        ]
        _write_json(bucket, key, record)
    LOGGER.info("JA line classification updated")
    return {"invoice_no": invoice_no, "line_seq": line_seq, "remembered": remember}


def _invoice_summaries(bucket):
    records = _list_records(bucket, "invoices/")
    records.sort(key=lambda item: item["issue_date"], reverse=True)
    return [
        {
            "invoice_no": item["invoice_no"],
            "issue_date": item["issue_date"],
            "closing_date": item["closing_date"],
            "settlement_date": item["settlement_date"],
            "total_amount": item["total_amount"],
            "validation_status": item["validation_status"],
            "validation_errors": item["validation_errors"],
            "warnings": item["warnings"],
            "item_count": len(item["items"]),
        }
        for item in records
    ]


def _import_summaries(bucket):
    records = _list_records(bucket, "imports/")
    records.sort(key=lambda item: item["imported_at"], reverse=True)
    return [
        {
            "import_id": item["import_id"],
            "source_file": item["source_file"],
            "imported_at": item["imported_at"],
            "invoice_no": item.get("invoice_no"),
            "validation_status": item["validation_status"],
            "validation_errors": item["validation_errors"],
            "warnings": item["warnings"],
        }
        for item in records
    ]


def lambda_handler(event, context):
    if event.get("Records"):
        for record in event["Records"]:
            bucket = record["s3"]["bucket"]["name"]
            if bucket != os.environ["FINANCE_BUCKET"]:
                raise ValueError("Unexpected S3 invoice upload bucket")
            key = unquote(record["s3"]["object"]["key"].replace("+", " "))
            if not re.fullmatch(r"uploads/[a-f0-9]{32}\.pdf", key):
                raise ValueError("Unexpected S3 invoice upload event")
            _import_record(bucket, key)
        return {"processed": len(event["Records"])}

    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        if (
            claims.get("token_use") != "access"
            or claims.get("client_id") != CLIENT_ID
            or claims.get("iss") != ISSUER
            or "openid" not in claims.get("scope", "").split()
            or not claims.get("sub")
        ):
            raise RequestError(401, "JA明細分析のログインが必要です。")
        if not (user_groups(claims) & ALLOWED_GROUPS):
            raise RequestError(403, "JA明細データを利用する権限がありません。")

        bucket = os.environ["FINANCE_BUCKET"]
        route = event.get("routeKey", "")
        data = _request_data(event, route)

        if route == "POST /finance/uploads":
            key = f"uploads/{uuid.uuid4().hex}.pdf"
            upload = S3.generate_presigned_post(
                Bucket=bucket,
                Key=key,
                Fields={"Content-Type": "application/pdf"},
                Conditions=[
                    {"Content-Type": "application/pdf"},
                    ["content-length-range", 1, MAX_PDF_BYTES],
                ],
                ExpiresIn=300,
            )
            return response(200, {"key": key, "upload": upload, "expires_in": 300})

        if route == "GET /finance/invoices":
            return response(200, {"invoices": _invoice_summaries(bucket)})

        if route == "GET /finance/imports":
            return response(200, {"imports": _import_summaries(bucket)})

        if route.startswith("GET /finance/imports/"):
            import_id = _text(event.get("pathParameters") or {}, "import_id", 32)
            if not re.fullmatch(r"[a-f0-9]{32}", import_id):
                raise RequestError(400, "取込IDが不正です。")
            return response(200, _read_json(bucket, f"imports/{import_id}.json"))

        if route == "GET /finance/forecasts":
            invoices = _invoice_summaries(bucket)
            if not invoices:
                raise RequestError(404, "請求予定はまだありません。")
            latest = _read_json(bucket, f"invoices/{invoices[0]['invoice_no']}.json")
            return response(200, {
                "invoice_no": latest["invoice_no"],
                "issue_date": latest["issue_date"],
                "forecast_total": latest["forecast_total"],
                "forecasts": latest["forecasts"],
            })

        if route.startswith("GET /finance/invoices/"):
            invoice_no = _text(event.get("pathParameters") or {}, "invoice_no", 12)
            if not INVOICE_NO_RE.fullmatch(invoice_no):
                raise RequestError(400, "請求書番号が不正です。")
            return response(200, _read_json(bucket, f"invoices/{invoice_no}.json"))

        if route == "POST /finance/classifications":
            return response(200, _classify_request(bucket, data))

        if route == "POST /finance/reimport":
            invoice_no = _invoice_no(data)
            invoice = _read_json(bucket, f"invoices/{invoice_no}.json")
            source_key = invoice.get("source_file", "")
            if not source_key.startswith("uploads/") or not source_key.lower().endswith(".pdf"):
                raise RequestError(409, "再取り込み元のPDFが見つかりません。")
            report = _import_record(bucket, source_key)
            return response(200, {
                "invoice_no": report.get("invoice_no"),
                "validation_status": report["validation_status"],
                "validation_errors": report["validation_errors"],
                "warnings": report["warnings"],
            })

        raise RequestError(404, "不明なルートです。")
    except RequestError as error:
        return response(error.status, {"message": error.message})
    except ClientError:
        LOGGER.exception("JA statement S3 operation failed")
        return response(500, {"message": "JA明細データの保存または読み込みに失敗しました。"})
