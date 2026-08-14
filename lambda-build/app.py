from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

import boto3

from gdd_calculator import compute_gdd_from_planting_to_harvest
from model import VarietyConfig, fit_single_feature_model
from weather_loader import load_weather_json, merge_weather_data


S3_BUCKET = os.environ.get("S3_BUCKET_NAME", "yamamoto-farm-log")


def _read_event_payload(event: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(event.get("body"), str):
        try:
            return json.loads(event["body"])
        except json.JSONDecodeError:
            return event
    return event


def _safe_weather_path(weather_path: str | None) -> str | None:
    if weather_path:
        return weather_path
    env_path = os.environ.get("WEATHER_JSON_PATH")
    return env_path if env_path else None


def _load_weather_data_from_s3(bucket_name: str, start_date: str, end_date: str) -> Dict[str, Dict[str, float]]:
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    years = sorted({str(year) for year in range(start.year, end.year + 1)})

    s3 = boto3.client("s3", region_name="ap-northeast-1")
    weather_parts = []
    for year in years:
        key = f"data/weather/{year}.json"
        try:
            response = s3.get_object(Bucket=bucket_name, Key=key)
            content = response["Body"].read().decode("utf-8")
            weather_parts.append(json.loads(content))
        except Exception:
            continue

    if not weather_parts:
        return {}
    return merge_weather_data(weather_parts)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda entry point for GDD prediction using S3 weather JSON files.

    Expected payload example:
    {
      "planting_date": "2026-01-10",
      "harvest_date": "2026-03-20",
      "variety": "新藍",
      "target_weight_kg": 2.3,
      "weather_bucket": "yamamoto-farm-log"
    }
    """
    try:
        payload = _read_event_payload(event or {})

        planting_date = payload.get("planting_date")
        harvest_date = payload.get("harvest_date")
        if not planting_date or not harvest_date:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "planting_date and harvest_date are required"}),
            }

        weather_bucket = payload.get("weather_bucket") or S3_BUCKET
        weather_path = _safe_weather_path(payload.get("weather_path"))
        weather_data: Dict[str, Dict[str, float]] = {}

        if weather_path and Path(weather_path).exists():
            weather_data = load_weather_json(weather_path)
        else:
            weather_data = _load_weather_data_from_s3(weather_bucket, planting_date, harvest_date)

        simple_gdd = compute_gdd_from_planting_to_harvest(
            weather_data,
            planting_date,
            harvest_date,
            mode="simple",
        )
        effective_gdd = compute_gdd_from_planting_to_harvest(
            weather_data,
            planting_date,
            harvest_date,
            mode="effective",
        )

        model_params = fit_single_feature_model([
            {"gdd": simple_gdd, "average_ball_weight_kg": 2.0},
            {"gdd": simple_gdd * 0.9, "average_ball_weight_kg": 1.8},
        ])

        target_weight = float(payload.get("target_weight_kg", 2.3))
        predicted_gdd = (target_weight - model_params["intercept"]) / model_params["coef_gdd"] if model_params["coef_gdd"] else 0.0

        variety_config = VarietyConfig({
            "新藍": {
                "想定作型": "秋冬どり低温期",
                "積算方式": "simple",
                "目標GDD": None,
                "目安DAP": (60, 90),
                "季節補正係数": {"低日射補正": None, "低温補正": None},
            }
        })
        variety = variety_config.get(payload.get("variety", "新藍"))

        response = {
            "statusCode": 200,
            "body": json.dumps({
                "variety": payload.get("variety", "新藍"),
                "planting_date": planting_date,
                "harvest_date": harvest_date,
                "weather_bucket": weather_bucket,
                "simple_gdd": round(simple_gdd, 2),
                "effective_gdd": round(effective_gdd, 2),
                "target_weight_kg": target_weight,
                "estimated_gdd_for_target": round(predicted_gdd, 2),
                "variety_config": {
                    "expected_crop_type": variety.expected_crop_type,
                    "gdd_mode": variety.gdd_mode,
                    "dap_range": variety.dap_range,
                },
            }, ensure_ascii=False),
        }
        return response

    except Exception as exc:  # pragma: no cover - Lambda friendly error handling
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc)}),
        }


if __name__ == "__main__":
    sample = {
        "planting_date": "2026-01-10",
        "harvest_date": "2026-03-20",
        "variety": "新藍",
        "target_weight_kg": 2.3,
        "weather_bucket": "yamamoto-farm-log",
    }
    print(lambda_handler(sample, None))
