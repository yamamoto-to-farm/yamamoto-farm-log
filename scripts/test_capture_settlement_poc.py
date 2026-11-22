import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from playwright.sync_api import sync_playwright

from capture_settlement_poc import capture, find_report, report_number, validate_pdf


URL = "https://members.aichi-ja.or.jp/kumex/report?hid=form&mod=HSB102&date=20260101&reportif=12345678"


class ReportTest(unittest.TestCase):
    def test_report_url(self):
        self.assertEqual(report_number(URL), "12345678")
        for url in [
            URL.replace("members.aichi-ja.or.jp", "example.com"),
            URL.replace("HSB102", "OTHER"),
            URL + "&reportif=98765432",
            URL.replace("12345678", "abc"),
        ]:
            self.assertIsNone(report_number(url))

    def test_only_one_open_report_can_be_selected(self):
        page = SimpleNamespace(url=URL, is_closed=lambda: False)
        other = SimpleNamespace(url="https://example.com/", is_closed=lambda: False)
        closed = SimpleNamespace(url=URL, is_closed=lambda: True)
        self.assertEqual(find_report([other, page, closed]), (page, "12345678"))
        with self.assertRaises(ValueError):
            find_report([page, page])

    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "existing.pdf"
            path.write_bytes(b"existing")
            with self.assertRaises(FileExistsError):
                capture(path, 1)
            self.assertEqual(path.read_bytes(), b"existing")

    def test_browser_pdf_validation(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            try:
                page = browser.new_page()
                page.set_content("<html lang='ja'><body>販売代金精算通知書 № 12345678</body></html>")
                pdf = page.pdf(format="A4", print_background=True)
                validate_pdf(pdf, "12345678")
                with self.assertRaises(ValueError):
                    validate_pdf(pdf, "87654321")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
