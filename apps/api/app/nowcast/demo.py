from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.domain.models import NowcastPoint

RAIN_PATTERN = [0.0, 0.0, 0.12, 0.35, 1.2, 2.4, 3.8, 2.6, 1.0, 0.3, 0.04, 0.0, 0.0]


def demo_nowcast_points(
    location_id: UUID,
    *,
    now: datetime | None = None,
    provider_variant: str = "qpf_fixture",
) -> list[NowcastPoint]:
    current = now or datetime.now(UTC)
    issued = current.replace(
        minute=(current.minute // 10) * 10,
        second=0,
        microsecond=0,
    )
    return [
        NowcastPoint(
            provider_id="kma_nowcast",
            provider_variant=provider_variant,
            location_id=location_id,
            issued_at_utc=issued,
            valid_at_utc=issued + timedelta(minutes=index * 10),
            lead_minutes=index * 10,
            precipitation_rate_mmh=rate,
            precipitation_probability=min(0.98, 0.08 + rate * 0.22),
            source_resolution_minutes=10,
            source_age_minutes=max(0, int((current - issued).total_seconds() // 60)),
            georeferencing_quality="demo_fixture_not_official_raster_extraction",
            quality_flags=["demo_fixture"],
        )
        for index, rate in enumerate(RAIN_PATTERN)
    ]

