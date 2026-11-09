import hashlib
import json
import unittest
from unittest.mock import patch

from botocore.exceptions import ClientError

from bank_statement_parser import parse_bank_statement
from test_lambda_function import FakeS3
import lambda_function


COVER = """金融機関コード:9999
店番:001 科目:普通
口座番号:1234567
【取得期間】
2026/10/01から
2026/10/31まで"""
HEADERS = "お取引日付 お支払金額 お預り金額 差引後残高"


class Page:
    rotation = 0
    mediabox = type("Box", (), {"width": 595, "height": 842})()

    def __init__(self, text="", rows=()):
        self.text, self.rows = text, rows

    def extract_text(self, extraction_mode=None, visitor_text=None):
        if visitor_text:
            for x, y, text in self.rows:
                visitor_text(text, [1, 0, 0, -1, 0, 842], [1, 0, 0, -1, x, y], None, 8)
        return self.text + ("\n" + "\n".join(text for x, _, text in self.rows if x == 27) if extraction_mode == "layout" else "")


def reader(cover=COVER, second_balance="1,050", missing=False):
    rows = [
        (27, 67, "2026-10-01"), (77, 67, "キャベツ"), (278, 67, "100"), (383, 67, "1,100"),
        (27, 86, "2026-10-02"), (166, 86, "50"), (194, 86, "ATM出金"), (383, 86, second_balance),
    ]
    if missing:
        rows.pop()
    return type("Reader", (), {"is_encrypted": False, "pages": [Page(cover), Page(HEADERS, rows)]})()


def parsed():
    with patch("bank_statement_parser.PdfReader", return_value=reader()):
        return parse_bank_statement("unused.pdf")


class BankParserTests(unittest.TestCase):
    def test_separate_columns_totals_balances_and_stable_ids(self):
        value = parsed()
        self.assertEqual(value["validation_status"], "ok")
        self.assertEqual((value["deposit_total"], value["withdrawal_total"]), (100, 50))
        self.assertEqual((value["opening_balance"], value["closing_balance"]), (1000, 1050))
        self.assertEqual(value["items"][0]["category"], "売上")
        self.assertEqual(value["items"][1]["category"], "現金移動")
        self.assertFalse(value["items"][0]["review_confirmed"])
        self.assertEqual(value["statement_id"], parsed()["statement_id"])
        self.assertEqual(value["items"][0]["transaction_id"], parsed()["items"][0]["transaction_id"])
        self.assertNotIn("1234567", json.dumps(value, ensure_ascii=False))

    def test_balance_mismatch_and_missing_columns_fail(self):
        for sample in [reader(second_balance="1,000"), reader(missing=True)]:
            with patch("bank_statement_parser.PdfReader", return_value=sample):
                value = parse_bank_statement("unused.pdf")
            self.assertEqual(value["validation_status"], "failed")
            self.assertTrue(value["validation_errors"])

    def test_partial_multi_month_wrong_cover_and_scanned_table_rejected(self):
        for cover in [COVER.replace("10/01", "10/02"), COVER.replace("10/31", "11/30"), "unknown"]:
            with patch("bank_statement_parser.PdfReader", return_value=reader(cover=cover)):
                with self.assertRaises(ValueError):
                    parse_bank_statement("unused.pdf")
        sample = reader()
        sample.pages[1].rows = []
        with patch("bank_statement_parser.PdfReader", return_value=sample):
            self.assertEqual(parse_bank_statement("unused.pdf")["validation_status"], "failed")

    def test_multi_page_continuity_and_numeric_memo_are_not_amounts(self):
        sample = reader()
        sample.pages.append(Page(HEADERS, [
            (27, 67, "2026-10-03"), (166, 67, "50"), (194, 67, "123456"), (383, 67, "1,000"),
        ]))
        with patch("bank_statement_parser.PdfReader", return_value=sample):
            value = parse_bank_statement("unused.pdf")
        self.assertEqual(value["validation_status"], "ok")
        self.assertEqual(value["items"][-1]["memo"], "123456")
        self.assertEqual(value["items"][-1]["category"], "未分類")

    def test_date_in_memo_does_not_create_duplicate_and_unlocated_rows_fail(self):
        sample = reader()
        sample.pages[1].rows.append((194, 67, "2026-10-01"))
        with patch("bank_statement_parser.PdfReader", return_value=sample):
            value = parse_bank_statement("unused.pdf")
        self.assertEqual(len(value["items"]), 2)
        self.assertEqual(value["validation_status"], "ok")
        sample.pages[1].text += "\n2026-10-03"
        with patch("bank_statement_parser.PdfReader", return_value=sample):
            self.assertEqual(parse_bank_statement("unused.pdf")["validation_status"], "failed")


class VersionedS3(FakeS3):
    def get_object(self, **kwargs):
        result = super().get_object(**kwargs)
        result["ETag"] = '"' + hashlib.md5(self.objects[kwargs["Key"]]).hexdigest() + '"'
        return result

    def head_object(self, Bucket, Key):
        return {"ContentLength": len(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        existing = self.objects.get(Key)
        etag = '"' + hashlib.md5(existing).hexdigest() + '"' if existing is not None else None
        if (kwargs.get("IfNoneMatch") == "*" and existing is not None) or (kwargs.get("IfMatch") and kwargs["IfMatch"] != etag):
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        super().put_object(Bucket, Key, Body, **kwargs)
        return {"ETag": '"' + hashlib.md5(Body).hexdigest() + '"'}


class BankApiTests(unittest.TestCase):
    def setUp(self):
        self.s3 = VersionedS3()
        self.patch = patch.object(lambda_function, "S3", self.s3)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        env = patch.dict("os.environ", {"FINANCE_BUCKET": "finance-private"})
        env.start()
        self.addCleanup(env.stop)
        self.source = f"bank/uploads/{'a' * 32}.pdf"
        self.s3.objects[self.source] = b"%PDF-mock"
        self.value = parsed()
        self.key = f"bank/statements/{self.value['statement_id']}.json"
        self.claims = {
            "token_use": "access", "client_id": lambda_function.CLIENT_ID, "iss": lambda_function.ISSUER,
            "scope": "openid", "sub": "test", "cognito:groups": "[family]",
        }

    def call(self, route, data=None, parameters=None, claims=None):
        return lambda_function.lambda_handler({
            "routeKey": route, "pathParameters": parameters or {}, "body": json.dumps(data or {}),
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
        }, None)

    def import_pdf(self, value=None):
        with patch.object(lambda_function, "parse_bank_statement", return_value=value or parsed()):
            return lambda_function._bank_import_record("finance-private", self.source)

    def record(self):
        return lambda_function._bank_record("finance-private", self.value["statement_id"])

    def payload(self):
        record = self.record()
        return {"statement_id": record["statement_id"], "transaction_id": record["items"][0]["transaction_id"], "revision": record["revision"]}

    def test_auth_is_shared_and_bank_upload_prefix_and_size_limited(self):
        self.assertEqual(self.call("GET /bank/statements", claims={})["statusCode"], 401)
        self.assertEqual(self.call("GET /bank/statements", claims={**self.claims, "cognito:groups": "[worker]"})["statusCode"], 403)
        self.assertEqual(self.call("POST /bank/uploads")["statusCode"], 200)
        self.assertTrue(self.s3.presigned["Key"].startswith("bank/uploads/"))
        self.assertIn(["content-length-range", 1, lambda_function.MAX_PDF_BYTES], self.s3.presigned["Conditions"])

    def test_rules_create_update_delete_validation_and_conflict(self):
        self.import_pdf()
        state = lambda_function._bank_rules("finance-private")
        data = {"revision": state["revision"], "account_id": self.value["account_id"], "direction": "deposit",
                "contains": "ｷｬﾍﾞﾂ", "category": "その他入金"}
        self.assertEqual(self.call("GET /bank/rules", claims={})["statusCode"], 401)
        result = self.call("POST /bank/rules", data)
        self.assertEqual(result["statusCode"], 200)
        result = json.loads(result["body"])
        self.assertEqual(result["rules"][0]["contains"], "キャベツ")
        self.assertEqual(self.call("POST /bank/rules", data)["statusCode"], 409)
        self.assertEqual(self.call("POST /bank/rules", {**data, "revision": result["revision"]})["statusCode"], 409)
        update = {**data, "revision": result["revision"], "rule_id": result["rules"][0]["rule_id"]}
        for extra in [{"contains": " "}, {"category": "未分類"}, {"direction": "invalid"}, {"account_id": "f" * 64}]:
            self.assertEqual(self.call("POST /bank/rules", {**update, **extra})["statusCode"], 400)
        changed = json.loads(self.call("POST /bank/rules", {**update, "category": "売上"})["body"])
        deleted = self.call("POST /bank/rules", {"revision": changed["revision"], "rule_id": update["rule_id"], "delete": True})
        self.assertEqual(json.loads(deleted["body"])["rules"], [])

    def test_import_rules_candidates_conflicts_and_manual_preservation(self):
        self.import_pdf()
        rule = {"revision": "", "account_id": self.value["account_id"], "direction": "deposit",
                "contains": "キャベツ", "category": "その他入金"}
        self.assertEqual(self.call("POST /bank/rules", rule)["statusCode"], 200)
        self.import_pdf()
        item = self.record()["items"][0]
        self.assertEqual(item["category"], "その他入金")
        self.assertFalse(item["review_confirmed"])
        state = lambda_function._bank_rules("finance-private")
        self.assertEqual(self.call("POST /bank/rules", {**rule, "revision": state["revision"],
                                                       "contains": "ベツ", "category": "売上"})["statusCode"], 200)
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["category"], "未分類")
        self.assertIn("競合", self.record()["items"][0]["review_reason"])
        self.call("POST /bank/classifications", {**self.payload(), "category": "経費", "note": "keep"})
        self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["category"], "経費")
        self.assertTrue(self.record()["items"][0]["review_confirmed"])
        self.assertEqual(self.record()["items"][0]["note"], "keep")

    def test_rules_separate_account_direction_and_keep_confirmed_automatic_classification(self):
        value = parsed()
        rule = {"account_id": "other", "direction": "deposit", "contains": "キャベツ", "category": "経費"}
        lambda_function._bank_apply_rules(value, [rule])
        self.assertEqual(value["items"][0]["category"], "売上")
        rule["account_id"] = value["account_id"]
        rule["direction"] = "withdrawal"
        lambda_function._bank_apply_rules(value, [rule])
        self.assertEqual(value["items"][0]["category"], "売上")
        self.import_pdf()
        self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})
        self.call("POST /bank/rules", {"revision": "", **rule, "direction": "deposit"})
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["category"], "売上")
        self.assertTrue(self.record()["items"][0]["review_confirmed"])

    def test_reimport_preserves_classification_notes_confirmation_without_duplicates(self):
        self.import_pdf()
        payload = self.payload()
        self.assertEqual(self.call("POST /bank/classifications", {**payload, "category": "その他入金", "note": "用途確認"})["statusCode"], 200)
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})["statusCode"], 200)
        self.import_pdf()
        saved = self.record()
        self.assertEqual(len(saved["items"]), 2)
        self.assertEqual(saved["items"][0]["category"], "その他入金")
        self.assertEqual(saved["items"][0]["note"], "用途確認")
        self.assertTrue(saved["items"][0]["review_confirmed"])
        self.assertEqual(len([key for key in self.s3.objects if key.startswith("bank/statements/")]), 1)
        self.assertEqual(self.call("GET /finance/invoices")["statusCode"], 200)
        self.assertEqual(json.loads(self.call("GET /finance/invoices")["body"])["invoices"], [])

    def test_failed_import_keeps_previous_month_and_creates_failed_report(self):
        self.import_pdf()
        original = self.s3.objects[self.key]
        value = parsed()
        value.update(validation_status="failed", validation_errors=["不一致"])
        self.assertEqual(self.import_pdf(value)["validation_status"], "failed")
        self.assertEqual(self.s3.objects[self.key], original)
        with patch.object(lambda_function, "parse_bank_statement", side_effect=ValueError("対応外")):
            self.assertEqual(lambda_function._bank_import_record("finance-private", self.source)["validation_status"], "failed")
        self.assertEqual(self.s3.objects[self.key], original)

    def test_changed_transaction_does_not_inherit_manual_confirmation(self):
        self.import_pdf()
        self.call("POST /bank/classifications", {**self.payload(), "category": "その他入金", "note": "以前の用途"})
        self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})
        value = parsed()
        value["items"][0]["transaction_id"] = "f" * 64
        self.import_pdf(value)
        item = self.record()["items"][0]
        self.assertEqual(item["category"], "売上")
        self.assertFalse(item["review_confirmed"])
        self.assertEqual(item["note"], "")

    def test_stale_revision_invalid_payload_and_missing_transaction_fail(self):
        self.import_pdf()
        payload = self.payload()
        for changes in [{"category": "invalid"}, {"review_confirmed": "true"}, {"transaction_id": "../bad"},
                        {"transaction_id": "f" * 64, "category": "経費"}, {"category": "未分類", "review_confirmed": True},
                        {"category": "経費", "extra": 1}]:
            self.assertIn(self.call("POST /bank/classifications", {**payload, **changes})["statusCode"], (400, 404))
        self.assertEqual(self.call("POST /bank/classifications", {**payload, "category": "未分類"})["statusCode"], 200)
        self.assertEqual(self.call("POST /bank/classifications", {**payload, "category": "経費"})["statusCode"], 409)
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})["statusCode"], 400)

    def test_expanded_categories_and_subcategories_backward_compatible(self):
        self.import_pdf()
        for category in ("その他事業収入", "固定資産購入", "積立・預け金", "事業主入金", "事業主支出", "決済・内訳確認"):
            result = self.call("POST /bank/classifications", {**self.payload(), "category": category, "subcategory": "内訳テスト"})
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(self.record()["items"][0]["subcategory"], "内訳テスト")
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "category": "経費", "subcategory": "a" * 81})["statusCode"], 400)
        self.call("POST /bank/classifications", {**self.payload(), "category": "経費"})
        self.assertEqual(self.record()["items"][0]["subcategory"], "")

    def test_split_save_reimport_collapse_and_original_amount_identity_unchanged(self):
        self.import_pdf()
        original = self.record()
        parts = [{"category": "経費", "subcategory": "保険・共済掛金", "amount": 40},
                 {"category": "積立・預け金", "subcategory": "収入保険積立金", "amount": 60}]
        result = self.call("POST /bank/classifications", {**self.payload(), "allocations": parts, "review_confirmed": True})
        self.assertEqual(result["statusCode"], 200)
        saved = self.record()
        for field in ("opening_balance", "closing_balance", "deposit_total", "withdrawal_total"):
            self.assertEqual(saved[field], original[field])
        for field in ("transaction_id", "deposit", "withdrawal", "balance", "memo", "trade_date"):
            self.assertEqual(saved["items"][0][field], original["items"][0][field])
        self.assertEqual(saved["items"][0]["category"], "内訳分割")
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "category": "経費"})["statusCode"], 400)
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "allocations": parts})["statusCode"], 200)
        self.assertFalse(self.record()["items"][0]["review_confirmed"])
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["allocations"], parts)
        self.call("POST /bank/classifications", {**self.payload(), "allocations": [
            {"category": "積立・預け金", "subcategory": "戻す", "amount": 100}]})
        saved = self.record()["items"][0]
        self.assertEqual(saved["category"], "積立・預け金")
        self.assertEqual(saved["subcategory"], "戻す")
        self.assertEqual(saved["allocations"], [])

    def test_invalid_splits_never_write_and_unknown_parts_cannot_be_confirmed(self):
        self.import_pdf()
        part = {"category": "経費", "subcategory": "", "amount": 100}
        for parts in ([], [part] * 31, [{**part, "amount": 99}], [{**part, "amount": 0}],
                      [{**part, "amount": -100}], [{**part, "amount": 100.0}], [{**part, "amount": True}],
                      [{**part, "category": "内訳分割"}], [{**part, "subcategory": "x" * 81}],
                      [{**part, "amount": 9007199254740992}], [{**part, "extra": 1}]):
            before = self.record()["revision"]
            self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "allocations": parts})["statusCode"], 400)
            self.assertEqual(self.record()["revision"], before)
        parts = [{**part, "category": "未分類", "amount": 40}, {**part, "amount": 60}]
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "allocations": parts, "review_confirmed": True})["statusCode"], 400)
        self.call("POST /bank/classifications", {**self.payload(), "allocations": parts})
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "review_confirmed": True})["statusCode"], 400)
        thirty = [{**part, "amount": 1}] * 29 + [{**part, "amount": 71}]
        self.assertEqual(self.call("POST /bank/classifications", {**self.payload(), "allocations": thirty})["statusCode"], 200)

    def test_rules_include_subcategory_conflicts_and_preserve_legacy_manual_fields(self):
        self.import_pdf()
        rule = {"account_id": self.value["account_id"], "direction": "deposit",
                "contains": "キャベツ", "category": "売上", "subcategory": "キャベツ"}
        self.call("POST /bank/rules", {"revision": "", **rule})
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["subcategory"], "キャベツ")
        state = lambda_function._bank_rules("finance-private")
        self.call("POST /bank/rules", {"revision": state["revision"], **rule, "contains": "ベツ", "subcategory": "別内訳"})
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["category"], "未分類")
        self.call("POST /bank/classifications", {**self.payload(), "category": "経費"})
        self.import_pdf()
        self.assertEqual(self.record()["items"][0]["subcategory"], "")

    def test_conditional_write_cannot_overwrite_concurrent_edit(self):
        self.import_pdf()
        old = self.record()
        self.call("POST /bank/classifications", {**self.payload(), "category": "その他入金"})
        with self.assertRaises(ClientError):
            lambda_function._write_json("finance-private", self.key, old, condition=old["revision"])

    def test_s3_bank_event_detail_history_and_reimport_routes(self):
        with patch.object(lambda_function, "parse_bank_statement", side_effect=lambda _: parsed()):
            event = {"Records": [{"s3": {"bucket": {"name": "finance-private"}, "object": {"key": self.source}}}]}
            self.assertEqual(lambda_function.lambda_handler(event, None)["processed"], 1)
            self.assertEqual(self.call("GET /bank/statements/{statement_id}", parameters={"statement_id": self.value["statement_id"]})["statusCode"], 200)
            self.assertEqual(len(json.loads(self.call("GET /bank/imports")["body"])["imports"]), 1)
            self.assertEqual(self.call("GET /bank/imports/{import_id}", parameters={"import_id": "a" * 32})["statusCode"], 200)
            self.assertTrue(json.loads(self.call("POST /bank/reimport", {"statement_id": self.value["statement_id"], "revision": self.record()["revision"]})["body"])["saved"])
        with self.assertRaises(ValueError):
            lambda_function._bank_import_record("finance-private", "uploads/bad.pdf")


if __name__ == "__main__":
    unittest.main()
