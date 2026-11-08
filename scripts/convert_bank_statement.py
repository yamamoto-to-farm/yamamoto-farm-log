"""Convert legacy JA web-print statements to a validated, explicitly labelled import PDF."""

import argparse
import calendar
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "ja-statement-analysis"))
from bank_statement_parser import parse_bank_statement


AMOUNT = r"([\d,]+)円"
ROW = re.compile(r"^\s*(\d{3})\s+(\d{2})月(\d{2})日分\s+" + AMOUNT + r"\s+(入金|出金)\s+" + AMOUNT + r"(?:\s+(.*))?$")


def extract_sources(paths: list[Path], month: str, account: str) -> list[dict]:
    rows = {}
    reported = []
    for path in paths:
        text = "\n".join(unicodedata.normalize("NFKC", page.extract_text(extraction_mode="layout")) for page in PdfReader(path).pages)
        identity = re.search(r"対象口座\s+(\S+)\s+普通\s+(\d{7})", text)
        printed = re.search(r"(\d{4})/(\d{2})/\d{2}", text)
        if not identity or identity[2] != account or not printed or "入出金明細照会" not in text:
            raise ValueError(f"{path.name}: 口座・形式・出力年月を確認できません。")
        year, number = int(printed[1]), int(printed[2])
        if "前月分の入出金明細照会" in text:
            year, number = (year - 1, 12) if number == 1 else (year, number - 1)
        elif "当月分の入出金明細照会" not in text:
            raise ValueError(f"{path.name}: 照会期間が不明です。")
        if f"{year}-{number:02}" != month:
            raise ValueError(f"{path.name}: 指定月と照会月が一致しません。")
        for line in text.splitlines():
            if not re.match(r"^\s*\d{3}\s+\d{2}月", line):
                continue
            match = ROW.fullmatch(line)
            if not match:
                raise ValueError(f"{path.name}: 読み取れない取引行があります。")
            ordinal, row_month, day, amount, direction, balance, memo = match.groups()
            trade_date = date(year, int(row_month), int(day)).isoformat()
            if not trade_date.startswith(month):
                raise ValueError(f"{path.name}: 取得月以外の取引があります。")
            amount, balance = int(amount.replace(",", "")), int(balance.replace(",", ""))
            if amount <= 0:
                raise ValueError(f"{path.name}: 入出金額が不正です。")
            row = {"trade_date": trade_date, "deposit": amount if direction == "入金" else 0,
                   "withdrawal": amount if direction == "出金" else 0, "balance": balance, "memo": memo or ""}
            key = (trade_date, int(ordinal))
            if key in rows and rows[key] != row:
                raise ValueError("重複する日付・取引番号の内容が一致しません。")
            rows[key] = row
        summary = re.search(r"^\s*合計\s+" + AMOUNT + r"\s+" + AMOUNT + r"\s*\n\s*(\d+)件\s+(\d+)件", text, re.MULTILINE)
        if summary:
            reported.append(tuple(int(value.replace(",", "")) for value in summary.groups()))
    ordered = [row for _, row in sorted(rows.items())]
    if not ordered or not reported:
        raise ValueError("取引行または月合計・件数がありません。月末までの全ファイルを指定してください。")
    actual = (sum(row["withdrawal"] for row in ordered), sum(row["deposit"] for row in ordered),
              sum(row["withdrawal"] > 0 for row in ordered), sum(row["deposit"] > 0 for row in ordered))
    if any(total != actual for total in reported):
        raise ValueError("原本の合計金額・件数と抽出結果が一致しません。分割ファイルの不足を確認してください。")
    for before, after in zip(ordered, ordered[1:]):
        if before["balance"] + after["deposit"] - after["withdrawal"] != after["balance"]:
            raise ValueError("取引後残高が連続していません。欠落や並び順を確認してください。")
    return ordered


def convert(paths: list[Path], reference: Path, month: str, output: Path, font: Path) -> dict:
    if output.exists():
        raise ValueError("出力先は既に存在します。原本・既存出力は上書きしません。")
    cover = unicodedata.normalize("NFKC", PdfReader(reference).pages[0].extract_text(extraction_mode="layout"))
    values = [re.search(pattern, cover) for pattern in (
        r"金融機関コード\s*:\s*(\d{4})", r"店番\s*:\s*(\d{3})", r"科目\s*:\s*(\S+)", r"口座番号\s*:\s*(\d{7})")]
    if any(value is None for value in values) or values[2][1] != "普通":
        raise ValueError("参照PDFの口座情報を確認できません。")
    bank, branch, kind, account = [value[1] for value in values]
    rows = extract_sources(paths, month, account)
    start = date.fromisoformat(month + "-01")
    end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    pdfmetrics.registerFont(TTFont("ImportJapanese", str(font), subfontIndex=0))
    temporary = output.with_suffix(".converting.pdf")
    if temporary.exists():
        raise ValueError("一時出力先が既に存在します。")
    try:
        document = canvas.Canvas(str(temporary), pagesize=(595, 842))
        document.setTitle(f"口座明細取込用（原本から変換）{month}")
        document.setFont("ImportJapanese", 11)
        for y, text in [(50, "口座明細取込用（原本から変換・金融機関発行の原本ではありません）"),
                        (90, f"金融機関コード：{bank}"), (110, f"店番：{branch} 科目：{kind}"),
                        (130, f"口座番号：{account}"), (180, "【取得期間】"),
                        (200, start.strftime("%Y/%m/%d") + "から"), (220, end.strftime("%Y/%m/%d") + "まで"),
                        (260, "原本に記載された取引の合計・件数・残高の連続性を照合済み。"),
                        (280, "変換によって取引を追加・補完していません。原本と一緒に保管してください。")]:
            document.drawString(24, 842 - y, text)
        for index, path in enumerate(paths):
            document.drawString(24, 842 - 320 - index * 20, "元ファイル：" + path.name)
        document.showPage()
        for offset in range(0, len(rows), 32):
            document.setFont("ImportJapanese", 8)
            for x, text in [(25, "お取引日付"), (110, "お支払金額"), (245, "お預り金額"), (345, "差引後残高"), (450, "摘要")]:
                document.drawString(x, 842 - 40, text)
            for index, row in enumerate(rows[offset:offset + 32]):
                y = 842 - (67 + index * 22)
                document.drawString(27, y, row["trade_date"])
                if row["withdrawal"]:
                    document.drawString(120, y, f'{row["withdrawal"]:,}')
                if row["deposit"]:
                    document.drawString(245, y, f'{row["deposit"]:,}')
                document.drawString(350, y, f'{row["balance"]:,}')
                memo_width = pdfmetrics.stringWidth(row["memo"], "ImportJapanese", 8)
                document.setFont("ImportJapanese", min(8, 135 * 8 / memo_width) if memo_width else 8)
                document.drawString(450, y, row["memo"])
                document.setFont("ImportJapanese", 8)
            document.drawString(24, 24, "取込用変換PDF：金額・摘要は原本照合対象。正式な原本の代わりにはなりません。")
            document.showPage()
        document.save()
        parsed = parse_bank_statement(temporary)
        expected = [{key: row[key] for key in ("trade_date", "deposit", "withdrawal", "balance", "memo")} for row in rows]
        actual = [{key: row[key] for key in ("trade_date", "deposit", "withdrawal", "balance", "memo")} for row in parsed["items"]]
        if parsed["validation_status"] != "ok" or actual != expected:
            raise ValueError("変換PDFを既存パーサーで読み返した結果が原本と一致しません。")
        temporary.rename(output)
        return parsed
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True, help="同じ口座の既存JAバンク＋PDF")
    parser.add_argument("--month", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--font", type=Path, default=Path(r"C:\Windows\Fonts\msgothic.ttc"))
    parser.add_argument("sources", type=Path, nargs="+")
    args = parser.parse_args()
    result = convert(args.sources, args.reference, args.month, args.output, args.font)
    print(f"Validated {result['month']}: {len(result['items'])} transactions. Created {args.output}")
