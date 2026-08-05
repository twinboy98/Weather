from __future__ import annotations

from datetime import UTC, datetime, timedelta
from math import sin
from typing import Any, cast
from uuid import UUID

from app.domain.models import Location


def current_weather(location: Location) -> dict[str, object]:
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    city_offset = (location.latitude - 35.0) * -0.35
    return {
        "location_id": str(location.id),
        "observed_at_utc": now.isoformat(),
        "temperature_c": round(25.4 + city_offset, 1),
        "apparent_temperature_c": round(27.1 + city_offset, 1),
        "relative_humidity_pct": 72,
        "wind_speed_ms": 2.8,
        "weather_code": "partly_cloudy",
        "source": "demo_fixture",
        "station": {
            "source": "KMA ASOS fixture",
            "station_id": "108-DEMO",
            "station_name": f"{location.name} 대표 관측소 (샘플)",
            "distance_km": 3.2,
            "elevation_difference_m": 12,
            "quality_flags": ["demo_fixture"],
        },
        "is_demo": True,
    }


def hourly_comparison(location: Location, hours: int = 72) -> dict[str, object]:
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    providers = [
        ("kma_forecast", "village_short", 0.0, "KMA fixture"),
        ("met_norway", "compact", 0.35, "MET Norway fixture"),
        ("windy", "gfs", -0.25, "Windy-GFS fixture"),
        ("windy", "icon", 0.6, "Windy-ICON fixture"),
    ]
    series = []
    for provider_id, variant, offset, label in providers:
        points = []
        for step in range(hours):
            valid_at = now + timedelta(hours=step)
            daily_cycle = sin((valid_at.hour - 8) / 24 * 6.28318) * 3.8
            rain = max(0.0, 2.8 - abs(step - 3) * 0.8) if step < 7 else 0.0
            points.append(
                {
                    "valid_at_utc": valid_at.isoformat(),
                    "air_temperature_c": round(24.5 + daily_cycle + offset, 1),
                    "precipitation_amount_mm": round(rain * (1 + offset * 0.08), 2),
                    "precipitation_interval_seconds": 3600,
                    "wind_speed_ms": round(2.0 + (step % 5) * 0.35 + abs(offset), 1),
                }
            )
        series.append(
            {
                "provider_id": provider_id,
                "provider_variant": variant,
                "label": label,
                "issued_at_utc": (now - timedelta(hours=1)).isoformat(),
                "fetched_at_utc": now.isoformat(),
                "issue_time_quality": "provided" if provider_id != "windy" else "fetched_time_only",
                "quality_flags": ["demo_fixture"],
                "watermark": "테스트용 변형 데이터" if provider_id == "windy" else None,
                "points": points,
            }
        )
    return {
        "location_id": str(location.id),
        "timezone": "Asia/Seoul",
        "series": series,
        "is_demo": True,
        "notice": "샘플 데이터이며 실제 예보가 아닙니다.",
    }


def daily_comparison(location: Location) -> dict[str, object]:
    hourly = hourly_comparison(location, hours=7 * 24)
    series_out = []
    series = cast(list[dict[str, Any]], hourly["series"])
    for provider in series:
        points = cast(list[dict[str, Any]], provider["points"])
        days = []
        for day_index in range(7):
            chunk = points[day_index * 24 : (day_index + 1) * 24]
            temperatures = [point["air_temperature_c"] for point in chunk]
            precipitation = sum(point["precipitation_amount_mm"] for point in chunk)
            days.append(
                {
                    "date": chunk[0]["valid_at_utc"][:10],
                    "temperature_min_c": min(temperatures),
                    "temperature_max_c": max(temperatures),
                    "precipitation_amount_mm": round(precipitation, 2),
                    "precipitation_interval_seconds": 86400,
                }
            )
        series_out.append({**provider, "points": days})
    return {**hourly, "series": series_out}


def demo_accuracy_summary(location_id: UUID) -> dict[str, object]:
    return {
        "location_id": str(location_id),
        "comparison_mode": "common_sample",
        "period_days": 7,
        "minimum_required_days": 30,
        "minimum_required_samples": 100,
        "winner": None,
        "verdict": "표본 부족 — 가장 정확한 공급자를 아직 판단할 수 없습니다.",
        "metrics": [
            {
                "provider_id": "kma_forecast",
                "provider_variant": "village_short",
                "variable": "air_temperature_c",
                "mae": 1.12,
                "rmse": 1.46,
                "bias": -0.18,
                "sample_count": 72,
                "coverage": 0.94,
                "confidence_interval_95": [0.94, 1.34],
                "rank_eligible": False,
            },
            {
                "provider_id": "met_norway",
                "provider_variant": "compact",
                "variable": "air_temperature_c",
                "mae": 1.18,
                "rmse": 1.53,
                "bias": 0.22,
                "sample_count": 72,
                "coverage": 0.94,
                "confidence_interval_95": [0.98, 1.39],
                "rank_eligible": False,
            },
        ],
        "excluded": [
            {
                "provider_id": "windy_testing",
                "reason": "Testing API 데이터는 정확도 평가가 정책상 금지됨",
            },
            {
                "provider_id": "accuweather",
                "reason": "별도 라이선스 확인 전 평가가 정책상 금지됨",
            },
        ],
        "is_demo": True,
    }
