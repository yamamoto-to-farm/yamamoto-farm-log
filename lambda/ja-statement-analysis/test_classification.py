import unittest
from datetime import date
from decimal import Decimal

from classifier import DEFAULT_RULES, ClassificationRule, classify
from statement_parser import LineItem


def item(name, amount=1000, department="第4事業所", spec=""):
    return LineItem(
        line_seq=1,
        trade_date=date(2026, 9, 1),
        trade_no="1234567890",
        item_name_raw=name,
        spec_raw=spec,
        item_name=name,
        spec=spec,
        quantity=Decimal("1"),
        unit_price=Decimal(amount),
        amount=amount,
        tax_flag="内",
        department=department,
        note="",
    )


class ClassificationTests(unittest.TestCase):
    def test_classifies_known_products_and_department_fallback(self):
        cases = [
            ("プレバソンフロアブル５", "農薬費", "殺虫剤"),
            ("ザクサ液剤", "農薬費", "除草剤"),
            ("スイカル（葉面散布用）", "肥料費", "葉面散布"),
            ("トラクタ－部品", "機械部品・装備", ""),
            ("整備工賃", "機械整備工賃", ""),
            ("消耗部品", "機械部品・装備", "消耗品"),
            ("資材費", "資材・消耗品", "整備付帯"),
        ]
        for name, category, subcategory in cases:
            with self.subTest(name=name):
                result = classify([item(name)])[0]
                self.assertEqual((result.category, result.subcategory), (category, subcategory))
        unknown = classify([item("未知の商品")])[0]
        self.assertEqual(unknown.classified_by, "rule(dept)")
        self.assertTrue(unknown.needs_review)
        fieldstar = classify([item("フィールドスターＰ乳剤")])[0]
        self.assertEqual(fieldstar.subcategory, "要確認")
        self.assertTrue(fieldstar.needs_review)

    def test_high_amount_threshold_is_inclusive(self):
        for amount, expected in ((99999, False), (100000, True), (301630, True)):
            with self.subTest(amount=amount):
                result = classify([item("トラクタ－部品", amount, "農機課")])[0]
                self.assertEqual(result.needs_review, expected)

    def test_added_rule_reclassifies_without_mutating_source(self):
        source = item("フィールドスターＰ乳剤")
        rule = ClassificationRule("フィールドスター", "農薬費", "殺菌剤", priority=200)
        result = classify([source], [*DEFAULT_RULES, rule])[0]
        self.assertEqual(result.subcategory, "殺菌剤")
        self.assertFalse(result.needs_review)
        self.assertEqual(source.category, "未分類")


if __name__ == "__main__":
    unittest.main()
