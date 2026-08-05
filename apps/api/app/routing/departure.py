from __future__ import annotations

from datetime import datetime, timedelta

from app.domain.models import (
    DepartureCandidate,
    DepartureRecommendation,
    DepartureRequest,
    NowcastPoint,
)


def recommend_departure(
    request: DepartureRequest,
    points: list[NowcastPoint],
    *,
    disagreement: float = 0.15,
) -> DepartureRecommendation:
    if not points:
        raise ValueError("nowcast points are required")
    ordered = sorted(points, key=lambda point: point.valid_at_utc)
    start = max(ordered[0].issued_at_utc, ordered[0].valid_at_utc)
    candidates: list[DepartureCandidate] = []
    for wait_minutes in range(
        0, request.max_wait_minutes + 1, request.candidate_step_minutes
    ):
        departure = start + timedelta(minutes=wait_minutes)
        wetness, maximum_rate = integrate_exposure(
            ordered, departure, request.exposure_minutes
        )
        umbrella_factor = 0.35 if request.use_umbrella else 1.0
        wetness *= umbrella_factor
        heavy_penalty = 0.0
        if request.avoid_heavy_rain:
            heavy_penalty = max(0.0, maximum_rate - 5.0) * request.lambda_heavy
        objective = (
            wetness
            + heavy_penalty
            + disagreement * request.lambda_uncertainty
            + wait_minutes * request.lambda_wait
        )
        candidates.append(
            DepartureCandidate(
                departure_at_utc=departure,
                wait_minutes=wait_minutes,
                expected_wetness_mm=round(wetness, 3),
                maximum_rate_mmh=round(maximum_rate, 3),
                objective=round(objective, 4),
            )
        )

    ranked = sorted(candidates, key=lambda candidate: (candidate.objective, candidate.wait_minutes))
    best = ranked[0]
    now_candidate = candidates[0]
    reduction = (
        max(0.0, (now_candidate.expected_wetness_mm - best.expected_wetness_mm))
        / now_candidate.expected_wetness_mm
        * 100
        if now_candidate.expected_wetness_mm > 0
        else 0.0
    )
    source_age = max(point.source_age_minutes for point in ordered)
    confidence = "높음" if disagreement < 0.2 and source_age <= 15 else "보통"
    if disagreement >= 0.45 or source_age > 30:
        confidence = "낮음"
    reasons = [
        f"현재 출발 대비 예상 강수 노출량 {reduction:.0f}% 감소",
        f"자료 생성 후 최대 {source_age}분 경과",
    ]
    if disagreement >= 0.3:
        reasons.append("공급자 간 예측 차이가 있어 불확실성 패널티를 적용함")
    if best.wait_minutes == 0:
        reasons.insert(0, "기다림의 이득이 대기 비용보다 작아 지금 출발 권장")
    return DepartureRecommendation(
        recommended=best,
        now=now_candidate,
        alternatives=ranked[1:3],
        reduction_percent=round(reduction, 1),
        confidence=confidence,
        reasons=reasons,
        forecast_issued_at_utc=ordered[0].issued_at_utc,
        assumption="경로 정보가 없어 선택 위치에서 지정 노출시간 동안 머문다고 가정",
    )


def integrate_exposure(
    points: list[NowcastPoint], departure: datetime, exposure_minutes: int
) -> tuple[float, float]:
    """Integrate piecewise-constant source frames without asserting sub-frame forecast timing."""

    end = departure + timedelta(minutes=exposure_minutes)
    wetness = 0.0
    maximum_rate = 0.0
    for point in points:
        frame_start = point.valid_at_utc
        frame_end = frame_start + timedelta(minutes=point.source_resolution_minutes)
        overlap_start = max(frame_start, departure)
        overlap_end = min(frame_end, end)
        if overlap_end <= overlap_start:
            continue
        hours = (overlap_end - overlap_start).total_seconds() / 3600
        wetness += point.precipitation_rate_mmh * hours
        maximum_rate = max(maximum_rate, point.precipitation_rate_mmh)
    return wetness, maximum_rate

