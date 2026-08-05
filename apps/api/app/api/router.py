from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from functools import lru_cache
from typing import Annotated, Any
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.demo_service import (
    current_weather,
    daily_comparison,
    demo_accuracy_summary,
    hourly_comparison,
)
from app.core.errors import PolicyViolation
from app.core.policy import PolicyAction, PolicyGate
from app.core.settings import get_settings
from app.domain.models import (
    DepartureRecommendation,
    DepartureRequest,
    Location,
    LocationCreate,
    LocationUpdate,
)
from app.nowcast.demo import demo_nowcast_points
from app.nowcast.events import detect_rain_events
from app.providers.accuweather.adapter import BLOCKED_MESSAGE
from app.providers.rainviewer.adapter import CAPABILITIES as RAINVIEWER_CAPABILITIES
from app.routing.departure import recommend_departure
from app.storage.database import LocationRepository, get_db

router = APIRouter(prefix="/api/v1")
DbSession = Annotated[Session, Depends(get_db)]


@lru_cache
def get_policy_gate() -> PolicyGate:
    return PolicyGate.from_yaml(get_settings().provider_policy_path)


def require_location(
    session: Session,
    location_id: UUID | None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> Location:
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="위도와 경도를 함께 입력해야 합니다.")
    if latitude is not None and longitude is not None:
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            raise HTTPException(status_code=422, detail="유효한 위도·경도가 아닙니다.")
        rounded_latitude = round(latitude, 4)
        rounded_longitude = round(longitude, 4)
        return Location(
            id=uuid5(
                NAMESPACE_URL,
                f"weatherbench-current:{rounded_latitude}:{rounded_longitude}",
            ),
            name="현재 위치",
            latitude=rounded_latitude,
            longitude=rounded_longitude,
            timezone="Asia/Seoul",
        )
    repository = LocationRepository(session)
    if location_id is None:
        locations = repository.list()
        if not locations:
            raise HTTPException(status_code=404, detail="저장된 위치가 없습니다.")
        return locations[0]
    location = repository.get(str(location_id))
    if location is None:
        raise HTTPException(status_code=404, detail="위치를 찾을 수 없습니다.")
    return location


@router.get("/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "demo_mode": settings.demo_mode,
        "time_utc": datetime.now(UTC).isoformat(),
    }


@router.get("/locations", response_model=list[Location])
def list_locations(session: DbSession) -> list[Location]:
    return LocationRepository(session).list()


@router.post("/locations", response_model=Location, status_code=status.HTTP_201_CREATED)
def create_location(payload: LocationCreate, session: DbSession) -> Location:
    return LocationRepository(session).create(payload)


@router.patch("/locations/{location_id}", response_model=Location)
def update_location(location_id: UUID, payload: LocationUpdate, session: DbSession) -> Location:
    result = LocationRepository(session).update(str(location_id), payload)
    if result is None:
        raise HTTPException(status_code=404, detail="위치를 찾을 수 없습니다.")
    return result


@router.delete("/locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_location(location_id: UUID, session: DbSession) -> None:
    if not LocationRepository(session).delete(str(location_id)):
        raise HTTPException(status_code=404, detail="위치를 찾을 수 없습니다.")


@router.get("/weather/current")
def get_current_weather(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    return current_weather(require_location(session, location_id, latitude, longitude))


@router.get("/forecast/compare")
def compare_forecasts(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, object]:
    return hourly_comparison(
        require_location(session, location_id, latitude, longitude), hours=hours
    )


@router.get("/forecast/hourly")
def hourly_forecast(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
    hours: int = Query(default=72, ge=1, le=168),
) -> dict[str, object]:
    return hourly_comparison(
        require_location(session, location_id, latitude, longitude), hours=hours
    )


@router.get("/forecast/daily")
def daily_forecast(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    return daily_comparison(require_location(session, location_id, latitude, longitude))


@router.get("/nowcast")
def get_nowcast(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    location = require_location(session, location_id, latitude, longitude)
    points = demo_nowcast_points(location.id)
    return {
        "location_id": str(location.id),
        "points": [point.model_dump(mode="json") for point in points],
        "latest_issued_at_utc": points[0].issued_at_utc.isoformat(),
        "source_age_minutes": points[0].source_age_minutes,
        "confidence": "보통",
        "confidence_reasons": [
            "DEMO fixture이므로 실제 레이더 신뢰도를 나타내지 않음",
            "10분 간격 원자료보다 세밀한 시각은 단정하지 않음",
        ],
        "is_demo": True,
    }


@router.get("/nowcast/events")
def get_nowcast_events(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    location = require_location(session, location_id, latitude, longitude)
    points = demo_nowcast_points(location.id)
    events = detect_rain_events(points)
    return {
        "location_id": str(location.id),
        "events": [
            {
                "start_at_utc": event.start_at_utc.isoformat(),
                "end_at_utc": event.end_at_utc.isoformat() if event.end_at_utc else None,
                "maximum_rate_mmh": event.maximum_rate_mmh,
                "accumulated_mm": event.accumulated_mm,
                "uncertainty_minutes": event.uncertainty_minutes,
            }
            for event in events
        ],
        "confidence": "보통",
        "provider_disagreement_warning": False,
        "is_demo": True,
    }


@router.get("/nowcast/map-frames")
def get_map_frames() -> dict[str, object]:
    return {
        "status": "disabled",
        "reason": (
            "공식 KMA 좌표계·extent·palette 검증 전 수치 추출과 "
            "지도 프레임을 활성화하지 않음"
        ),
        "rainviewer": RAINVIEWER_CAPABILITIES,
        "experimental": True,
    }


@router.get("/nowcast/stream")
async def stream_nowcast(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> StreamingResponse:
    location = require_location(session, location_id, latitude, longitude)

    async def event_stream() -> AsyncGenerator[str, None]:
        while True:
            points = demo_nowcast_points(location.id)
            events = detect_rain_events(points)
            payload = {
                "type": "nowcast_updated",
                "location_id": str(location.id),
                "issued_at_utc": points[0].issued_at_utc.isoformat(),
                "event_count": len(events),
                "is_demo": True,
            }
            yield f"event: nowcast_updated\ndata: {json.dumps(payload)}\n\n"
            await asyncio.sleep(30)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/departure/recommend", response_model=DepartureRecommendation)
def departure_recommend(payload: DepartureRequest, session: DbSession) -> DepartureRecommendation:
    location = require_location(
        session, payload.location_id, payload.latitude, payload.longitude
    )
    return recommend_departure(payload, demo_nowcast_points(location.id))


@router.post("/departure/evaluate")
def departure_evaluate() -> dict[str, object]:
    return {
        "status": "experimental",
        "regret_mm": None,
        "reason": "관측 나우캐스트 이력이 축적된 뒤 realized wetness와 최적 사후 출발을 비교함",
    }


@router.get("/accuracy/summary")
def accuracy_summary(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    location = require_location(session, location_id, latitude, longitude)
    return demo_accuracy_summary(location.id)


@router.get("/accuracy/timeseries")
def accuracy_timeseries(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    location = require_location(session, location_id, latitude, longitude)
    return {
        "location_id": str(location.id),
        "periods": [30, 90, 365],
        "series": [],
        "status": "insufficient_history",
        "is_demo": True,
    }


@router.get("/accuracy/ranking")
def accuracy_ranking(
    session: DbSession,
    location_id: UUID | None = None,
    latitude: float | None = Query(default=None, ge=-90, le=90),
    longitude: float | None = Query(default=None, ge=-180, le=180),
) -> dict[str, object]:
    location = require_location(session, location_id, latitude, longitude)
    summary = demo_accuracy_summary(location.id)
    return {
        "location_id": str(location.id),
        "winner": None,
        "statistically_indistinguishable_group": [],
        "verdict": summary["verdict"],
        "sample_count_required": 100,
    }


@router.get("/accuracy/calibration")
def accuracy_calibration() -> dict[str, object]:
    return {"status": "insufficient_probability_samples", "bins": [], "is_demo": True}


@router.get("/accuracy/confusion-matrix")
def accuracy_confusion_matrix() -> dict[str, object]:
    return {
        "threshold_mmh": 0.1,
        "true_positive": 12,
        "false_positive": 3,
        "false_negative": 4,
        "true_negative": 53,
        "positive_event_count": 16,
        "rank_eligible": False,
        "reason": "positive event 최소 20개 미달",
        "is_demo": True,
    }


@router.get("/providers")
def providers() -> dict[str, object]:
    return {
        "providers": [
            {"provider_id": "kma_forecast", "variants": ["village_short", "medium"]},
            {"provider_id": "met_norway", "variants": ["compact"]},
            {"provider_id": "windy", "variants": ["gfs", "icon"]},
            {"provider_id": "rainviewer", **RAINVIEWER_CAPABILITIES},
        ]
    }


@router.get("/providers/status")
def provider_statuses() -> dict[str, object]:
    settings = get_settings()
    return {
        "demo_mode": settings.demo_mode,
        "providers": [
            {
                "provider_id": "kma_forecast",
                "status": "fixture" if settings.demo_mode else "not_configured",
                "live_fetch": bool(settings.kma_service_key),
                "benchmark": "license_confirmation_required",
                "attribution": "기상청 제공",
            },
            {
                "provider_id": "met_norway",
                "status": "fixture" if settings.demo_mode else "ready",
                "live_fetch": True,
                "benchmark": True,
                "attribution": "Weather data from MET Norway, CC BY 4.0",
            },
            {
                "provider_id": "windy_testing",
                "status": "disabled" if not settings.windy_api_key else "testing",
                "live_fetch": bool(settings.windy_api_key),
                "benchmark": False,
                "watermark": "테스트용 변형 데이터",
            },
            {
                "provider_id": "accuweather",
                "status": "policy_blocked",
                "live_fetch": False,
                "benchmark": False,
                "reason": BLOCKED_MESSAGE,
            },
        ],
    }


@router.get("/providers/policies")
def provider_policies() -> dict[str, object]:
    gate = get_policy_gate()
    return {
        "version": gate.version,
        "providers": [policy.model_dump(mode="json") for policy in gate.all()],
    }


def verify_admin_token(x_admin_token: Annotated[str | None, Header()] = None) -> None:
    if x_admin_token != get_settings().admin_token:
        raise HTTPException(status_code=401, detail="관리자 토큰이 필요합니다.")


@router.post("/admin/ingest/forecasts", dependencies=[Depends(verify_admin_token)])
def admin_ingest_forecasts() -> dict[str, object]:
    if get_settings().demo_mode:
        return {"status": "completed", "mode": "demo_fixture", "snapshots": 672}
    return {"status": "queued"}


@router.post("/admin/ingest/observations", dependencies=[Depends(verify_admin_token)])
def admin_ingest_observations() -> dict[str, object]:
    return {"status": "completed" if get_settings().demo_mode else "queued", "mode": "demo"}


@router.post("/admin/score", dependencies=[Depends(verify_admin_token)])
def admin_score() -> dict[str, object]:
    gate = get_policy_gate()
    benchmarkable: list[str] = []
    for policy in gate.all():
        try:
            gate.require(policy.provider_id, PolicyAction.BENCHMARK)
        except PolicyViolation:
            continue
        benchmarkable.append(policy.provider_id)
    return {"status": "completed", "benchmarkable_providers": benchmarkable}


@router.post("/admin/export", dependencies=[Depends(verify_admin_token)])
def admin_export() -> dict[str, Any]:
    gate = get_policy_gate()
    providers_allowed = sorted(gate.exportable_provider_ids())
    return {
        "status": "completed",
        "providers_included": providers_allowed,
        "providers_excluded": sorted(
            policy.provider_id
            for policy in gate.all()
            if policy.provider_id not in providers_allowed
        ),
        "policy_version": gate.version,
    }
