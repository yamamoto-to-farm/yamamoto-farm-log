import importlib.util
import io
import json
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


class FakeClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


fake_s3 = MagicMock()
with patch.dict(sys.modules, {
    "boto3": types.SimpleNamespace(client=lambda service, **kwargs: fake_s3),
    "botocore": types.ModuleType("botocore"),
    "botocore.config": types.SimpleNamespace(Config=lambda **kwargs: kwargs),
    "botocore.exceptions": types.SimpleNamespace(ClientError=FakeClientError),
}):
    spec = importlib.util.spec_from_file_location("photo_api", Path(__file__).with_name("lambda_function.py"))
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)


class PhotoApiTests(unittest.TestCase):
    def setUp(self):
        fake_s3.reset_mock(return_value=True, side_effect=True)
        self.env = patch.dict(os.environ, {
            "PHOTO_BUCKET": "private-photo-test", "PHOTO_PREFIX": "photos/"
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.claims = {
            "token_use": "access", "client_id": api.CLIENT_ID, "iss": api.ISSUER,
            "scope": "email openid", "sub": "user-1"
        }

    def call(self, route, data=None, claims=None):
        event = {
            "routeKey": route,
            "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
        }
        if route in ("GET /photos", "GET /photos/by-date", "GET /photos/top", "GET /photos/search"):
            event["queryStringParameters"] = data
        else:
            event["body"] = json.dumps(data)
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def test_unauthenticated_and_wrong_claims_are_rejected_without_s3(self):
        variants = [{}, {**self.claims, "token_use": "id"},
                    {**self.claims, "client_id": "other"},
                    {**self.claims, "iss": "other"}, {**self.claims, "scope": "email"}]
        for claims in variants:
            with self.subTest(claims=claims):
                self.assertEqual(self.call("GET /photos", {"field": "A"}, claims)[0], 401)
        fake_s3.list_objects_v2.assert_not_called()
        fake_s3.put_object.assert_not_called()

    def test_upload_uses_private_prefix_fixed_type_and_size_limit(self):
        fake_s3.generate_presigned_post.return_value = {"url": "https://s3.invalid", "fields": {}}
        status, body = self.call("POST /photos/uploads", {
            "field": "圃場/../A", "takenOn": "2026-10-26", "note": "生育写真"
        })
        self.assertEqual(status, 200)
        self.assertRegex(body["id"], api.PHOTO_ID)
        args = fake_s3.generate_presigned_post.call_args.kwargs
        self.assertEqual(args["Bucket"], "private-photo-test")
        self.assertNotIn("..", args["Key"])
        self.assertTrue(args["Key"].startswith("photos/fields/"))
        self.assertEqual(args["ExpiresIn"], 300)
        self.assertIn(["content-length-range", 1, api.MAX_BYTES], args["Conditions"])
        self.assertEqual(args["Fields"]["Content-Type"], "image/jpeg")
        metadata = json.loads(fake_s3.put_object.call_args.kwargs["Body"])
        self.assertEqual(metadata["uploadedBy"], "user-1")

    def test_invalid_upload_metadata_rejected(self):
        for data in [
            {"field": "", "takenOn": "2026-10-26"},
            {"field": "A", "takenOn": "2026-02-30"},
            {"field": "A", "takenOn": "20261026"},
            {"field": "A", "takenOn": "2026-10-26", "note": "a" * 1001},
        ]:
            self.assertEqual(self.call("POST /photos/uploads", data)[0], 400)
        fake_s3.generate_presigned_post.assert_not_called()

    def test_empty_listing_and_pagination(self):
        fake_s3.list_objects_v2.return_value = {"Contents": [], "NextContinuationToken": "next"}
        status, body = self.call("GET /photos", {"field": "A", "cursor": "previous"})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"photos": [], "cursor": "next"})
        self.assertEqual(fake_s3.list_objects_v2.call_args.kwargs["MaxKeys"], 20)
        self.assertEqual(fake_s3.list_objects_v2.call_args.kwargs["ContinuationToken"], "previous")

    def metadata(self, user="user-1"):
        return {"id": "20261026T090000123456Z_" + "a" * 32, "field": "A",
                "imageKey": "photos/fields/hash/images/photo.jpg",
                "uploadedBy": user, "takenOn": "2026-10-26", "note": "memo"}

    def test_listing_issues_short_lived_url_without_storage_keys_or_user_id(self):
        metadata = self.metadata()
        fake_s3.list_objects_v2.return_value = {"Contents": [{"Key": "record.json"}]}
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(metadata).encode())}
        fake_s3.generate_presigned_url.return_value = "https://signed.invalid/image"
        status, body = self.call("GET /photos", {"field": "A"})
        self.assertEqual(status, 200)
        self.assertNotIn("imageKey", body["photos"][0])
        self.assertNotIn("uploadedBy", body["photos"][0])
        args = fake_s3.generate_presigned_url.call_args.kwargs
        self.assertEqual(args["ExpiresIn"], 300)
        self.assertEqual(args["Params"]["ResponseCacheControl"], "no-store")

    def test_complete_verifies_owner_image_type_size_and_signature(self):
        metadata = self.metadata()
        fake_s3.get_object.side_effect = [
            {"Body": io.BytesIO(json.dumps(metadata).encode())},
            {"Body": io.BytesIO(b"\xff\xd8\xff")},
        ]
        fake_s3.head_object.return_value = {"ContentType": "image/jpeg", "ContentLength": 100}
        status, body = self.call("POST /photos/complete", {"field": "A", "id": metadata["id"]})
        self.assertEqual(status, 200)
        self.assertEqual(body["id"], metadata["id"])
        keys = [c.kwargs["Key"] for c in fake_s3.put_object.call_args_list]
        self.assertTrue(any("/records/" in key for key in keys))
        self.assertIn(f"photos/by-date/2026-10-26/{metadata['id']}.json", keys)

    def test_by_date_lists_all_fields_without_private_fields(self):
        metadata = self.metadata()
        fake_s3.list_objects_v2.return_value = {"Contents": [{"Key": "photos/by-date/2026-10-26/x.json"}]}
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(metadata).encode())}
        fake_s3.generate_presigned_url.return_value = "https://signed.invalid/image"
        status, body = self.call("GET /photos/by-date", {"date": "2026-10-26"})
        self.assertEqual(status, 200)
        self.assertEqual(fake_s3.list_objects_v2.call_args.kwargs["Prefix"], "photos/by-date/2026-10-26/")
        self.assertNotIn("imageKey", body["photos"][0])
        self.assertNotIn("uploadedBy", body["photos"][0])

    def test_top_photo_requires_admin_or_family_group(self):
        pid = "20261026T090000123456Z_" + "a" * 32
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(self.metadata()).encode())}
        for groups in (None, "[worker]"):
            claims = dict(self.claims)
            if groups:
                claims["cognito:groups"] = groups
            self.assertEqual(self.call("POST /photos/top", {"field": "A", "id": pid}, claims)[0], 403)
        fake_s3.put_object.assert_not_called()
        for groups in ("[family]", "[worker admin]"):
            fake_s3.put_object.reset_mock()
            fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(self.metadata()).encode())}
            status, _ = self.call("POST /photos/top", {"field": "A", "id": pid}, {**self.claims, "cognito:groups": groups})
            self.assertEqual(status, 200)
            self.assertIn("photos/tops/", fake_s3.put_object.call_args.kwargs["Key"])

    def test_top_photo_must_exist_and_have_valid_id(self):
        claims = {**self.claims, "cognito:groups": "[admin]"}
        self.assertEqual(self.call("POST /photos/top", {"field": "A", "id": "../x"}, claims)[0], 400)
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        pid = "20261026T090000123456Z_" + "a" * 32
        self.assertEqual(self.call("POST /photos/top", {"field": "A", "id": pid}, claims)[0], 404)
        fake_s3.put_object.assert_not_called()

    def test_get_top_returns_photo_or_none(self):
        metadata = self.metadata()
        fake_s3.generate_presigned_url.return_value = "https://signed.invalid/image"
        fake_s3.get_object.side_effect = [
            {"Body": io.BytesIO(json.dumps({"id": metadata["id"]}).encode())},
            {"Body": io.BytesIO(json.dumps(metadata).encode())},
        ]
        status, body = self.call("GET /photos/top", {"field": "A"})
        self.assertEqual(status, 200)
        self.assertEqual(body["photo"]["url"], "https://signed.invalid/image")
        self.assertNotIn("uploadedBy", body["photo"])
        fake_s3.get_object.side_effect = FakeClientError("NoSuchKey")
        self.assertEqual(self.call("GET /photos/top", {"field": "A"}), (200, {"photo": None}))

    def test_by_date_rejects_bad_date_and_anonymous(self):
        self.assertEqual(self.call("GET /photos/by-date", {"date": "2026-13-01"})[0], 400)
        self.assertEqual(self.call("GET /photos/by-date", {"date": "../"})[0], 400)
        self.assertEqual(self.call("GET /photos/by-date", {"date": "2026-10-26"}, {})[0], 401)

    def test_backfill_indexes_only_records(self):
        metadata = self.metadata()
        fake_s3.list_objects_v2.return_value = {"Contents": [
            {"Key": "photos/fields/h/images/a.jpg"}, {"Key": "photos/fields/h/records/a.json"}]}
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(metadata).encode())}
        result = api.lambda_handler({"action": "backfill"}, None)
        self.assertEqual(result, {"indexed": 1})
        self.assertIn("by-date/2026-10-26/", fake_s3.put_object.call_args.kwargs["Key"])

    def test_api_event_cannot_trigger_backfill(self):
        fake_s3.list_objects_v2.return_value = {"Contents": []}
        status, _ = self.call("GET /photos/by-date", {"date": "2026-10-26", "action": "backfill"})
        self.assertEqual(status, 200)
        fake_s3.put_object.assert_not_called()

    def test_other_user_cannot_complete_upload(self):
        metadata = self.metadata("user-2")
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(metadata).encode())}
        self.assertEqual(self.call("POST /photos/complete", {"field": "A", "id": metadata["id"]})[0], 403)
        fake_s3.head_object.assert_not_called()
        fake_s3.put_object.assert_not_called()

    def test_missing_image_returns_conflict(self):
        metadata = self.metadata()
        fake_s3.get_object.return_value = {"Body": io.BytesIO(json.dumps(metadata).encode())}
        fake_s3.head_object.side_effect = FakeClientError("404")
        self.assertEqual(self.call("POST /photos/complete", {"field": "A", "id": metadata["id"]})[0], 409)
        fake_s3.put_object.assert_not_called()

    def test_invalid_image_not_registered(self):
        metadata = self.metadata()
        for content_type, size, signature in [
            ("text/html", 100, b"\xff\xd8\xff"),
            ("image/jpeg", api.MAX_BYTES + 1, b"\xff\xd8\xff"),
            ("image/jpeg", 100, b"<ht"),
        ]:
            fake_s3.get_object.side_effect = [
                {"Body": io.BytesIO(json.dumps(metadata).encode())},
                {"Body": io.BytesIO(signature)},
            ]
            fake_s3.head_object.return_value = {"ContentType": content_type, "ContentLength": size}
            self.assertEqual(self.call("POST /photos/complete", {"field": "A", "id": metadata["id"]})[0], 400)
        fake_s3.put_object.assert_not_called()

    def test_invalid_id_cannot_read_arbitrary_s3_keys(self):
        self.assertEqual(self.call("POST /photos/complete", {"field": "A", "id": "../secret"})[0], 400)
        fake_s3.get_object.assert_not_called()

    def test_invalid_cursor_has_actionable_error(self):
        fake_s3.list_objects_v2.side_effect = FakeClientError("InvalidArgument")
        status, body = self.call("GET /photos", {"field": "A", "cursor": "bad"})
        self.assertEqual(status, 400)
        self.assertIn("一覧を更新", body["message"])

    def test_s3_failure_is_not_reported_as_empty_success(self):
        fake_s3.list_objects_v2.side_effect = FakeClientError("AccessDenied")
        with self.assertLogs(api.LOGGER, level="ERROR"):
            status, body = self.call("GET /photos", {"field": "A"})
        self.assertEqual(status, 500)
        self.assertNotIn("photos", body)

    def record(self, day, suffix, field="A", user="user-1"):
        photo_id = f"{day.replace('-', '')}T090000000000Z_{suffix * 32}"
        return {"id": photo_id, "field": field, "takenOn": day, "note": "", "uploadedBy": user,
                "imageKey": f"photos/fields/h/images/{photo_id}.jpg"}

    def serve(self, records):
        by_key = {f"photos/by-date/{r['takenOn']}/{r['id']}.json": r for r in records}
        fake_s3.list_objects_v2.return_value = {"Contents": [{"Key": key} for key in by_key]}
        fake_s3.get_object.side_effect = lambda Bucket, Key, **kwargs: {
            "Body": io.BytesIO(json.dumps(by_key[Key]).encode())}
        fake_s3.generate_presigned_url.return_value = "https://signed.invalid/image"

    def test_search_returns_newest_first_with_range_and_delete_flag(self):
        self.serve([self.record("2026-10-01", "a"), self.record("2026-10-20", "b", user="other")])
        status, body = self.call("GET /photos/search", {"from": "2026-10-01", "to": "2026-10-31"})
        self.assertEqual(status, 200)
        self.assertEqual([p["takenOn"] for p in body["photos"]], ["2026-10-20", "2026-10-01"])
        self.assertEqual([p["canDelete"] for p in body["photos"]], [False, True])
        self.assertIsNone(body["cursor"])
        self.assertNotIn("uploadedBy", body["photos"][0])
        self.assertEqual(fake_s3.list_objects_v2.call_args.kwargs["StartAfter"], "photos/by-date/2026-10-01/")

    def test_search_filters_by_field_and_paginates(self):
        self.serve([self.record("2026-10-%02d" % d, "a", field="A") for d in range(1, 29)]
                   + [self.record("2026-10-15", "b", field="B")])
        status, body = self.call("GET /photos/search", {"from": "2026-10-01", "to": "2026-10-31", "field": "A"})
        self.assertEqual((status, len(body["photos"]), body["cursor"], body["total"]), (200, 24, "24", 28))
        status, body = self.call("GET /photos/search", {
            "from": "2026-10-01", "to": "2026-10-31", "field": "A", "cursor": "24"})
        self.assertEqual((len(body["photos"]), body["cursor"]), (4, None))
        self.assertTrue(all(p["field"] == "A" for p in body["photos"]))

    def test_search_stops_after_end_date_and_validates_input(self):
        self.serve([self.record("2026-10-01", "a"), self.record("2026-11-05", "b")])
        status, body = self.call("GET /photos/search", {"from": "2026-10-01", "to": "2026-10-31"})
        self.assertEqual([p["takenOn"] for p in body["photos"]], ["2026-10-01"])
        for data in [{"from": "2026-10-31", "to": "2026-10-01"}, {"from": "x", "to": "2026-10-01"},
                     {"from": "2026-10-01", "to": "2026-10-31", "cursor": "abc"}]:
            self.assertEqual(self.call("GET /photos/search", data)[0], 400)

    def delete_request(self, user="user-1", extra_claims=None):
        record = self.record("2026-10-26", "a", user="user-1")
        fake_s3.get_object.side_effect = lambda Bucket, Key, **kwargs: (
            {"Body": io.BytesIO(json.dumps(record).encode())} if "/records/" in Key
            else (_ for _ in ()).throw(FakeClientError("NoSuchKey")))
        claims = {**self.claims, "sub": user, **(extra_claims or {})}
        return record, self.call("POST /photos/delete", {"field": "A", "id": record["id"]}, claims)

    def test_delete_by_uploader_removes_image_record_and_indexes(self):
        record, (status, body) = self.delete_request()
        self.assertEqual(status, 200)
        deleted = {c.kwargs["Key"] for c in fake_s3.delete_object.call_args_list}
        self.assertEqual(len(deleted), 4)
        self.assertTrue(any(k.endswith(f"/images/{record['id']}.jpg") for k in deleted))
        self.assertIn(f"photos/by-date/2026-10-26/{record['id']}.json", deleted)

    def test_delete_requires_owner_or_admin_family(self):
        _, (status, _) = self.delete_request(user="other")
        self.assertEqual(status, 403)
        fake_s3.delete_object.assert_not_called()
        _, (status, _) = self.delete_request(user="other", extra_claims={"cognito:groups": "[family]"})
        self.assertEqual(status, 200)

    def test_delete_rejects_bad_id_and_clears_top_pointer(self):
        self.assertEqual(self.call("POST /photos/delete", {"field": "A", "id": "../x"})[0], 400)
        fake_s3.delete_object.assert_not_called()
        record = self.record("2026-10-26", "a")
        fake_s3.get_object.side_effect = lambda Bucket, Key, **kwargs: {"Body": io.BytesIO(json.dumps(
            {"id": record["id"]} if "/tops/" in Key else record).encode())}
        self.assertEqual(self.call("POST /photos/delete", {"field": "A", "id": record["id"]})[0], 200)
        self.assertTrue(any("/tops/" in c.kwargs["Key"] for c in fake_s3.delete_object.call_args_list))


if __name__ == "__main__":
    unittest.main()
