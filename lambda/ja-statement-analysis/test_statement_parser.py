import unittest
from datetime import date
from decimal import Decimal

from statement_parser import normalize_text, parse_statement_text


class StatementParserTests(unittest.TestCase):
    def setUp(self):
        self.page_one = """\
発行日 2026年10月2日
締日 2026年9月30日  決済日 2026年10月31日
請求書№ 04026970 今 回 請 求 金 額 3,845円
前回請求金額 1,879,375
うち消費税額 71,240
2026/09/28 7800202258 消耗部品　ﾍﾞ ｱﾘﾝｸﾞ 6000 2.00 750.00 1,500 内 農機課
2026/09/28 6400669606 フィールドスターＰ乳剤 500ML 1.00 2,345.00 2,345 内* 第４事業所 予約
<以下請求予定金額（未確定）> 8,503,556
(11月決済予定) 2,010,000
(12月決済予定) 3,619,450
"""
        self.page_two = """\
請求書№ 04026970 今 回 請 求 金 額 3,845円
(１月決済予定) 1,252,575
(２月決済予定) 1,621,531
"""

    def test_normalizes_halfwidth_voiced_kana_after_removing_gap(self):
        self.assertEqual(normalize_text("ﾍﾞ ｱﾘﾝｸﾞ 6000"), "ベアリング 6000")
        self.assertEqual(normalize_text("ｼﾞ ｮｳｶﾝNB17"), "ジョウカンNB17")

    def test_parses_statement_and_forecasts_across_pages(self):
        statement = parse_statement_text([self.page_one, self.page_two])
        self.assertEqual(statement.invoice_no, "04026970")
        self.assertEqual(statement.issue_date, date(2026, 10, 2))
        self.assertEqual(statement.closing_date, date(2026, 9, 30))
        self.assertEqual(statement.settlement_date, date(2026, 10, 31))
        self.assertEqual(statement.total_amount, 3845)
        self.assertEqual(statement.tax_amount, 71240)
        self.assertEqual(len(statement.items), 2)
        self.assertEqual(statement.items[0].spec, "ベアリング 6000")
        self.assertEqual(statement.items[0].spec_raw, "ﾍﾞ ｱﾘﾝｸﾞ 6000")
        self.assertEqual(statement.items[1].tax_flag, "内*")
        self.assertEqual(statement.items[1].note, "予約")
        self.assertEqual(statement.items[0].quantity, Decimal("2.00"))
        self.assertEqual(statement.items[0].unit_price, Decimal("750.00"))
        self.assertEqual(
            [forecast.settlement_month for forecast in statement.forecasts],
            ["2026-11", "2026-12", "2027-01", "2027-02"],
        )
        self.assertEqual(sum(f.amount for f in statement.forecasts), 8503556)
        self.assertEqual(statement.validation_status, "ok")

    def test_keeps_unparsed_detail_lines_and_fails_validation(self):
        malformed = self.page_one.replace("2,345 内*", "不明 内*")
        statement = parse_statement_text([malformed])
        self.assertEqual(len(statement.unparsed_lines), 1)
        self.assertEqual(statement.validation_status, "failed")

    def test_amount_only_credit_preserves_missing_quantity_and_unit_price(self):
        page = self.page_one.replace("3,845円", "3,669円")
        page += "\n2026/04/27 1234567890 運賃    -176 内 第４事業所 予約"
        statement = parse_statement_text([page, self.page_two])
        self.assertEqual(statement.validation_status, "ok")
        credit = statement.items[-1]
        self.assertEqual(credit.item_name_raw, "運賃")
        self.assertEqual(credit.amount, -176)
        self.assertIsNone(credit.quantity)
        self.assertIsNone(credit.unit_price)
        self.assertEqual(credit.line_seq, 3)

    def test_signed_detail_numbers_and_raw_spec(self):
        page = self.page_one.replace("3,845円", "845円").replace(
            "2.00 750.00 1,500", "-2.00 750.00 -1,500"
        )
        statement = parse_statement_text([page, self.page_two])
        self.assertEqual(statement.validation_status, "ok")
        self.assertEqual(statement.items[0].quantity, Decimal("-2.00"))
        self.assertEqual(statement.items[0].spec_raw, "ﾍﾞ ｱﾘﾝｸﾞ 6000")

    def test_forecast_onwards_keeps_range_without_inventing_a_single_month(self):
        page = self.page_two.replace("２月決済予定", "２月以降決済予定")
        statement = parse_statement_text([self.page_one, page])
        self.assertEqual(statement.validation_status, "ok")
        self.assertEqual(statement.forecasts[-1].settlement_month, "2027-02")
        self.assertTrue(statement.forecasts[-1].onwards)
        self.assertFalse(statement.forecasts[0].onwards)

    def test_warns_when_previous_invoice_total_does_not_match(self):
        statement = parse_statement_text(
            [self.page_one, self.page_two], previous_invoice_total=100
        )
        self.assertEqual(statement.validation_status, "warning")
        self.assertIn("前回請求金額", statement.warnings[0])


if __name__ == "__main__":
    unittest.main()
