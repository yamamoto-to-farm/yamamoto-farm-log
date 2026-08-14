from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


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

    normalized: Dict[str, Dict[str, float]] = {}
    for date_key, values in raw_data.items():
        if not isinstance(values, dict):
            continue

        tmax = float(values.get("tmax", 0.0))
        tmin = float(values.get("tmin", 0.0))
        normalized[date_key] = {
            "tmax": tmax,
            "tmin": tmin,
            "tmean": (tmax + tmin) / 2.0,
            "precip": float(values.get("precip", 0.0)),
            "sunshine": float(values.get("sunshine", 0.0)),
            "station": str(values.get("station", "")),
        }

    return normalized


def merge_weather_data(weather_dicts: list[Dict[str, Dict[str, float]]]) -> Dict[str, Dict[str, float]]:
    """Merge multiple year weather objects by date."""
    merged: Dict[str, Dict[str, float]] = {}
    for weather_data in weather_dicts:
        for date_key, values in weather_data.items():
            merged[date_key] = values
    return merged
