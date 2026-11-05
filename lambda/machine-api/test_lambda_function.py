"""Offline tests of authenticated machine documents and private attachment lifecycle."""

import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
import uuid
from unittest.mock import MagicMock, patch


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


s3 = MagicMock()
client_factory = MagicMock(return_value=s3)
root = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with patch.dict(sys.modules, {
    "boto3": types.SimpleNamespace(client=client_factory),
    "botocore": types.ModuleType("botocore"),
    "botocore.config": types.SimpleNamespace(Config=lambda **kwargs: kwargs),
    "botocore.exceptions": types.SimpleNamespace(ClientError=ClientError),
}):
    core = load("work_plans", root / "shift-api" / "lambda_function.py")
    with patch.dict(sys.modules, {"work_plans": core}):
        api = load("machine_api", Path(__file__).with_name("lambda_function.py"))


def entry(**kwargs):
    return {"id": str(uuid.uuid4()), "kind": "setting", "title": "Hopper opening marks",
            "body": "Implement A: opening mark 3, check material and field conditions.",
            "url": "", "attachments": [], **kwargs}


class MachineApiTests(unittest.TestCase):
    def test_s3_uses_regional_virtual_host_for_browser_uploads(self):
        client_factory.assert_any_call("s3", config={
            "signature_version": "s3v4", "s3": {"addressing_style": "virtual"},
        })

    def setUp(self):
        self.env = patch.dict(os.environ, {"MACHINE_BUCKET": "private", "MACHINES_BUCKET": "public"})
        self.env.start()
        self.addCleanup(self.env.stop)
        s3.reset_mock(return_value=True, side_effect=True)
        self.objects = {}

        def put(Bucket, Key, Body, **kwargs):
            old = self.objects.get((Bucket, Key))
            if kwargs.get("IfNoneMatch") == "*" and old:
                raise ClientError("PreconditionFailed")
            if "IfMatch" in kwargs and (not old or kwargs["IfMatch"] != old["etag"]):
                raise ClientError("PreconditionFailed")
            raw = Body.encode() if isinstance(Body, str) else Body
            etag = '"' + hashlib.md5(raw).hexdigest() + '"'
            self.objects[Bucket, Key] = {
                "body": raw, "etag": etag, "ContentType": kwargs.get("ContentType"),
                "Metadata": kwargs.get("Metadata", {}),
            }
            return {"ETag": etag}

        def get(Bucket, Key):
            value = self.objects.get((Bucket, Key))
            if not value:
                raise ClientError("NoSuchKey")
            return {"Body": io.BytesIO(value["body"]), "ETag": value["etag"],
                    "ContentType": value["ContentType"], "ContentLength": len(value["body"])}

        def head(Bucket, Key):
            value = self.objects.get((Bucket, Key))
            if not value:
                raise ClientError("404")
            return {"ContentLength": len(value["body"]), "ContentType": value["ContentType"],
                    "Metadata": value["Metadata"]}

        s3.get_object.side_effect, s3.put_object.side_effect, s3.head_object.side_effect = get, put, head
        s3.generate_presigned_post.return_value = {"url": "https://private.s3.amazonaws.com",
                                                   "fields": {"key": "fixed-key"}}
        s3.generate_presigned_url.return_value = "https://private.s3.amazonaws.com/signed"
        self.put("public", "data/machines.json", {"machines": [
            {"id": "SL350", "name": "Tractor", "allowedPageIds": ["bedmaking"]},
            {"id": "BSA650", "name": "Sprayer", "allowedPageIds": ["pesticide"]},
        ]})
        self.claims = {"token_use": "access", "client_id": core.CLIENT_ID, "iss": core.ISSUER,
                       "sub": "editor-a", "scope": "openid", "cognito:groups": "[family]"}
        self.service = api.Service("SL350", "editor-a")

    def put(self, bucket, key, data):
        s3.put_object(Bucket=bucket, Key=key, Body=json.dumps(data).encode(), ContentType="application/json")

    def call(self, action=None, data=None, claims=None, machine="SL350"):
        req = {**({"machine": machine} if machine is not None else {}), **(data or {})}
        event = {"routeKey": ("POST" if action else "GET") + " /machines",
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims if claims is None else claims}}},
                 "queryStringParameters": req,
                 "body": json.dumps({**req, "action": action})}
        result = api.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def save(self, entries, revision=None):
        return self.call("save", {"entries": entries, "revision": revision})

    def uploaded(self, raw=b"%PDF-1.7\nexample", content_type="application/pdf", complete=True):
        status, issued = self.call("upload", {"type": content_type, "size": len(raw), "name": "manual.pdf"})
        self.assertEqual(status, 200, issued)
        s3.put_object(Bucket="private", Key=f"machine-library/staging/SL350/{issued['id']}",
                      Body=raw, ContentType=content_type)
        if complete:
            status, result = self.call("complete", {"id": issued["id"]})
            self.assertEqual(status, 200, result)
        return issued["id"]

    def test_authentication_rejects_missing_wrong_issuer_client_token_and_scope(self):
        for claims in ({}, {**self.claims, "token_use": "id"}, {**self.claims, "client_id": "wrong"},
                       {**self.claims, "iss": "wrong"}, {**self.claims, "scope": ""}):
            self.assertEqual(self.call(claims=claims)[0], 401)

    def test_worker_reads_but_cannot_write_or_upload(self):
        worker = {**self.claims, "cognito:groups": "[worker]"}
        status, result = self.call(claims=worker)
        self.assertEqual(status, 200)
        self.assertFalse(result["canEdit"])
        for action in ("save", "upload", "complete"):
            self.assertEqual(self.call(action, claims=worker)[0], 403)
        self.assertEqual(self.call(claims={**self.claims, "cognito:groups": "[other]"})[0], 403)

    def test_list_uses_existing_master_without_changing_it(self):
        before = copy.deepcopy(self.objects["public", "data/machines.json"])
        status, result = self.call(machine=None)
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in result["machines"]], ["SL350", "BSA650"])
        self.assertEqual(self.objects["public", "data/machines.json"], before)
        self.assertEqual(self.call(machine="../other")[0], 404)

    def test_empty_record_and_freeform_text_roundtrip_with_audit(self):
        status, initial = self.call()
        self.assertEqual(status, 200)
        self.assertIsNone(initial["revision"])
        item = entry()
        self.assertEqual(self.save([item])[0], 200)
        _, state = self.call()
        self.assertEqual(state["record"]["entries"][0]["body"], item["body"])
        self.assertEqual(state["record"]["entries"][0]["updatedBy"], "editor-a")
        previous = state["record"]["entries"][0]
        self.assertEqual(self.save([previous], state["revision"])[0], 200)
        self.assertEqual(self.call()[1]["record"]["entries"][0]["updatedAt"], previous["updatedAt"])

    def test_revision_and_conditional_write_conflicts_preserve_other_edits(self):
        first = entry()
        self.assertEqual(self.save([first])[0], 200)
        self.assertEqual(self.save([entry()])[0], 409)
        _, state = self.call()
        original_put = s3.put_object.side_effect

        def race(**kwargs):
            if kwargs["Key"].startswith("machine-library/records/"):
                raise ClientError("PreconditionFailed")
            return original_put(**kwargs)

        s3.put_object.side_effect = race
        self.assertEqual(self.save([], state["revision"])[0], 409)
        self.assertEqual(self.call()[1]["record"]["entries"][0]["id"], first["id"])

    def test_freeform_validation_and_safe_https_links(self):
        for changes in ({"title": ""}, {"body": "", "url": "", "attachments": []},
                        {"kind": "preset"}, {"id": "../../secret"}, {"body": "a" * 10001},
                        {"url": "javascript:alert(1)"}, {"url": "https://user:pass@example.com"},
                        {"url": "http://example.com"}, {"url": "https://[bad"}):
            self.assertEqual(self.save([entry(**changes)])[0], 400, changes)
        item = entry(body="", kind="manual", url="https://example.com/manual.pdf")
        self.assertEqual(self.save([item])[0], 200)

    def test_limits_and_duplicate_ids(self):
        item = entry()
        for entries in ([item, item], [entry() for _ in range(101)], [entry(attachments=["x"] * 11)]):
            self.assertEqual(self.save(entries)[0], 400)
        self.assertEqual(self.save([entry(attachments=[{}, {}])])[0], 400)

    def test_upload_policy_has_exact_key_type_size_and_expiry(self):
        status, issued = self.call("upload", {"type": "application/pdf", "size": 20 * 1024 * 1024, "name": "Manual.pdf"})
        self.assertEqual(status, 200)
        args, kwargs = s3.generate_presigned_post.call_args
        self.assertEqual(args, ("private", f"machine-library/staging/SL350/{issued['id']}"))
        self.assertIn(["content-length-range", 20 * 1024 * 1024, 20 * 1024 * 1024], kwargs["Conditions"])
        self.assertEqual(kwargs["ExpiresIn"], 900)
        for change in ({"size": 20 * 1024 * 1024 + 1}, {"size": True}, {"type": "text/html"},
                       {"type": []}, {"name": "../x.pdf"}):
            self.assertEqual(self.call("upload", {"type": "application/pdf", "size": 10, "name": "x.pdf", **change})[0], 400)

    def test_complete_rejects_size_type_and_invalid_magic(self):
        for raw, content_type in ((b"not a pdf", "application/pdf"), (b"<svg>", "image/png"),
                                  (b"not jpeg", "image/jpeg")):
            asset = self.uploaded(raw, content_type, complete=False)
            self.assertEqual(self.call("complete", {"id": asset})[0], 400)
        asset = self.uploaded(complete=False)
        s3.put_object(Bucket="private", Key=f"machine-library/staging/SL350/{asset}",
                      Body=b"%PDF-1.7\nchanged size", ContentType="application/pdf")
        self.assertEqual(self.call("complete", {"id": asset})[0], 400)

    def test_valid_jpeg_and_png_can_be_saved(self):
        for raw, content_type in ((b"\xff\xd8\xfftest", "image/jpeg"), (b"\x89PNG\r\n\x1a\ntest", "image/png")):
            asset = self.uploaded(raw, content_type)
            self.assertEqual(self.call("complete", {"id": asset})[0], 200)

    def test_ticket_owner_and_expiry_are_enforced(self):
        asset = self.uploaded(complete=False)
        other = {**self.claims, "sub": "editor-b"}
        self.assertEqual(self.call("complete", {"id": asset}, claims=other)[0], 403)
        with patch.object(api.time, "time", return_value=10**11):
            self.assertEqual(self.call("complete", {"id": asset})[0], 409)
        self.assertEqual(self.call("complete", {"id": str(uuid.uuid4())})[0], 404)

    def test_unfinished_and_other_editors_attachments_cannot_be_saved(self):
        asset = self.uploaded(complete=False)
        item = entry(attachments=[asset])
        self.assertEqual(self.save([item])[0], 409)
        self.assertEqual(self.call("complete", {"id": asset})[0], 200)
        self.assertEqual(self.call("save", {"entries": [item], "revision": None},
                                   claims={**self.claims, "sub": "editor-b"})[0], 403)
        self.assertEqual(self.save([item])[0], 200)
        state = self.call()[1]
        self.assertEqual(self.call("save", {"entries": state["record"]["entries"], "revision": state["revision"]},
                                   claims={**self.claims, "sub": "editor-b"})[0], 200)

    def test_finalized_files_do_not_change_if_staging_is_replayed(self):
        raw = b"%PDF-1.7\nexample"
        asset = self.uploaded(raw)
        final_key = self.service.file_key(asset, "application/pdf")
        original = self.objects["private", final_key]["body"]
        s3.put_object(Bucket="private", Key=f"machine-library/staging/SL350/{asset}",
                      Body=b"%PDF-1.7\nchanged", ContentType="application/pdf")
        self.assertEqual(self.call("complete", {"id": asset})[0], 409)
        self.assertEqual(self.objects["private", final_key]["body"], original)

    def test_download_is_authenticated_scoped_and_only_for_saved_references(self):
        asset = self.uploaded()
        self.assertEqual(self.call("file", {"id": asset})[0], 404)
        self.assertEqual(self.save([entry(attachments=[asset])])[0], 200)
        worker = {**self.claims, "cognito:groups": "[worker]"}
        status, result = self.call("file", {"id": asset}, claims=worker)
        self.assertEqual(status, 200)
        self.assertEqual(result["expiresIn"], 300)
        _, kwargs = s3.generate_presigned_url.call_args
        self.assertEqual(kwargs["Params"]["ResponseContentType"], "application/pdf")
        self.assertEqual(kwargs["Params"]["ResponseCacheControl"], "private, no-store")
        self.assertEqual(self.call("file", {"id": asset}, machine="BSA650")[0], 404)
        state = self.call()[1]
        self.assertEqual(self.save([], state["revision"])[0], 200)
        self.assertEqual(self.call("file", {"id": asset})[0], 404)
        self.assertIn(("private", self.service.file_key(asset, "application/pdf")), self.objects)

    def test_invalid_master_is_not_treated_as_an_empty_list(self):
        for master in ({}, {"machines": [{"id": "../bad", "name": "bad"}]},
                       {"machines": [{"id": "x", "name": "X"}, {"id": "x", "name": "Y"}]}):
            self.put("public", "data/machines.json", master)
            self.assertEqual(self.call(machine=None)[0], 500)

    def test_base64_body_and_malformed_json(self):
        event = {"routeKey": "POST /machines", "isBase64Encoded": True,
                 "requestContext": {"authorizer": {"jwt": {"claims": self.claims}}},
                 "body": base64.b64encode(json.dumps({"machine": "SL350", "action": "save",
                                                     "entries": [entry()], "revision": None}).encode()).decode()}
        self.assertEqual(api.lambda_handler(event, None)["statusCode"], 200)
        for raw in ("%%%", base64.b64encode(b"[]").decode(), base64.b64encode(b"{").decode()):
            event["body"] = raw
            self.assertEqual(api.lambda_handler(event, None)["statusCode"], 400)

    def test_aws_error_is_visible_and_logs_no_document_body(self):
        with patch.object(api.LOGGER, "error") as log:
            s3.get_object.side_effect = ClientError("AccessDenied")
            self.assertEqual(self.call()[0], 500)
            log.assert_called_once_with("Machine library AWS failure: %s", "AccessDenied")


if __name__ == "__main__":
    unittest.main()
