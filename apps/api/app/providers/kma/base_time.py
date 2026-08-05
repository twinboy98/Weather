from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")
SHORT_FORECAST_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)


@dataclass(frozen=True)
class BaseTimeSelection:
    issued_at_utc: datetime
    base_date: str
    base_time: str
    used_fallback: bool


def select_short_forecast_base_time(
    requested_at: datetime, *, publication_delay_minutes: int = 10
) -> BaseTimeSelection:
    """Select the most recent KMA short-forecast issue available after publication delay."""

    if requested_at.tzinfo is None:
        raise ValueError("requested_at must be timezone-aware")
    local = requested_at.astimezone(SEOUL)
    candidates: list[datetime] = []
    for day_offset in (0, -1):
        day = (local + timedelta(days=day_offset)).date()
        candidates.extend(
            datetime(day.year, day.month, day.day, hour, tzinfo=SEOUL)
            for hour in SHORT_FORECAST_HOURS
        )
    available = [
        candidate
        for candidate in candidates
        if candidate + timedelta(minutes=publication_delay_minutes) <= local
    ]
    if not available:
        raise RuntimeError("no KMA base time candidate")
    issued = max(available)
    latest_scheduled_today = max(
        candidate for candidate in candidates if candidate <= local
    )
    used_fallback = latest_scheduled_today > issued
    return BaseTimeSelection(
        issued_at_utc=issued.astimezone(UTC),
        base_date=issued.strftime("%Y%m%d"),
        base_time=issued.strftime("%H%M"),
        used_fallback=used_fallback,
    )


def select_ultra_short_base_time(
    requested_at: datetime, *, publication_minute: int = 45
) -> BaseTimeSelection:
    """Select hourly KMA ultra-short base time, falling back until data should be published."""

    if requested_at.tzinfo is None:
        raise ValueError("requested_at must be timezone-aware")
    local = requested_at.astimezone(SEOUL)
    issued = local.replace(minute=0, second=0, microsecond=0)
    used_fallback = False
    if local.minute < publication_minute:
        issued -= timedelta(hours=1)
        used_fallback = True
    return BaseTimeSelection(
        issued_at_utc=issued.astimezone(UTC),
        base_date=issued.strftime("%Y%m%d"),
        base_time=issued.strftime("%H%M"),
        used_fallback=used_fallback,
    )

