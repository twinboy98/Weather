from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from app.domain.models import DepartureRequest, HorizonBucket, NowcastPoint, horizon_bucket
from app.nowcast.events import detect_rain_events
from app.routing.departure import integrate_exposure, recommend_departure


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (3600, HorizonBucket.RADAR_NOWCAST),
        (3 * 3600, HorizonBucket.ULTRA_SHORT),
        (24 * 3600, HorizonBucket.SHORT),
        (5 * 86400, HorizonBucket.MEDIUM),
        (9 * 86400, HorizonBucket.EXTENDED),
        (12 * 86400, HorizonBucket.PROVIDER_LONG),
    ],
)
def test_horizon_bucket(seconds: int, expected: HorizonBucket) -> None:
    assert horizon_bucket(seconds) is expected


def make_points(rates: list[float]) -> list[NowcastPoint]:
    issued = datetime(2026, 8, 3, tzinfo=UTC)
    location_id = uuid4()
    return [
        NowcastPoint(
            provider_id="kma_nowcast",
            provider_variant="fixture",
            location_id=location_id,
            issued_at_utc=issued,
            valid_at_utc=issued + timedelta(minutes=index * 10),
            lead_minutes=index * 10,
            precipitation_rate_mmh=rate,
            source_resolution_minutes=10,
            source_age_minutes=2,
            georeferencing_quality="fixture",
        )
        for index, rate in enumerate(rates)
    ]


def test_rain_hysteresis_ignores_single_noisy_frame() -> None:
    points = make_points([0, 0.2, 0.08, 0.25, 0.3, 0.04, 0.08, 0.0, 0.0])
    events = detect_rain_events(points)
    assert len(events) == 1
    assert events[0].start_at_utc == points[1].valid_at_utc
    assert events[0].end_at_utc == points[7].valid_at_utc


def test_exposure_uses_interval_overlap() -> None:
    points = make_points([1.0, 2.0, 3.0])
    departure = points[0].valid_at_utc + timedelta(minutes=5)
    wetness, maximum = integrate_exposure(points, departure, 20)
    assert wetness == pytest.approx((5 * 1 + 10 * 2 + 5 * 3) / 60)
    assert maximum == 3.0


def test_departure_recommends_waiting_for_rain_to_clear() -> None:
    points = make_points([4, 4, 3, 2, 1, 0.04, 0, 0, 0])
    request = DepartureRequest(
        location_id=points[0].location_id,
        exposure_minutes=30,
        max_wait_minutes=70,
        lambda_wait=0.0005,
    )
    result = recommend_departure(request, points)
    assert result.recommended.wait_minutes >= 50
    assert result.reduction_percent > 90

