from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def normalize_weather_data(raw_data: Any) -> Dict[str, Dict[str, float]]:
    normalized: Dict[str, Dict[str, float]] = {}
    if not isinstance(raw_data, dict):
        return normalized

    for date_key, values in raw_data.items():
        if not isinstance(values, dict):
            continue

        try:
            tmax = float(values.get("tmax"))
            tmin = float(values.get("tmin"))
        except (TypeError, ValueError):
            continue

        def optional_float(value: Any) -> float:
            try:
                return float(value)
            except (TypeError, ValueError):
                return 0.0

        normalized[str(date_key)] = {
            "tmax": tmax,
            "tmin": tmin,
            "tmean": (tmax + tmin) / 2.0,
            "precip": optional_float(values.get("precip")),
            "sunshine": optional_float(values.get("sunshine")),
            "station": str(values.get("station") or ""),
        }

    return normalized


def load_weather_json(path: str | Path) -> Dict[str, Dict[str, float]]:
    """Load AME-DAS weather JSON stored by date key.

    Example structure:
    {
      "2026-01-01": {"tmax": 9.2, "tmin": 4.2, "precip": 0.0, "sunshine": 9.1, "station": "Toyohashi"}
    }
    """
    weather_path = Path(path)
    if not weather_path.exists():
        raise FileNotFoundError(f"Weather file not found: {weather_path}")

    with weather_path.open("r", encoding="utf-8") as fp:
        raw_data = json.load(fp)

    return normalize_weather_data(raw_data)


def merge_weather_data(weather_dicts: list[Dict[str, Dict[str, float]]]) -> Dict[str, Dict[str, float]]:
    """Merge multiple year weather objects by date."""
    merged: Dict[str, Dict[str, float]] = {}
    for weather_data in weather_dicts:
        for date_key, values in weather_data.items():
            merged[date_key] = values
    return merged
