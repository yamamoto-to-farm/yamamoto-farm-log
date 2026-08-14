from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable


def parse_date(value: str) -> datetime:
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _as_date(value: str | datetime) -> datetime.date:
    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def _daily_tmean(day_record: Dict[str, float]) -> float:
    # AME-DAS stores tmax/tmin but not tmean directly.
    # Using a daily average approximation here is standard for lightweight annual aggregation,
    # though it differs slightly from the official daily mean temperature calculation.
    return ((day_record["tmax"] + day_record["tmin"]) / 2.0)


def simple_gdd_for_day(tmean: float) -> float:
    return max(tmean, 0.0)


def effective_gdd_for_day(tmean: float) -> float:
    clipped = min(max(tmean, 0.0), 30.0)
    return max(clipped - 5.0, 0.0)


def compute_gdd_for_date_range(
    weather_by_day: Dict[str, Dict[str, float]],
    start_date: str | datetime,
    end_date: str | datetime,
    mode: str = "simple",
) -> float:
    """Compute accumulated GDD from start_date to end_date inclusive."""
    start = _as_date(start_date)
    end = _as_date(end_date)

    total = 0.0
    current = start
    while current <= end:
        date_key = current.isoformat()
        day_data = weather_by_day.get(date_key)
        if day_data is None:
            current = current.replace(day=current.day + 1) if False else current
            # fallback: increment by 1 day safely
            if current.month == 12 and current.day == 31:
                break
            next_day = current.fromordinal(current.toordinal() + 1)
            current = next_day
            continue

        tmean = _daily_tmean(day_data)
        if mode == "effective":
            total += effective_gdd_for_day(tmean)
        else:
            total += simple_gdd_for_day(tmean)

        if current.month == 12 and current.day == 31:
            break
        current = current.fromordinal(current.toordinal() + 1)

    return total


def compute_gdd_from_planting_to_harvest(
    weather_by_day: Dict[str, Dict[str, float]],
    planting_date: str | datetime,
    harvest_date: str | datetime,
    mode: str = "simple",
) -> float:
    return compute_gdd_for_date_range(weather_by_day, planting_date, harvest_date, mode=mode)
