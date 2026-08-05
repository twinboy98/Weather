from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from app.domain.models import NowcastPoint


@dataclass(frozen=True)
class RainEvent:
    start_at_utc: datetime
    end_at_utc: datetime | None
    maximum_rate_mmh: float
    accumulated_mm: float
    uncertainty_minutes: int


def detect_rain_events(
    points: list[NowcastPoint],
    *,
    rain_on_threshold: float = 0.1,
    rain_off_threshold: float = 0.05,
    minimum_on_duration_minutes: int = 10,
    minimum_off_duration_minutes: int = 20,
) -> list[RainEvent]:
    """Detect stable rain events without inventing timing finer than source frames."""

    if not points:
        return []
    ordered = sorted(points, key=lambda point: point.valid_at_utc)
    events: list[RainEvent] = []
    active = False
    candidate_on_index: int | None = None
    candidate_off_index: int | None = None
    event_start_index: int | None = None

    def duration_from(start_index: int, end_index: int) -> int:
        elapsed = ordered[end_index].valid_at_utc - ordered[start_index].valid_at_utc
        return int(elapsed.total_seconds() // 60) + ordered[end_index].source_resolution_minutes

    for index, point in enumerate(ordered):
        rate = point.precipitation_rate_mmh
        if not active:
            if rate >= rain_on_threshold:
                candidate_on_index = index if candidate_on_index is None else candidate_on_index
                if duration_from(candidate_on_index, index) >= minimum_on_duration_minutes:
                    active = True
                    event_start_index = candidate_on_index
                    candidate_off_index = None
            else:
                candidate_on_index = None
            continue

        if rate <= rain_off_threshold:
            candidate_off_index = index if candidate_off_index is None else candidate_off_index
            if duration_from(candidate_off_index, index) >= minimum_off_duration_minutes:
                if event_start_index is None:
                    raise RuntimeError("active event without a start")
                events.append(_build_event(ordered, event_start_index, candidate_off_index))
                active = False
                candidate_on_index = None
                candidate_off_index = None
                event_start_index = None
        else:
            candidate_off_index = None

    if active and event_start_index is not None:
        events.append(_build_event(ordered, event_start_index, None))
    return events


def _build_event(
    points: list[NowcastPoint], start_index: int, end_index: int | None
) -> RainEvent:
    slice_end = end_index if end_index is not None else len(points)
    event_points = points[start_index:slice_end]
    accumulated = sum(
        point.precipitation_rate_mmh * point.source_resolution_minutes / 60
        for point in event_points
    )
    resolution = max(point.source_resolution_minutes for point in event_points)
    return RainEvent(
        start_at_utc=points[start_index].valid_at_utc,
        end_at_utc=points[end_index].valid_at_utc if end_index is not None else None,
        maximum_rate_mmh=max(point.precipitation_rate_mmh for point in event_points),
        accumulated_mm=round(accumulated, 3),
        uncertainty_minutes=resolution,
    )

