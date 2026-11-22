"""Capture one JA settlement statement as a local PDF after manual login."""

import argparse
import re
import sys
import time
import unicodedata
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright
from pypdf import PdfReader


LOGIN_URL = "https://members.aichi-ja.or.jp/k/th/index.html"
TITLE = "販売代金精算通知書"


def report_number(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != "members.aichi-ja.or.jp" or parts.path != "/kumex/report":
        return None
    query = parse_qs(parts.query)
    if query.get("hid") != ["form"] or query.get("mod") != ["HSB102"]:
        return None
    numbers = query.get("reportif", [])
    return numbers[0] if len(numbers) == 1 and re.fullmatch(r"\d+", numbers[0]) else None


def compact(text: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))


def validate_pdf(pdf: bytes, number: str) -> None:
    reader = PdfReader(BytesIO(pdf))
    text = compact("".join(page.extract_text() or "" for page in reader.pages))
    if not reader.pages or TITLE not in text or number not in text:
        raise ValueError("PDFに通知書名または帳票番号が見つかりません。保存を中止しました。")


def find_report(pages: list[Page]) -> tuple[Page, str] | None:
    reports = [(page, number) for page in pages if not page.is_closed()
               if (number := report_number(page.url)) is not None]
    if len(reports) > 1:
        raise ValueError("帳票が複数開かれています。対象の1件だけ開いて再実行してください。")
    return reports[0] if reports else None


def capture(output: Path, timeout: int) -> None:
    if output.suffix.lower() != ".pdf":
        raise ValueError("出力先には.pdfファイルを指定してください。")
    if output.exists():
        raise FileExistsError("出力先が既に存在します。上書きしません。")
    if not output.parent.is_dir():
        raise ValueError("出力先のフォルダが存在しません。")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=False)
        try:
            context = browser.new_context()
            page = context.new_page()
            page.goto(LOGIN_URL, wait_until="domcontentloaded")
            print("開いたEdgeでJAへログインし、精算通知書を1件開いてください。")
            print("ログイン情報はこのツールに入力・保存しません。", flush=True)
            deadline = time.monotonic() + timeout
            report = None
            while time.monotonic() < deadline:
                report = find_report(context.pages)
                if report:
                    break
                if not context.pages:
                    raise RuntimeError("ブラウザーが閉じられました。")
                context.pages[0].wait_for_timeout(500)
            if not report:
                raise TimeoutError("時間内に精算通知書が開かれませんでした。")
            report_page, number = report
            report_page.wait_for_load_state("load", timeout=30000)
            if TITLE not in compact(report_page.locator("body").inner_text()):
                raise ValueError("帳票画面の内容を確認できません。保存を中止しました。")
            report_page.emulate_media(media="print")
            pdf = report_page.pdf(format="A4", print_background=True)
            validate_pdf(pdf, number)
            with output.open("xb") as file:
                file.write(pdf)
            print(f"PDFを保存しました: {output}")
            print("原本と出荷日・数量・単価・金額・税・控除を目視で照合してください。")
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="手動ログイン後、精算通知書1件をPDF保存します。")
    parser.add_argument("--output", required=True, type=Path, help="上書きしないPDF出力先")
    parser.add_argument("--timeout", type=int, default=600, help="ログインと帳票選択の待ち時間（秒）")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeoutは1秒以上を指定してください。")
    try:
        capture(args.output, args.timeout)
    except (OSError, ValueError, RuntimeError, TimeoutError, PlaywrightError) as error:
        print(f"取得に失敗しました: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
