from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class VarietySetting:
    name: str
    expected_crop_type: str | None = None
    gdd_mode: str = "simple"
    target_gdd: float | None = None
    dap_range: tuple[int, int] | None = None
    low_sun_correction: float | None = None
    low_temp_correction: float | None = None


class VarietyConfig:
    """Minimal config manager for variety settings.

    The production version can read a JSON/YAML file from S3 or local config directory.
    """

    def __init__(self, settings: Dict[str, Dict[str, object]] | None = None):
        self.settings = settings or {}

    def get(self, variety_name: str) -> VarietySetting:
        raw = self.settings.get(variety_name, {})
        return VarietySetting(
            name=variety_name,
            expected_crop_type=raw.get("想定作型"),
            gdd_mode=raw.get("積算方式", "simple"),
            target_gdd=raw.get("目標GDD"),
            dap_range=raw.get("目安DAP"),
            low_sun_correction=raw.get("季節補正係数", {}).get("低日射補正"),
            low_temp_correction=raw.get("季節補正係数", {}).get("低温補正"),
        )


def fit_single_feature_model(records: List[Dict[str, float]]) -> Dict[str, float]:
    """Placeholder for future linear regression model fitting.

    This module is intentionally lightweight as a starter skeleton. Production code can
    switch to scikit-learn once the dataset grows.
    """
    if not records:
        return {"intercept": 0.0, "coef_gdd": 0.0}

    gdd_values = [float(r["gdd"]) for r in records]
    weight_values = [float(r["average_ball_weight_kg"]) for r in records]

    if len(set(gdd_values)) == 1:
        return {"intercept": 0.0, "coef_gdd": 0.0}

    mean_gdd = sum(gdd_values) / len(gdd_values)
    mean_weight = sum(weight_values) / len(weight_values)
    numerator = sum((g - mean_gdd) * (w - mean_weight) for g, w in zip(gdd_values, weight_values))
    denominator = sum((g - mean_gdd) ** 2 for g in gdd_values)
    slope = 0.0 if denominator == 0 else numerator / denominator
    intercept = mean_weight - slope * mean_gdd
    return {"intercept": intercept, "coef_gdd": slope}


def predict_weight_from_gdd(gdd_value: float, model_params: Dict[str, float]) -> float:
    return model_params.get("intercept", 0.0) + model_params.get("coef_gdd", 0.0) * gdd_value
