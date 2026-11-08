"""Read monthly JA Bank+ statements without inferring income from balance changes."""

import calendar
import hashlib
import json
import re
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

from pypdf import PdfReader


BANK_CATEGORIES = (
    "売上", "経費", "借入", "借入返済", "口座振替", "現金移動", "その他入金", "その他出金", "未分類",
)
MONEY = re.compile(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def normalized(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip()


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def classify_bank_item(item: dict) -> dict:
    memo = normalized(item["memo"])
    category = "未分類"
    if "ATM" in memo.upper() or "現金" in memo or "ゲンキン" in memo:
        category = "現金移動"
    elif item["withdrawal"] and ("手数料" in memo or "テスウリヨウ" in memo):
        category = "経費"
    elif item["deposit"] and any(word in memo for word in ("売上", "キャベツ", "キヤベツ")):
        category = "売上"
    return {
        **item, "category": category, "note": "", "classified_by": "rule" if category != "未分類" else "unclassified",
        "review_confirmed": False,
        "review_reason": "摘要からの分類候補です。実際の用途を確認してください。" if category != "未分類" else "用途の分類が必要です。",
    }


def parse_bank_statement(path: str | Path) -> dict:
    reader = PdfReader(path)
    if reader.is_encrypted or not 2 <= len(reader.pages) <= 100:
        raise ValueError("暗号化PDFや、対応外のページ構成です。")
    cover = normalized(reader.pages[0].extract_text(extraction_mode="layout"))
    fields = [
        re.search(r"金融機関コード\s*[:：]\s*(\d{4})", cover),
        re.search(r"店番\s*[:：]\s*(\d{3})", cover),
        re.search(r"科目\s*[:：]\s*(\S+)", cover),
        re.search(r"口座番号\s*[:：]\s*(\d{7})", cover),
        re.search(r"【取得期間】\s*(\d{4}/\d{2}/\d{2})から\s*(\d{4}/\d{2}/\d{2})まで", cover),
    ]
    if any(field is None for field in fields):
        raise ValueError("JAバンク＋の口座情報・取得期間を確認できません。")
    bank, branch, kind, account, period = fields
    start = date.fromisoformat(period[1].replace("/", "-"))
    end = date.fromisoformat(period[2].replace("/", "-"))
    if start.day != 1 or start.replace(day=calendar.monthrange(start.year, start.month)[1]) != end:
        raise ValueError("取得期間は同じ月の1日から末日を指定してください。月途中・複数月には対応していません。")
    account_id = digest([bank[1], branch[1], kind[1], account[1]])
    month = start.isoformat()[:7]
    result = {
        "statement_id": digest([account_id, month]), "account_id": account_id,
        "account_label": f"{bank[1]} / {branch[1]} / {kind[1]} / ****{account[1][-3:]}",
        "month": month, "period_start": start.isoformat(), "period_end": end.isoformat(),
        "items": [], "validation_errors": [], "warnings": [],
        "opening_balance": None, "closing_balance": None, "opening_derived": True,
    }
    occurrences = Counter()
    previous = None
    previous_date = None
    for page_number, page in enumerate(reader.pages[1:], 2):
        if page.rotation or abs(float(page.mediabox.width) - 595) > 2 or abs(float(page.mediabox.height) - 842) > 2:
            raise ValueError("対応外のページサイズ・回転です。JAバンク＋の標準PDFを指定してください。")
        layout = page.extract_text(extraction_mode="layout")
        if not all(label in layout for label in ("お取引日付", "お支払金額", "お預り金額", "差引後残高")):
            raise ValueError(f"{page_number}ページの明細見出しを確認できません。")
        pieces = []

        def capture(text, cm, tm, _font, _size):
            value = text.strip()
            if value:
                x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
                y = float(page.mediabox.height) - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
                pieces.append((x, y, value))

        page.extract_text(visitor_text=capture)
        dates = [(x, y, value) for x, y, value in pieces if 20 <= x < 75 and DAY.fullmatch(value)]
        if len(re.findall(r"^\s*\d{4}-\d{2}-\d{2}\b", layout, re.MULTILINE)) != len(dates):
            result["validation_errors"].append(f"{page_number}ページの取引行数を確認できません。")
        # Column coordinates are verified for the standard JA Bank+ A4 export.
        for _, y, day in dates:
            row = [(x, value) for x, row_y, value in pieces if abs(row_y - y) < 1]
            money = {"withdrawal": [], "deposit": [], "balance": []}
            memo = []
            unknown = []
            for x, value in row:
                if value == day:
                    continue
                column = "withdrawal" if 100 <= x < 194 else "deposit" if 240 <= x < 315 else "balance" if 340 <= x < 440 else None
                if column and MONEY.fullmatch(value):
                    money[column].append(int(value.replace(",", "")))
                elif 75 <= x < 315 or x >= 440:
                    memo.append((x, value))
                else:
                    unknown.append(value)
            if unknown or len(money["balance"]) != 1 or len(money["withdrawal"]) + len(money["deposit"]) != 1:
                result["validation_errors"].append(f"{page_number}ページ {day} の金額列を読み取れません。")
                continue
            withdrawal = money["withdrawal"][0] if money["withdrawal"] else 0
            deposit = money["deposit"][0] if money["deposit"] else 0
            balance = money["balance"][0]
            if withdrawal < 0 or deposit < 0 or withdrawal + deposit == 0:
                result["validation_errors"].append(f"{page_number}ページ {day} の入出金額が不正です。")
            if not start.isoformat() <= day <= end.isoformat() or (previous_date and day < previous_date):
                result["validation_errors"].append(f"{page_number}ページの取引日・並び順が取得期間と一致しません。")
            if previous is not None and previous + deposit - withdrawal != balance:
                result["validation_errors"].append(f"{page_number}ページ {day} の入出金と残高が一致しません。")
            if previous is None:
                result["opening_balance"] = balance - deposit + withdrawal
            previous, previous_date = balance, day
            raw_memo = " ".join(value for _, value in sorted(memo))
            fingerprint = digest([day, withdrawal, deposit, balance, raw_memo])
            occurrences[fingerprint] += 1
            item = {
                "transaction_id": digest([fingerprint, occurrences[fingerprint]]),
                "trade_date": day, "withdrawal": withdrawal, "deposit": deposit, "balance": balance,
                "memo": raw_memo, "line_seq": len(result["items"]) + 1,
            }
            result["items"].append(classify_bank_item(item))
        if not dates:
            # An unrecognized/scanned table must not be accepted as an empty successful month.
            result["validation_errors"].append(f"{page_number}ページに読み取り可能な取引がありません。")
    result["closing_balance"] = previous
    result["deposit_total"] = sum(item["deposit"] for item in result["items"])
    result["withdrawal_total"] = sum(item["withdrawal"] for item in result["items"])
    result["warnings"].append("月初残高は最初の取引と取引後残高から逆算しています。残高と入出金の差引は利益ではありません。")
    result["validation_status"] = "failed" if result["validation_errors"] else "ok"
    return result
