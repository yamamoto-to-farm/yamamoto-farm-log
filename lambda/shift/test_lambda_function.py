# -*- coding: utf-8 -*-
"""shift Lambda のテスト（AWS・ネットワークに接続しないインメモリモック）.

実行: python -B -m unittest discover -s lambda\\shift -p "test_*.py"
"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import lambda_function

JST = timezone(timedelta(hours=9))

CONFIG = {
    "base_hourly": 1250,
    "hours_per_day_target": 6.5,
    "target_person_days": {"min": 4, "center": 5, "max": 6},
    "labor_budget_yen": {"min": 30000, "max": 50000},
    "commute": {"per_day": 160, "monthly_cap": 3000},
    "min_work_hours": 3.5,
    "max_work_hours": 6.5,
    "peak_max_work_hours": 9,
    "flex_all_day_assumed_hours": 6.5,
    "am_default": {"start": "06:00", "end": "12:00"},
    "pm_default": {"start": "13:00", "end": "17:10"},
    "allday_default": {"start": "06:00", "end": "17:10"},
    "break_minutes": {"not_spanning_noon": 10, "spanning_noon": 60},
    "weekly_max_days": 5,
    "consecutive_max_days": 5,
    "timetree_calendar_code": "TESTCODE",
    "staff": [
        {"name": "土井", "match": ["土井"], "fixed_weekdays": ["水"],
         "target_days": 4, "hourly": 1310},
    ],
}

# 2026-11 の水曜（4,11,18,25）＋追加希望 11/7（土）
ICS = "\r\n".join(
    ["BEGIN:VCALENDAR", "VERSION:2.0"]
    + sum([["BEGIN:VEVENT",
            "SUMMARY:希 終日",
            f"DTSTART;VALUE=DATE:202611{d:02d}",
            f"DTEND;VALUE=DATE:202611{d + 1:02d}",
            "END:VEVENT"] for d in (4, 7, 11, 18, 25)], [])
    + ["END:VCALENDAR", ""])

ICS_NAME = "timetree_土井さん勤務希望.ics"


class FakeS3:
    def __init__(self, objects):
        self.objects = dict(objects)
        self.put = {}

    def download_file(self, bucket, key, dest):
        Path(dest).write_bytes(self.objects[key])

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.put[Key] = Body

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        return {"Contents": [{"Key": k} for k in sorted(self.objects) if k.startswith(Prefix)]}


class FakeSNS:
    def __init__(self):
        self.published = []

    def publish(self, TopicArn, Subject, Message):
        self.published.append((Subject, Message))


class FakeSecrets:
    def get_secret_value(self, SecretId):
        return {"SecretString": json.dumps({"email": "farm@example.com", "password": "pw"})}


class LambdaTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.s3 = FakeS3({"shift/config.json": json.dumps(CONFIG, ensure_ascii=False).encode("utf-8")})
        self.sns = FakeSNS()
        self.secrets = FakeSecrets()
        env = {"SHIFT_BUCKET": "test-bucket",
               "SHIFT_WORK_DIR": str(Path(self._tmp.name) / "work"),
               "SNS_TOPIC_ARN": "arn:aws:sns:ap-northeast-1:0:topic",
               "TIMETREE_SECRET_ARN": "arn:aws:secretsmanager:ap-northeast-1:0:secret:x"}
        self._patches = [
            patch.dict(os.environ, env),
            patch.object(lambda_function, "_client",
                         lambda name: {"s3": self.s3, "sns": self.sns,
                                       "secretsmanager": self.secrets}[name]),
        ]
        for p in self._patches:
            p.start()
        self.addCleanup(self._tmp.cleanup)
        for p in self._patches:
            self.addCleanup(p.stop)

    def _fake_fetch(self, ics_dir, calendar_code):
        self.assertEqual(calendar_code, "TESTCODE")
        self.assertEqual(os.environ.get("TIMETREE_EMAIL"), "farm@example.com")
        ics_dir.mkdir(parents=True, exist_ok=True)
        (ics_dir / ICS_NAME).write_text(ICS, encoding="utf-8")

    def test_target_month(self):
        self.assertEqual(lambda_function.target_month(datetime(2026, 10, 26, tzinfo=JST)), "2026-11")
        self.assertEqual(lambda_function.target_month(datetime(2026, 12, 26, tzinfo=JST)), "2027-01")

    def test_run_uploads_plan_and_notifies(self):
        with patch.object(lambda_function, "fetch_ics", self._fake_fetch):
            result = lambda_function.lambda_handler({"month": "2026-11"}, None)
        expected_keys = {"shift/2026-11/entries.csv", "shift/2026-11/plan.txt",
                         "shift/2026-11/proposal.csv", "shift/2026-11/plan.json",
                         "shift/latest.json"}
        self.assertEqual(set(self.s3.put), expected_keys)
        plan = json.loads(self.s3.put["shift/latest.json"].decode("utf-8"))
        self.assertEqual(plan["month"], "2026-11")
        self.assertTrue(plan["scenarios"])
        self.assertEqual(plan["default_budget_max"], 50000)
        self.assertEqual(result["month"], "2026-11")
        self.assertEqual(result["entries"], 5)
        self.assertGreater(result["cost"], 0)
        self.assertEqual(len(self.sns.published), 1)
        self.assertIn("作成しました", self.sns.published[0][0])

    def test_skip_fetch_reads_ics_from_s3(self):
        self.s3.objects["shift/ics/" + ICS_NAME] = ICS.encode("utf-8")

        def boom(*a, **k):
            raise AssertionError("skip_fetch 時に fetch してはいけない")

        with patch.object(lambda_function, "fetch_ics", boom):
            result = lambda_function.lambda_handler({"month": "2026-11", "skip_fetch": True}, None)
        self.assertEqual(result["entries"], 5)
        self.assertIn("shift/2026-11/plan.json", self.s3.put)

    def test_failure_notifies_and_raises(self):
        def boom(*a, **k):
            raise RuntimeError("timetree login failed")

        with patch.object(lambda_function, "fetch_ics", boom):
            with self.assertRaises(RuntimeError):
                lambda_function.lambda_handler({"month": "2026-11"}, None)
        self.assertEqual(len(self.sns.published), 1)
        self.assertIn("失敗", self.sns.published[0][0])
        self.assertIn("timetree login failed", self.sns.published[0][1])


if __name__ == "__main__":
    unittest.main()
