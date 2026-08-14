from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict

import boto3

from gdd_calculator import compute_gdd_from_planting_to_harvest
from model import VarietyConfig, fit_single_feature_model
from weather_loader import load_weather_json, merge_weather_data, normalize_weather_data


S3_BUCKET = os.environ.get("S3_BUCKET_NAME", "yamamoto-farm-log")
VARIETY_DETAIL_KEY = "data/variety-detail.json"


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


def _today_japan() -> str:
    japan_timezone = timezone(timedelta(hours=9))
    return datetime.now(japan_timezone).date().isoformat()


def _estimate_days_to_target(
    weather_data: Dict[str, Dict[str, float]],
    planting_date: str,
    as_of_date: str,
    current_gdd: float,
    target_gdd: float,
) -> Dict[str, object]:
    start = datetime.strptime(planting_date, "%Y-%m-%d").date()
    end = datetime.strptime(as_of_date, "%Y-%m-%d").date()
    observed_effective_values = []
    cursor = start
    while cursor <= end:
        day_data = weather_data.get(cursor.isoformat())
        if day_data is not None:
            tmean = (day_data["tmax"] + day_data["tmin"]) / 2.0
            clipped = min(max(tmean, 0.0), 30.0)
            observed_effective_values.append(max(clipped - 5.0, 0.0))
        cursor += timedelta(days=1)

    remaining_gdd = max(target_gdd - current_gdd, 0.0)
    average_daily_gdd = (
        sum(observed_effective_values) / len(observed_effective_values)
        if observed_effective_values
        else 0.0
    )
    if remaining_gdd == 0:
        estimated_days = 0
    elif average_daily_gdd > 0:
        estimated_days = int((remaining_gdd / average_daily_gdd) + 0.999999)
    else:
        estimated_days = None

    estimated_date = None
    if estimated_days is not None:
        estimated_date = (end + timedelta(days=estimated_days)).isoformat()

    return {
        "remaining_gdd": round(remaining_gdd, 2),
        "average_daily_effective_gdd": round(average_daily_gdd, 2),
        "estimated_days_to_target": estimated_days,
        "estimated_target_date": estimated_date,
    }


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
            weather_parts.append(normalize_weather_data(json.loads(content)))
        except Exception:
            continue

    if not weather_parts:
        return {}
    return merge_weather_data(weather_parts)


def _load_variety_settings_from_s3(bucket_name: str) -> Dict[str, Dict[str, object]]:
    s3 = boto3.client("s3", region_name="ap-northeast-1")
    response = s3.get_object(Bucket=bucket_name, Key=VARIETY_DETAIL_KEY)
    content = response["Body"].read().decode("utf-8")
    settings = json.loads(content)
    if not isinstance(settings, dict):
        raise ValueError(f"Invalid variety detail format: s3://{bucket_name}/{VARIETY_DETAIL_KEY}")
    return settings


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda entry point for GDD prediction using S3 weather JSON files.

        Expected forecast payload example:
    {
            "planting_date": "2026-01-10",
            "as_of_date": "2026-02-15",
            "variety": "新藍",
            "target_weight_kg": 2.3,
            "weather_bucket": "yamamoto-farm-log"
    }

        ``harvest_date`` remains optional for retrospective validation.
    """
    try:
        payload = _read_event_payload(event or {})

        planting_date = payload.get("planting_date")
        harvest_date = payload.get("harvest_date")
        as_of_date = payload.get("as_of_date") or harvest_date or _today_japan()
        if not planting_date:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "planting_date is required"}),
            }

        try:
            planting = datetime.strptime(str(planting_date), "%Y-%m-%d").date()
            as_of = datetime.strptime(str(as_of_date), "%Y-%m-%d").date()
        except ValueError:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "planting_date and as_of_date must use YYYY-MM-DD"}),
            }

        if planting > as_of:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "as_of_date must be on or after planting_date"}),
            }

        weather_bucket = payload.get("weather_bucket") or S3_BUCKET
        variety_bucket = payload.get("variety_bucket") or weather_bucket
        weather_path = _safe_weather_path(payload.get("weather_path"))
        weather_data: Dict[str, Dict[str, float]] = {}

        if weather_path and Path(weather_path).exists():
            weather_data = load_weather_json(weather_path)
        else:
            weather_data = _load_weather_data_from_s3(weather_bucket, planting_date, as_of_date)

        variety_name = payload.get("variety", "新藍")
        variety_settings = _load_variety_settings_from_s3(variety_bucket)
        variety_config = VarietyConfig(variety_settings)
        variety = variety_config.get(variety_name)
        selected_gdd_mode = variety.gdd_mode if variety.gdd_mode in {"simple", "effective"} else "effective"

        simple_gdd = compute_gdd_from_planting_to_harvest(
            weather_data,
            planting_date,
            as_of_date,
            mode="simple",
        )
        effective_gdd = compute_gdd_from_planting_to_harvest(
            weather_data,
            planting_date,
            as_of_date,
            mode="effective",
        )
        selected_gdd = effective_gdd if selected_gdd_mode == "effective" else simple_gdd

        model_params = fit_single_feature_model([
            {"gdd": selected_gdd, "average_ball_weight_kg": 2.0},
            {"gdd": selected_gdd * 0.9, "average_ball_weight_kg": 1.8},
        ])

        target_weight = float(payload.get("target_weight_kg", 2.3))
        predicted_gdd = (target_weight - model_params["intercept"]) / model_params["coef_gdd"] if model_params["coef_gdd"] else 0.0

        configured_target_gdd = None
        if variety.target_gdd is not None:
            try:
                configured_target_gdd = float(variety.target_gdd)
            except (TypeError, ValueError):
                configured_target_gdd = None

        target_gdd = (
            configured_target_gdd
            if configured_target_gdd is not None
            else predicted_gdd
        )
        target_gdd_source = "variety_config" if configured_target_gdd is not None else "weight_model"
        forecast = None
        if configured_target_gdd is not None and harvest_date is None:
            forecast = _estimate_days_to_target(
                weather_data,
                planting_date,
                as_of_date,
                selected_gdd,
                configured_target_gdd,
            )

        response = {
            "statusCode": 200,
            "body": json.dumps({
                "variety": payload.get("variety", "新藍"),
                "planting_date": planting_date,
                "harvest_date": harvest_date,
                "as_of_date": as_of_date,
                "weather_bucket": weather_bucket,
                "variety_bucket": variety_bucket,
                "simple_gdd": round(simple_gdd, 2),
                "effective_gdd": round(effective_gdd, 2),
                "selected_gdd": round(selected_gdd, 2),
                "selected_gdd_mode": selected_gdd_mode,
                "target_weight_kg": target_weight,
                "estimated_gdd_for_target": round(target_gdd, 2),
                "target_gdd_source": target_gdd_source,
                "forecast": forecast,
                "variety_config": {
                    "expected_crop_type": variety.expected_crop_type,
                    "gdd_mode": variety.gdd_mode,
                    "target_gdd": variety.target_gdd,
                    "dap_range": variety.dap_range,
                    "low_sun_correction": variety.low_sun_correction,
                    "low_temp_correction": variety.low_temp_correction,
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
