import unittest
from pathlib import Path
from unittest.mock import patch

from convert_bank_statement import extract_sources


HEADER = """2026/02/28 22:23 入出金明細照会
対象口座 テスト支店 普通 1234567
当月分の入出金明細照会
"""
FIRST = "001 02月02日分 100円 入金 1,100円 テスト入金\n"
SECOND = "001 02月03日分 50円 出金 1,050円 テスト出金\n"
TOTAL = "合計 50円 100円\n1件 1件\n"


def reader(text):
    return type("Reader", (), {"pages": [type("Page", (), {"extract_text": lambda self, **kwargs: text})()]})()


class ConversionTests(unittest.TestCase):
    def extract(self, texts, month="2026-02", account="1234567"):
        with patch("convert_bank_statement.PdfReader", side_effect=[reader(text) for text in texts]):
            return extract_sources([Path(f"sample-{index}.pdf") for index in range(len(texts))], month, account)

    def test_combines_split_files_in_order_and_validates_totals(self):
        rows = self.extract([HEADER + FIRST, HEADER + SECOND + TOTAL])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["deposit"], 100)
        self.assertEqual(rows[1]["withdrawal"], 50)
        self.assertEqual(rows[1]["memo"], "テスト出金")
        reversed_rows = self.extract([HEADER + SECOND + TOTAL, HEADER + FIRST])
        self.assertEqual(rows, reversed_rows)

    def test_identical_overlap_deduplicated_but_conflicting_rows_rejected(self):
        rows = self.extract([HEADER + FIRST, HEADER + FIRST + SECOND + TOTAL])
        self.assertEqual(len(rows), 2)
        with self.assertRaisesRegex(ValueError, "一致しません"):
            self.extract([HEADER + FIRST, HEADER + FIRST.replace("テスト入金", "違う用途") + SECOND + TOTAL])

    def test_partial_files_bad_counts_amounts_and_balances_fail(self):
        samples = [
            [HEADER + FIRST],
            [HEADER + FIRST + TOTAL],
            [HEADER + FIRST + SECOND + TOTAL.replace("1件 1件", "2件 1件")],
            [HEADER + FIRST + SECOND + TOTAL.replace("50円 100円", "51円 100円")],
            [HEADER + FIRST + SECOND.replace("1,050円", "1,000円") + TOTAL],
            [HEADER + FIRST.replace("100円", "不明円") + SECOND + TOTAL],
        ]
        for texts in samples:
            with self.subTest(texts=texts), self.assertRaises(ValueError):
                self.extract(texts)

    def test_mismatched_account_and_period_fail_without_guessing(self):
        text = HEADER + FIRST + SECOND + TOTAL
        with self.assertRaises(ValueError):
            self.extract([text], account="7654321")
        with self.assertRaises(ValueError):
            self.extract([text], month="2026-01")
        with self.assertRaises(ValueError):
            self.extract([text.replace("当月分", "不明")])

    def test_previous_month_handles_year_rollover(self):
        text = (HEADER.replace("2026/02/28", "2027/01/03").replace("当月分", "前月分")
                + FIRST.replace("02月", "12月") + SECOND.replace("02月", "12月") + TOTAL)
        rows = self.extract([text], month="2026-12")
        self.assertEqual(rows[0]["trade_date"], "2026-12-02")


if __name__ == "__main__":
    unittest.main()
