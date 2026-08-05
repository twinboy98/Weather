from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from math import sqrt

import numpy as np


@dataclass(frozen=True)
class ContinuousMetrics:
    mae: float
    rmse: float
    bias: float
    median_absolute_error: float
    sample_count: int


def continuous_metrics(forecast: Sequence[float], observed: Sequence[float]) -> ContinuousMetrics:
    if len(forecast) != len(observed) or not forecast:
        raise ValueError("forecast and observed must be non-empty and have equal length")
    errors = np.asarray(forecast, dtype=float) - np.asarray(observed, dtype=float)
    return ContinuousMetrics(
        mae=float(np.mean(np.abs(errors))),
        rmse=float(sqrt(float(np.mean(errors**2)))),
        bias=float(np.mean(errors)),
        median_absolute_error=float(np.median(np.abs(errors))),
        sample_count=len(errors),
    )


def skill_score(provider_loss: float, baseline_loss: float) -> float | None:
    if baseline_loss <= 0:
        return None
    return 1 - provider_loss / baseline_loss


def block_bootstrap_mean_ci(
    daily_values: Sequence[Sequence[float]],
    *,
    iterations: int = 1000,
    confidence: float = 0.95,
    seed: int = 42,
) -> tuple[float, float]:
    """Resample complete day blocks to retain within-day correlation."""

    blocks = [np.asarray(block, dtype=float) for block in daily_values if len(block)]
    if len(blocks) < 2:
        raise ValueError("at least two non-empty day blocks are required")
    rng = np.random.default_rng(seed)
    estimates = np.empty(iterations)
    for index in range(iterations):
        chosen = rng.integers(0, len(blocks), size=len(blocks))
        sample = np.concatenate([blocks[item] for item in chosen])
        estimates[index] = np.mean(sample)
    alpha = (1 - confidence) / 2
    return float(np.quantile(estimates, alpha)), float(np.quantile(estimates, 1 - alpha))


def wind_components(speed_ms: float, direction_from_degrees: float) -> tuple[float, float]:
    """Meteorological direction (wind from) to eastward u and northward v."""

    radians = np.deg2rad(direction_from_degrees)
    return float(-speed_ms * np.sin(radians)), float(-speed_ms * np.cos(radians))


def vector_error(
    forecast_speed: float,
    forecast_direction: float,
    observed_speed: float,
    observed_direction: float,
) -> float:
    forecast_u, forecast_v = wind_components(forecast_speed, forecast_direction)
    observed_u, observed_v = wind_components(observed_speed, observed_direction)
    return sqrt((forecast_u - observed_u) ** 2 + (forecast_v - observed_v) ** 2)

