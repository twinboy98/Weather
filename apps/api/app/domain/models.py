from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class HorizonBucket(StrEnum):
    RADAR_NOWCAST = "radar_nowcast_0_2h"
    ULTRA_SHORT = "ultra_short_0_6h"
    SHORT = "short_6_72h"
    MEDIUM = "medium_3_7d"
    EXTENDED = "extended_8_11d"
    PROVIDER_LONG = "provider_specific_12d_plus"


def horizon_bucket(lead_time_seconds: int) -> HorizonBucket:
    hours = lead_time_seconds / 3600
    if hours <= 2:
        return HorizonBucket.RADAR_NOWCAST
    if hours <= 6:
        return HorizonBucket.ULTRA_SHORT
    if hours <= 72:
        return HorizonBucket.SHORT
    if hours <= 7 * 24:
        return HorizonBucket.MEDIUM
    if hours <= 11 * 24:
        return HorizonBucket.EXTENDED
    return HorizonBucket.PROVIDER_LONG


class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    elevation_m: float | None = None
    timezone: str = "Asia/Seoul"
    address: str | None = None
    is_favorite: bool = False
    is_public_benchmark_location: bool = False
    display_order: int = 0


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    elevation_m: float | None = None
    address: str | None = None
    is_favorite: bool | None = None
    is_public_benchmark_location: bool | None = None
    display_order: int | None = None


class Location(LocationCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class IssueTimeQuality(StrEnum):
    PROVIDED = "provided"
    INFERRED = "inferred"
    FETCHED_TIME_ONLY = "fetched_time_only"


class ForecastValue(BaseModel):
    variable: str
    value: float | str
    unit: str
    aggregation: str
    probability: float | None = Field(default=None, ge=0, le=1)
    lower_bound: float | None = None
    upper_bound: float | None = None


class ForecastSnapshot(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    revision: int = Field(default=0, ge=0)
    provider_id: str
    provider_variant: str
    model_name: str | None = None
    model_run_id: str
    location_id: UUID
    issued_at_utc: datetime
    fetched_at_utc: datetime
    valid_from_utc: datetime
    valid_to_utc: datetime
    interval_seconds: int = Field(ge=0)
    lead_time_seconds: int = Field(ge=0)
    horizon_bucket: HorizonBucket
    issue_time_quality: IssueTimeQuality
    raw_payload_hash: str
    provider_policy_version: str
    quality_flags: list[str] = Field(default_factory=list)
    values: list[ForecastValue]

    @field_validator("model_run_id")
    @classmethod
    def validate_model_run_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("model_run_id must not be blank")
        return value

    @model_validator(mode="after")
    def validate_timeline(self) -> ForecastSnapshot:
        timestamps = {
            "issued_at_utc": self.issued_at_utc,
            "fetched_at_utc": self.fetched_at_utc,
            "valid_from_utc": self.valid_from_utc,
            "valid_to_utc": self.valid_to_utc,
        }
        for name, timestamp in timestamps.items():
            if timestamp.tzinfo is None or timestamp.utcoffset() is None:
                raise ValueError(f"{name} must be timezone-aware")

        interval = (self.valid_to_utc - self.valid_from_utc).total_seconds()
        if interval < 0:
            raise ValueError("valid_to_utc must not precede valid_from_utc")
        if interval == 0:
            if self.interval_seconds != 0:
                raise ValueError("instant forecasts must have interval_seconds=0")
        elif interval != self.interval_seconds:
            raise ValueError("interval_seconds is inconsistent with valid_from_utc/valid_to_utc")

        if self.valid_from_utc < self.issued_at_utc:
            raise ValueError("forecast valid time must not precede issue time")
        expected = (self.valid_from_utc - self.issued_at_utc).total_seconds()
        if expected != self.lead_time_seconds:
            raise ValueError("lead_time_seconds is inconsistent with issued_at/valid_from")
        return self


class NowcastPoint(BaseModel):
    provider_id: str
    provider_variant: str
    location_id: UUID
    issued_at_utc: datetime
    valid_at_utc: datetime
    lead_minutes: int = Field(ge=0)
    precipitation_rate_mmh: float = Field(ge=0)
    precipitation_probability: float | None = Field(default=None, ge=0, le=1)
    precipitation_type: str = "rain"
    source_resolution_minutes: int = Field(gt=0)
    source_age_minutes: int = Field(ge=0)
    georeferencing_quality: str
    quality_flags: list[str] = Field(default_factory=list)


class DepartureRequest(BaseModel):
    location_id: UUID | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    exposure_minutes: int = Field(default=30, ge=5, le=240)
    max_wait_minutes: int = Field(default=60, ge=0, le=360)
    candidate_step_minutes: int = Field(default=5, ge=1, le=30)
    use_umbrella: bool = False
    avoid_heavy_rain: bool = True
    lambda_heavy: float = Field(default=1.5, ge=0, le=10)
    lambda_uncertainty: float = Field(default=0.5, ge=0, le=10)
    lambda_wait: float = Field(default=0.002, ge=0, le=1)

    @model_validator(mode="after")
    def require_location_reference(self) -> DepartureRequest:
        has_coordinates = self.latitude is not None and self.longitude is not None
        partial_coordinates = (self.latitude is None) != (self.longitude is None)
        if partial_coordinates:
            raise ValueError("latitude and longitude must be provided together")
        if self.location_id is None and not has_coordinates:
            raise ValueError("location_id or latitude/longitude is required")
        return self


class DepartureCandidate(BaseModel):
    departure_at_utc: datetime
    wait_minutes: int
    expected_wetness_mm: float
    maximum_rate_mmh: float
    objective: float


class DepartureRecommendation(BaseModel):
    recommended: DepartureCandidate
    now: DepartureCandidate
    alternatives: list[DepartureCandidate]
    reduction_percent: float
    confidence: str
    reasons: list[str]
    forecast_issued_at_utc: datetime
    assumption: str
