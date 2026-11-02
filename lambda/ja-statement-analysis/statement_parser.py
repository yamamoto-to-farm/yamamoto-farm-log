"""JA invoice PDF extraction and parsing."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from pathlib import Path


_DETAIL_PREFIX = re.compile(r"^(?P<trade_date>\d{4}/\d{2}/\d{2})\s+(?P<trade_no>\d{10})\s+(?P<body>.*)$")
_DETAIL_ROW = re.compile(
    r"^(?P<description>.*?)\s+"
    r"(?P<quantity>\d+(?:\.\d+)?)\s+"
    r"(?P<unit_price>[\d,]+(?:\.\d+)?)\s+"
    r"(?P<amount>[\d,]+)\s+"
    r"(?P<tax_flag>内\*?|\*)\s+"
    r"(?P<department>農機課|第\d+事業所)"
    r"(?:\s+(?P<note>.*))?$"
)
_FORECAST_ROW = re.compile(
    r"[（(]\s*(?P<month>\d{1,2})月決済予定\s*[）)]\s*(?P<amount>[\d,]+)\s*$"
)
_MONEY = re.compile(r"([\d,]+)")


@dataclass(frozen=True)
class LineItem:
    line_seq: int
    trade_date: date
    trade_no: str
    item_name_raw: str
    spec_raw: str
    item_name: str
    spec: str
    quantity: Decimal
    unit_price: Decimal
    amount: int
    tax_flag: str
    department: str
    note: str
    category: str = "未分類"
    subcategory: str = ""
    classified_by: str = "unclassified"
    needs_review: bool = False
    review_reason: str = ""


@dataclass(frozen=True)
class Forecast:
    settlement_month: str
    amount: int


@dataclass
class ParsedStatement:
    invoice_no: str
    issue_date: date
    closing_date: date
    settlement_date: date
    settlement_method: str
    total_amount: int
    previous_amount: int
    tax_amount: int
    items: list[LineItem] = field(default_factory=list)
    forecast_total: int | None = None
    forecasts: list[Forecast] = field(default_factory=list)
    unparsed_lines: list[str] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def validation_status(self) -> str:
        if self.validation_errors:
            return "failed"
        if self.warnings:
            return "warning"
        return "ok"


def normalize_text(value: str) -> str:
    """Normalize PDF text, joining spaces accidentally inserted after halfwidth voicing marks."""
    value = value.replace("\u00a0", " ")
    value = re.sub(r"(?<=[ﾞﾟ])\s+(?=[\uFF61-\uFF9F])", "", value)
    return unicodedata.normalize("NFKC", value)


def _without_whitespace(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _required_date(lines: list[str], label: str) -> date:
    pattern = re.compile(
        rf"{label}\s*(20\d{{2}})\s*年\s*(\d{{1,2}})\s*月\s*(\d{{1,2}})\s*日"
    )
    for line in lines:
        match = pattern.search(line)
        if match:
            return date(*(int(part) for part in match.groups()))
    raise ValueError(f"{label}をPDFから読み取れません。")


def _amount_after(lines: list[str], label_pattern: str, label: str) -> int:
    pattern = re.compile(label_pattern)
    for line in lines:
        match = pattern.search(line)
        if match:
            amount = _MONEY.search(line[match.end():])
            if amount:
                return int(amount.group(1).replace(",", ""))
    raise ValueError(f"{label}をPDFから読み取れません。")


def _parse_item(line: str, raw_line: str, line_seq: int) -> LineItem | None:
    prefix = _DETAIL_PREFIX.match(line)
    if not prefix:
        return None

    body = prefix.group("body")
    if body.startswith("振替"):
        return None

    match = _DETAIL_ROW.fullmatch(body)
    if not match:
        return None

    description = match.group("description").strip()
    raw_prefix = _DETAIL_PREFIX.match(raw_line)
    if not raw_prefix:
        return None
    raw_description_match = re.match(
        r"^(.*?)\s+\d+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s+[\d,]+\s+(?:内\*?|\*)",
        raw_prefix.group("body"),
    )
    raw_description = (
        raw_description_match.group(1).strip()
        if raw_description_match
        else description
    )
    raw_parts = re.split(r"\s+", raw_description, maxsplit=1)
    item_name_raw = raw_parts[0]
    spec_raw = raw_parts[1] if len(raw_parts) > 1 else ""
    item_name = normalize_text(item_name_raw)
    spec = re.sub(
        r"(?<=[\u3040-\u30ff\u3400-\u9fff])(?=\d)",
        " ",
        normalize_text(spec_raw),
    )
    try:
        trade_date = date.fromisoformat(prefix.group("trade_date").replace("/", "-"))
    except ValueError:
        return None
    return LineItem(
        line_seq=line_seq,
        trade_date=trade_date,
        trade_no=prefix.group("trade_no"),
        item_name_raw=item_name_raw,
        spec_raw=spec_raw,
        item_name=item_name,
        spec=spec,
        quantity=Decimal(match.group("quantity")),
        unit_price=Decimal(match.group("unit_price").replace(",", "")),
        amount=int(match.group("amount").replace(",", "")),
        tax_flag=match.group("tax_flag"),
        department=match.group("department"),
        note=(match.group("note") or "").strip(),
    )


def parse_statement_text(pages: list[str], previous_invoice_total: int | None = None) -> ParsedStatement:
    """Parse extracted page text and validate totals without depending on a PDF library."""
    raw_lines = [line.strip() for page in pages for line in page.splitlines()]
    lines = [normalize_text(line).strip() for line in raw_lines]
    compact_lines = [_without_whitespace(line) for line in lines]

    invoice_no = ""
    for line in compact_lines:
        match = re.search(r"請求書No(\d+)", line)
        if match:
            invoice_no = match.group(1)
            break
    if not invoice_no:
        raise ValueError("請求書番号をPDFから読み取れません。")

    issue_date = _required_date(lines, "発行日")
    closing_date = _required_date(lines, "締日")
    settlement_date = _required_date(lines, "決済日")
    total_amount = _amount_after(
        compact_lines, r"今回請求金額", "今回請求金額"
    )
    previous_amount = _amount_after(
        compact_lines, r"前回請求金額", "前回請求金額"
    )
    tax_amount = _amount_after(
        compact_lines, r"うち消費税額", "うち消費税額"
    )

    method = ""
    for line in lines:
        if "決済方法" in line:
            method = line.split("決済方法", 1)[1].strip()
            break
    if not method:
        for line in lines:
            if re.match(r"^\d{4}/\d{2}/\d{2}\s+\d{10}\s+振替\b", line):
                method = "振替"
                break

    statement = ParsedStatement(
        invoice_no=invoice_no,
        issue_date=issue_date,
        closing_date=closing_date,
        settlement_date=settlement_date,
        settlement_method=method,
        total_amount=total_amount,
        previous_amount=previous_amount,
        tax_amount=tax_amount,
    )

    for raw_line, line in zip(raw_lines, lines):
        prefix = _DETAIL_PREFIX.match(line)
        if prefix:
            item = _parse_item(line, raw_line, len(statement.items) + 1)
            if item is not None:
                statement.items.append(item)
            elif not prefix.group("body").startswith("振替"):
                statement.unparsed_lines.append(line)
            continue

        forecast_row = _FORECAST_ROW.search(line)
        if forecast_row:
            month = int(forecast_row.group("month"))
            year = settlement_date.year + (1 if month <= settlement_date.month else 0)
            statement.forecasts.append(
                Forecast(
                    settlement_month=f"{year:04d}-{month:02d}",
                    amount=int(forecast_row.group("amount").replace(",", "")),
                )
            )

        if "請求予定金額" in line:
            amounts = _MONEY.findall(line)
            if amounts:
                statement.forecast_total = int(amounts[-1].replace(",", ""))

    if not statement.items:
        statement.validation_errors.append("明細行を読み取れませんでした。")
    if statement.unparsed_lines:
        statement.validation_errors.append(
            f"明細候補を{len(statement.unparsed_lines)}行解析できませんでした。"
        )
    item_total = sum(item.amount for item in statement.items)
    if item_total != statement.total_amount:
        statement.validation_errors.append(
            f"明細合計{item_total:,}円と今回請求金額{statement.total_amount:,}円が一致しません。"
        )
    if statement.forecast_total is not None:
        forecast_sum = sum(forecast.amount for forecast in statement.forecasts)
        if forecast_sum != statement.forecast_total:
            statement.validation_errors.append(
                f"請求予定合計{forecast_sum:,}円と記載額{statement.forecast_total:,}円が一致しません。"
            )
    elif statement.forecasts:
        statement.validation_errors.append("請求予定合計をPDFから読み取れません。")

    if previous_invoice_total is not None and previous_amount != previous_invoice_total:
        statement.warnings.append(
            f"前回請求金額{previous_amount:,}円と前月請求書の請求金額"
            f"{previous_invoice_total:,}円が一致しません。"
        )
    return statement


def parse_statement(pdf_path: str | Path, previous_invoice_total: int | None = None) -> ParsedStatement:
    """Extract all PDF pages and parse the statement."""
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("PDF読み取りにはpypdfが必要です。requirements.txtをインストールしてください。") from error

    reader = PdfReader(str(pdf_path))
    pages = [page.extract_text() or "" for page in reader.pages]
    return parse_statement_text(pages, previous_invoice_total=previous_invoice_total)
