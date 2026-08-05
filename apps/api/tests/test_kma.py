from datetime import UTC, datetime

import pytest
from app.providers.kma.base_time import (
    select_short_forecast_base_time,
    select_ultra_short_base_time,
)
from app.providers.kma.grid import latitude_longitude_to_grid


@pytest.mark.parametrize(
    ("latitude", "longitude", "expected"),
    [
        (37.5665, 126.9780, (60, 127)),  # Seoul
        (37.4563, 126.7052, (55, 124)),  # Incheon
        (35.1796, 129.0756, (98, 76)),  # Busan
        (33.4996, 126.5312, (53, 38)),  # Jeju city center
    ],
)
def test_kma_grid_golden(latitude: float, longitude: float, expected: tuple[int, int]) -> None:
    grid = latitude_longitude_to_grid(latitude, longitude)
    assert (grid.nx, grid.ny) == expected


def test_short_base_time_waits_for_publication_delay() -> None:
    selected = select_short_forecast_base_time(datetime(2026, 8, 3, 17, 5, tzinfo=UTC))
    # 02:05 KST, 02:00 run should not yet be assumed available.
    assert selected.base_date == "20260803"
    assert selected.base_time == "2300"
    assert selected.used_fallback is True


def test_ultra_short_base_time_records_fallback() -> None:
    selected = select_ultra_short_base_time(datetime(2026, 8, 3, 1, 20, tzinfo=UTC))
    assert selected.base_time == "0900"
    assert selected.used_fallback is True


def test_base_time_requires_timezone() -> None:
    with pytest.raises(ValueError):
        select_short_forecast_base_time(datetime(2026, 8, 3, 12))
