#!/usr/bin/env python3
"""山本農園 シフト案生成 Lambda（毎月26日に EventBridge Scheduler から起動）.

流れ:
  1. Secrets Manager から timetree の認証情報を取得（TIMETREE_SECRET_ARN）
  2. 非公開バケットから <prefix>config.json（スタッフマスタ）を取得
  3. timetree-exporter で .ics を /tmp に取得
  4. shift_tool の parse + plan を実行（対象は翌月。event で上書き可）
  5. entries.csv / plan.txt / proposal.csv / plan.json を S3 に保存し、
     <prefix>latest.json を最新の plan.json で更新
  失敗時は SNS に通知してから例外を再送出する（成功時も概要を通知）。

環境変数:
  SHIFT_BUCKET        … 非公開バケット名（必須）
  SHIFT_PREFIX        … キーの接頭辞（既定 "shift/"）
  TIMETREE_SECRET_ARN … Secrets Manager のシークレット（JSON: {"email","password"}。任意）
  SNS_TOPIC_ARN       … 通知先トピック（任意）
  SHIFT_WORK_DIR      … 作業ディレクトリ（既定 /tmp/shift。テスト用）

イベント（すべて任意）:
  {"month": "2026-11", "peak": true, "skip_fetch": true}
  skip_fetch は、S3 の <prefix>ics/ に置いた .ics で再計算したいときに使う。
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import shift_tool

JST = timezone(timedelta(hours=9))


def _client(name):
    import boto3
    return boto3.client(name)


def target_month(now=None):
    """実行時点（JST）の翌月 YYYY-MM"""
    now = now or datetime.now(JST)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return f"{y:04d}-{m:02d}"


def _load_credentials():
    arn = os.environ.get("TIMETREE_SECRET_ARN")
    if not arn:
        return
    sec = json.loads(_client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"])
    os.environ["TIMETREE_EMAIL"] = sec["email"]
    os.environ["TIMETREE_PASSWORD"] = sec["password"]


def fetch_ics(ics_dir, calendar_code):
    """timetree-exporter をサブプロセスで実行してラベル別の .ics を取得する"""
    ics_dir.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "timetree_exporter",
           "-o", str(ics_dir / "timetree.ics"), "--split-by-label"]
    if calendar_code:
        cmd += ["-c", calendar_code]
    env = dict(os.environ)
    task_root = env.get("LAMBDA_TASK_ROOT")
    if task_root:  # サブプロセスの python から同梱パッケージを見えるようにする
        env["PYTHONPATH"] = task_root + os.pathsep + env.get("PYTHONPATH", "")
    subprocess.run(cmd, check=True, env=env, timeout=300)


def _download_prefix(s3, bucket, key_prefix, dest_dir):
    """S3 の key_prefix 配下の .ics を dest_dir へダウンロードする（skip_fetch 用）"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    token, n = None, 0
    while True:
        kw = {"Bucket": bucket, "Prefix": key_prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = s3.list_objects_v2(**kw)
        for obj in resp.get("Contents", []):
            name = obj["Key"].rsplit("/", 1)[-1]
            if name.endswith(".ics"):
                s3.download_file(bucket, obj["Key"], str(dest_dir / name))
                n += 1
        token = resp.get("NextContinuationToken")
        if not token:
            break
    return n


def _notify(subject, message):
    arn = os.environ.get("SNS_TOPIC_ARN")
    if not arn:
        return
    try:
        _client("sns").publish(TopicArn=arn, Subject=subject[:99], Message=message)
    except Exception:  # 通知の失敗で本処理を壊さない
        traceback.print_exc()


def run(event):
    bucket = os.environ["SHIFT_BUCKET"]
    prefix = os.environ.get("SHIFT_PREFIX", "shift/")
    month = event.get("month") or target_month()
    s3 = _client("s3")

    work = Path(os.environ.get("SHIFT_WORK_DIR", "/tmp/shift"))
    if work.exists():
        shutil.rmtree(work)
    ics_dir = work / "ics"
    work.mkdir(parents=True)

    cfg_path = work / "config.json"
    s3.download_file(bucket, prefix + "config.json", str(cfg_path))
    cfg = shift_tool.load_config(cfg_path)

    if event.get("skip_fetch"):
        n = _download_prefix(s3, bucket, prefix + "ics/", ics_dir)
        print(f"skip_fetch: s3://{bucket}/{prefix}ics/ から {n} 件の .ics を取得")
    else:
        _load_credentials()
        fetch_ics(ics_dir, cfg.get("timetree_calendar_code"))

    entries_csv = work / f"entries_{month}.csv"
    ns = argparse.Namespace(config=str(cfg_path), ics=str(ics_dir), month=month,
                            output=str(entries_csv), entries=str(entries_csv),
                            peak=bool(event.get("peak")), mode="split",
                            target_person_days=None)
    shift_tool.cmd_parse(ns)
    shift_tool.cmd_plan(ns)

    outputs = {
        f"{prefix}{month}/entries.csv": entries_csv,
        f"{prefix}{month}/plan.txt": work / f"plan_{month}.txt",
        f"{prefix}{month}/proposal.csv": work / f"proposal_{month}.csv",
        f"{prefix}{month}/plan.json": work / f"plan_{month}.json",
        f"{prefix}latest.json": work / f"plan_{month}.json",
    }
    for key, path in outputs.items():
        ctype = ("application/json" if key.endswith(".json")
                 else "text/csv" if key.endswith(".csv") else "text/plain")
        s3.put_object(Bucket=bucket, Key=key, Body=path.read_bytes(),
                      ContentType=f"{ctype}; charset=utf-8")

    plan = json.loads((work / f"plan_{month}.json").read_text(encoding="utf-8"))
    scen = next((s_ for s_ in plan["scenarios"] if s_["budget_max"] == plan["default_budget_max"]),
                plan["scenarios"][-1])
    return {"month": month, "entries": plan["requests"]["entries"],
            "cost": scen["cost"], "budget_max": plan["default_budget_max"],
            "issues": len(plan["issues"]), "keys": sorted(outputs)}


def lambda_handler(event, context):
    event = event or {}
    try:
        result = run(event)
    except (Exception, SystemExit) as exc:
        _notify("【山本農園】シフト案の自動作成に失敗しました",
                "シフト案の作成中にエラーが発生しました。手動実行（README参照）で復旧してください。\n\n"
                f"{exc!r}\n\n{traceback.format_exc()}")
        raise
    _notify("【山本農園】シフト案を作成しました",
            f"{result['month']} のシフト案を作成しました。\n"
            f"勤務希望: {result['entries']}件 / 案の人件費: {result['cost']:,}円"
            f"（予算上限 {result['budget_max']:,}円）/ 要確認: {result['issues']}件\n"
            "農園OSの管理ページで内容を確認してください。")
    return result
