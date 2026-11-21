import hashlib
import io
import json
import os
import unittest
from datetime import date
from dataclasses import replace
from decimal import Decimal
from unittest.mock import patch

from botocore.exceptions import ClientError

with patch("boto3.client"):
    import lambda_function

from statement_parser import Forecast, LineItem, ParsedStatement


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.presigned = None

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        content = self.objects[Key]
        content_type = "application/pdf" if Key.endswith(".pdf") else "application/json; charset=utf-8"
        return {
            "Body": io.BytesIO(content),
            "ContentType": content_type,
            "ETag": f'"{hashlib.sha256(content).hexdigest()}"',
        }

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body
        return {"ETag": f'"{hashlib.sha256(Body).hexdigest()}"'}

    def copy_object(self, Bucket, Key, CopySource, **kwargs):
        source_key = CopySource["Key"]
        if source_key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "CopyObject")
        self.objects[Key] = self.objects[source_key]
        return {}

    def list_objects_v2(self, Bucket, Prefix, **kwargs):
        return {"Contents": [{"Key": key} for key in sorted(self.objects) if key.startswith(Prefix)]}

    def download_file(self, Bucket, Key, Filename):
        with open(Filename, "wb") as stream:
            stream.write(self.objects[Key])

    def generate_presigned_post(self, **kwargs):
        self.presigned = kwargs
        return {"url": "https://example.invalid", "fields": {"key": kwargs["Key"]}}

    def generate_presigned_url(self, ClientMethod, Params, ExpiresIn):
        self.presigned_url = (ClientMethod, Params, ExpiresIn)
        return "https://example.invalid/original.pdf"


def statement():
    item = LineItem(
        line_seq=1,
        trade_date=date(2026, 9, 1),
        trade_no="1234567890",
        item_name_raw="スイカル",
        spec_raw="1KG",
        item_name="スイカル",
        spec="1KG",
        quantity=Decimal("1"),
        unit_price=Decimal("1000"),
        amount=1000,
        tax_flag="内",
        department="第4事業所",
        note="",
    )
    return ParsedStatement(
        invoice_no="04026970",
        issue_date=date(2026, 10, 2),
        closing_date=date(2026, 9, 30),
        settlement_date=date(2026, 10, 31),
        settlement_method="振替",
        total_amount=1000,
        previous_amount=0,
        tax_amount=0,
        items=[item],
    )


class FinanceApiTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        patcher = patch.object(lambda_function, "S3", self.s3)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = patch.dict(os.environ, {"FINANCE_BUCKET": "finance-private"})
        env.start()
        self.addCleanup(env.stop)
        self.claims = {
            "token_use": "access",
            "client_id": lambda_function.CLIENT_ID,
            "iss": lambda_function.ISSUER,
            "scope": "openid",
            "sub": "test-user",
            "cognito:groups": "[family]",
        }
        self.source = f"uploads/{'a' * 32}.pdf"
        self.s3.objects[self.source] = b"mock pdf"

    def call(self, route, data=None, claims=None):
        return lambda_function.lambda_handler({
            "routeKey": route,
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
            "body": json.dumps(data or {}),
        }, None)

    def save(self, key, value):
        self.s3.objects[key] = json.dumps(value, ensure_ascii=False).encode("utf-8")

    def test_missing_auth_and_worker_are_rejected(self):
        self.assertEqual(self.call("GET /finance/invoices", claims={})["statusCode"], 401)
        self.assertEqual(self.call("GET /finance/supplier-invoices", claims={})["statusCode"], 401)
        claims = {**self.claims, "cognito:groups": "[worker]"}
        self.assertEqual(self.call("GET /finance/invoices", claims=claims)["statusCode"], 403)
        self.assertEqual(self.call("GET /finance/supplier-invoices", claims=claims)["statusCode"], 403)

    def test_family_upload_is_pdf_size_limited(self):
        result = self.call("POST /finance/uploads")
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(self.s3.presigned["Bucket"], "finance-private")
        self.assertIn(["content-length-range", 1, lambda_function.MAX_PDF_BYTES],
                      self.s3.presigned["Conditions"])
        self.assertTrue(json.loads(result["body"])["key"].startswith("uploads/"))

    def paper_invoice_payload(self, source_file="supplier/uploads/" + "c" * 32 + ".pdf"):
        self.s3.objects[source_file] = b"%PDF-1.7\nprivate test invoice"
        return {
            "source_file": source_file,
            "vendor_name": "あさひ資材店",
            "issue_date": "2026-10-12",
            "settlement_date": None,
            "total_amount": 100,
            "items": [
                {"item_name": "苗", "amount": 110, "category": "種苗費", "subcategory": ""},
                {"item_name": "値引き", "amount": -10, "category": "未分類", "subcategory": ""},
            ],
            "verified": True,
        }

    def test_paper_classification_updates_existing_invoice_and_preserves_bank_link(self):
        payload = self.paper_invoice_payload()
        created = json.loads(self.call("POST /finance/supplier-invoices", payload)["body"])
        invoice_no = created["invoice_no"]
        request = {"source": "paper", "invoice_no": invoice_no, "signature": created["signature"],
                   "items": [{"line_seq": 1, "category": "肥料費"}]}
        key = f"supplier/invoices/{invoice_no}.json"
        etag = self.s3.get_object(Bucket="finance-private", Key=key)["ETag"]
        with patch.object(self.s3, "put_object", wraps=self.s3.put_object) as put:
            response = self.call("POST /finance/classifications", request)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(put.call_args.kwargs["IfMatch"], etag)
        updated = json.loads(response["body"])["invoice"]
        self.assertEqual(updated["items"][0]["category"], "肥料費")
        self.assertNotEqual(updated["signature"], created["signature"])
        catalog = json.loads(self.call("GET /bank/invoice-links")["body"])
        paper = next(item for item in catalog["invoices"] if item["source"] == "paper")
        self.assertEqual(paper["signature"], created["signature"])
        self.assertEqual(paper["breakdown"][0]["category"], "肥料費")
        self.assertEqual(self.call("POST /finance/classifications", request)["statusCode"], 409)
        self.assertEqual(self.call("POST /finance/supplier-invoices", payload)["statusCode"], 409)
        payload["items"][0]["category"] = "肥料費"
        self.assertEqual(self.call("POST /finance/supplier-invoices", payload)["statusCode"], 200)

    def test_paper_classification_rejects_bad_rows_and_concurrent_writes(self):
        created = json.loads(self.call("POST /finance/supplier-invoices", self.paper_invoice_payload())["body"])
        request = {"source": "paper", "invoice_no": created["invoice_no"], "signature": created["signature"],
                   "items": [{"line_seq": 1, "category": "農薬費"}]}
        for changes in ([{"line_seq": True, "category": "農薬費"}],
                        [{"line_seq": 1, "category": "無効"}],
                        [{"line_seq": 1, "category": "農薬費"}, {"line_seq": 1, "category": "肥料費"}]):
            self.assertEqual(self.call("POST /finance/classifications", {**request, "items": changes})["statusCode"], 400)
        with patch.object(self.s3, "put_object", side_effect=ClientError(
                {"Error": {"Code": "PreconditionFailed"}}, "PutObject")):
            self.assertEqual(self.call("POST /finance/classifications", request)["statusCode"], 409)
        invoice = json.loads(self.call("GET /finance/supplier-invoices")["body"])["invoices"][0]
        self.assertEqual(invoice["items"][0]["category"], "種苗費")

    def test_paper_invoice_upload_save_list_original_and_bank_link(self):
        ticket = self.call("POST /finance/supplier-uploads")
        self.assertEqual(ticket["statusCode"], 200)
        ticket_body = json.loads(ticket["body"])
        self.assertRegex(ticket_body["key"], r"^supplier/uploads/[a-f0-9]{32}\.pdf$")
        self.assertEqual(self.s3.presigned["Bucket"], "finance-private")
        self.assertIn(["content-length-range", 1, lambda_function.MAX_PDF_BYTES],
                      self.s3.presigned["Conditions"])

        payload = self.paper_invoice_payload()
        result = self.call("POST /finance/supplier-invoices", payload)
        self.assertEqual(result["statusCode"], 200)
        saved = json.loads(result["body"])
        invoice_no = saved["invoice_no"]
        self.assertEqual(saved["source"], "paper")
        self.assertRegex(invoice_no, r"^[a-f0-9]{32}$")
        record_key = f"supplier/invoices/{invoice_no}.json"
        original_key = f"supplier/invoices/{invoice_no}.pdf"
        record = json.loads(self.s3.objects[record_key])
        self.assertEqual(record["vendor_name"], "あさひ資材店")
        self.assertEqual(record["source"], "paper")
        self.assertEqual(record["source_file"], original_key)
        self.assertIn(original_key, self.s3.objects)
        self.assertEqual(record["breakdown"][0]["category"], "種苗費")
        self.assertEqual(record["breakdown"][1]["amount"], -10)

        listing = self.call("GET /finance/supplier-invoices")
        listed_invoice = json.loads(listing["body"])["invoices"][0]
        self.assertEqual(listed_invoice["vendor_name"], "あさひ資材店")
        self.assertNotIn("pdf_sha256", listed_invoice)
        self.assertNotIn("source_file", listed_invoice)
        catalog = self.call("GET /bank/invoice-links")
        linked_invoice = json.loads(catalog["body"])["invoices"][0]
        self.assertEqual(linked_invoice["source"], "paper")
        self.assertEqual(linked_invoice["signature"], saved["signature"])
        self.assertEqual(sum(part["amount"] for part in linked_invoice["breakdown"]), 100)

        original = self.call("POST /finance/supplier-original", {"invoice_no": invoice_no})
        self.assertEqual(json.loads(original["body"])["url"], "https://example.invalid/original.pdf")
        self.assertEqual(self.s3.presigned_url[1]["Key"], original_key)
        self.assertEqual(self.s3.presigned_url[2], 300)

        statement_id, transaction_id = "1" * 64, "2" * 64
        self.save(f"bank/statements/{statement_id}.json", {
            "statement_id": statement_id,
            "items": [{"transaction_id": transaction_id, "deposit": 0, "withdrawal": 100}],
        })
        statement_revision = self.s3.get_object(
            Bucket="finance-private", Key=f"bank/statements/{statement_id}.json",
        )["ETag"]
        link = self.call("POST /bank/invoice-links", {
            "statement_id": statement_id,
            "transaction_id": transaction_id,
            "statement_revision": statement_revision,
            "revision": "",
            "invoice_no": invoice_no,
            "source": "paper",
            "invoice_signature": saved["signature"],
        })
        self.assertEqual(link["statusCode"], 200)
        link_body = json.loads(link["body"])
        self.assertEqual(link_body["links"][0]["source"], "paper")

        other_statement_id, other_transaction_id = "3" * 64, "4" * 64
        self.save(f"bank/statements/{other_statement_id}.json", {
            "statement_id": other_statement_id,
            "items": [{"transaction_id": other_transaction_id, "deposit": 0, "withdrawal": 100}],
        })
        other_revision = self.s3.get_object(
            Bucket="finance-private", Key=f"bank/statements/{other_statement_id}.json",
        )["ETag"]
        duplicate_link = self.call("POST /bank/invoice-links", {
            "statement_id": other_statement_id,
            "transaction_id": other_transaction_id,
            "statement_revision": other_revision,
            "revision": link_body["revision"],
            "invoice_no": invoice_no,
            "source": "paper",
            "invoice_signature": saved["signature"],
        })
        self.assertEqual(duplicate_link["statusCode"], 409)

    def test_paper_invoice_rejects_unverified_invalid_and_duplicate_submissions(self):
        payload = self.paper_invoice_payload()
        for changes in [
            {"verified": False},
            {"vendor_name": " "},
            {"issue_date": "2026-02-30"},
            {"source_file": "../invoices/private.pdf"},
            {"items": [{"item_name": "苗", "amount": 100, "category": "売上", "subcategory": ""}]},
            {"total_amount": 101},
        ]:
            result = self.call("POST /finance/supplier-invoices", {**payload, **changes})
            self.assertEqual(result["statusCode"], 400, changes)
        self.assertFalse(any(key.startswith("supplier/invoices/") and key.endswith(".json")
                             for key in self.s3.objects))

        first = self.call("POST /finance/supplier-invoices", payload)
        self.assertEqual(first["statusCode"], 200)
        duplicate = self.call("POST /finance/supplier-invoices", payload)
        self.assertEqual(duplicate["statusCode"], 200)
        changed = self.call("POST /finance/supplier-invoices", {**payload, "vendor_name": "別の仕入先"})
        self.assertEqual(changed["statusCode"], 409)

    def test_reimport_preserves_manual_classification_and_is_idempotent(self):
        self.save("invoices/04026970.json", {
            "invoice_no": "04026970",
            "manual_overrides": {"1": {"category": "農薬費", "subcategory": "殺虫剤"}},
        })
        with patch.object(lambda_function, "parse_statement", side_effect=lambda _: statement()):
            for _ in range(2):
                result = lambda_function._import_record("finance-private", self.source)
                self.assertEqual(result["validation_status"], "ok")
        saved = json.loads(self.s3.objects["invoices/04026970.json"])
        self.assertEqual(len(saved["items"]), 1)
        self.assertEqual(saved["items"][0]["classified_by"], "manual")
        self.assertEqual(saved["items"][0]["subcategory"], "殺虫剤")

    def test_failed_import_does_not_replace_valid_invoice(self):
        original = {"invoice_no": "04026970", "total_amount": 1000}
        self.save("invoices/04026970.json", original)
        failed = statement()
        failed.validation_errors.append("合計不一致")
        with patch.object(lambda_function, "parse_statement", return_value=failed):
            result = lambda_function._import_record("finance-private", self.source)
        self.assertEqual(result["validation_status"], "failed")
        self.assertEqual(json.loads(self.s3.objects["invoices/04026970.json"]), original)
        self.assertIn(f"imports/{'a' * 32}.json", self.s3.objects)

    def test_review_confirmation_survives_reload_reimport_and_reclassification(self):
        parsed = statement()
        parsed.items = [replace(parsed.items[0], amount=150000)]
        with patch.object(lambda_function, "parse_statement", return_value=parsed):
            lambda_function._import_record("finance-private", self.source)
            payload = {"invoice_no": "04026970", "line_seq": 1, "review_confirmed": True}
            result = self.call("POST /finance/classifications", payload)
            self.assertEqual(result["statusCode"], 200)
            self.assertTrue(json.loads(result["body"])["review_confirmed"])
            original = json.loads(self.s3.objects["invoices/04026970.json"])
            reason = original["items"][0]["review_reason"]
            self.assertTrue(original["items"][0]["needs_review"])
            self.assertTrue(original["items"][0]["review_confirmed"])
            lambda_function._import_record("finance-private", self.source)
            lambda_function._reclassify_invoices("finance-private", lambda_function.DEFAULT_RULES)
            saved = json.loads(self.s3.objects["invoices/04026970.json"])
            self.assertTrue(saved["items"][0]["review_confirmed"])
            self.assertEqual(saved["items"][0]["review_reason"], reason)
            self.assertEqual(saved["review_confirmations"], original["review_confirmations"])
            self.assertEqual(self.call("POST /finance/classifications", {
                **payload, "review_confirmed": False,
            })["statusCode"], 200)
            saved = json.loads(self.s3.objects["invoices/04026970.json"])
            self.assertFalse(saved["items"][0]["review_confirmed"])
            self.assertTrue(saved["items"][0]["needs_review"])
            self.assertEqual(saved["review_confirmations"], {})

    def test_changed_reimported_line_requires_review_again(self):
        parsed = statement()
        parsed.items = [replace(parsed.items[0], amount=150000)]
        with patch.object(lambda_function, "parse_statement", return_value=parsed):
            lambda_function._import_record("finance-private", self.source)
            self.call("POST /finance/classifications", {
                "invoice_no": "04026970", "line_seq": 1, "review_confirmed": True,
            })
            parsed.items = [replace(parsed.items[0], amount=160000)]
            lambda_function._import_record("finance-private", self.source)
            saved = json.loads(self.s3.objects["invoices/04026970.json"])
            self.assertFalse(saved["items"][0]["review_confirmed"])
            self.assertEqual(saved["review_confirmations"], {})

    def test_review_validation_and_auth_never_write_invalid_confirmation(self):
        self.save("invoices/04026970.json", lambda_function._statement_json(statement()))
        payload = {"invoice_no": "04026970", "line_seq": 1, "review_confirmed": True}
        for changes in [
            {"line_seq": True}, {"line_seq": 0}, {"review_confirmed": "true"},
            {"invoice_no": "../bad"}, {"category": "農薬費"},
        ]:
            self.assertEqual(self.call("POST /finance/classifications", {
                **payload, **changes,
            })["statusCode"], 400)
        self.assertEqual(self.call("POST /finance/classifications", payload)["statusCode"], 400)
        self.assertEqual(self.call("POST /finance/classifications", {
            **payload, "line_seq": 2,
        })["statusCode"], 404)
        self.assertEqual(self.call("POST /finance/classifications", payload, claims={})["statusCode"], 401)
        self.assertEqual(self.call("POST /finance/classifications", payload, claims={
            **self.claims, "cognito:groups": "[worker]",
        })["statusCode"], 403)
        saved = json.loads(self.s3.objects["invoices/04026970.json"])
        self.assertNotIn("review_confirmations", saved)

    def test_classification_keeps_confirmation_only_when_review_reason_is_unchanged(self):
        parsed = statement()
        parsed.items = [replace(parsed.items[0], amount=150000)]
        with patch.object(lambda_function, "parse_statement", return_value=parsed):
            lambda_function._import_record("finance-private", self.source)
        self.call("POST /finance/classifications", {
            "invoice_no": "04026970", "line_seq": 1, "review_confirmed": True,
        })
        result = self.call("POST /finance/classifications", {
            "invoice_no": "04026970", "line_seq": 1, "category": "肥料費", "subcategory": "その他",
        })
        self.assertEqual(result["statusCode"], 200)
        saved = json.loads(self.s3.objects["invoices/04026970.json"])
        self.assertTrue(saved["items"][0]["review_confirmed"])

    def test_parse_exception_logs_locations_without_exception_content(self):
        with patch.object(lambda_function, "parse_statement", side_effect=ValueError("private content")):
            with self.assertLogs(lambda_function.LOGGER, level="WARNING") as logs:
                report = lambda_function._import_record("finance-private", self.source)
        self.assertEqual(report["validation_status"], "failed")
        self.assertIn("locations=", logs.output[0])
        self.assertIn("lambda_function.py:", logs.output[0])
        self.assertNotIn("private content", logs.output[0])

    def test_remembered_rule_and_manual_override_are_saved(self):
        self.save("invoices/04026970.json", lambda_function._statement_json(statement()))
        result = self.call("POST /finance/classifications", {
            "invoice_no": "04026970",
            "line_seq": 1,
            "category": "農薬費",
            "subcategory": "殺虫剤",
            "remember": True,
        })
        self.assertEqual(result["statusCode"], 200)
        saved = json.loads(self.s3.objects["invoices/04026970.json"])
        self.assertEqual(saved["items"][0]["classified_by"], "manual")
        self.assertEqual(saved["items"][0]["subcategory"], "殺虫剤")
        self.assertEqual(json.loads(self.s3.objects["classification-rules.json"])[0]["keyword"], "スイカル")

    def test_credit_missing_numbers_survive_serialization_and_classification(self):
        parsed = statement()
        parsed.items = [replace(parsed.items[0], quantity=None, unit_price=None, amount=-176)]
        parsed.forecasts = [Forecast("2027-02", 117691, onwards=True)]
        stored = lambda_function._statement_json(parsed)
        self.assertIsNone(stored["items"][0]["quantity"])
        self.assertIsNone(stored["items"][0]["unit_price"])
        self.assertEqual(lambda_function._item_model(stored["items"][0]), parsed.items[0])
        self.assertTrue(stored["forecasts"][0]["onwards"])
        self.save("invoices/04026970.json", stored)
        result = self.call("POST /finance/classifications", {
            "invoice_no": "04026970", "line_seq": 1,
            "category": "未分類", "subcategory": "",
        })
        self.assertEqual(result["statusCode"], 200)
        saved = json.loads(self.s3.objects["invoices/04026970.json"])
        self.assertEqual(saved["items"][0]["amount"], -176)
        self.assertIsNone(saved["items"][0]["quantity"])
        self.assertIsNone(saved["items"][0]["unit_price"])
        self.assertTrue(saved["forecasts"][0]["onwards"])

    def test_previous_month_reconciliation_ignores_older_months(self):
        self.save("invoices/older.json", {
            "invoice_no": "older",
            "closing_date": "2026-07-31",
            "total_amount": 7000,
            "validation_status": "ok",
        })
        self.assertIsNone(lambda_function._previous_invoice_total("finance-private", "2026-09-30", "04026970"))
        self.save("invoices/previous.json", {
            "invoice_no": "previous",
            "closing_date": "2026-08-31",
            "total_amount": 8000,
            "validation_status": "ok",
        })
        self.assertEqual(lambda_function._previous_invoice_total("finance-private", "2026-09-30", "04026970"), 8000)


if __name__ == "__main__":
    unittest.main()
