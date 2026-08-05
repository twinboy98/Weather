from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from app.core.errors import UpstreamResponseError
from app.domain.models import (
    ForecastSnapshot,
    ForecastValue,
    IssueTimeQuality,
    horizon_bucket,
)

NORMALIZER_VERSION = "met_norway_compact.v1"
PROVIDER_ID = "met_norway"
PROVIDER_VARIANT = "compact"

_INSTANT_VARIABLES = {
    "air_pressure_at_sea_level",
    "air_temperature",
    "cloud_area_fraction",
    "cloud_area_fraction_high",
    "cloud_area_fraction_low",
    "cloud_area_fraction_medium",
    "dew_point_temperature",
    "fog_area_fraction",
    "relative_humidity",
    "ultraviolet_index_clear_sky",
    "wind_from_direction",
    "wind_speed",
    "wind_speed_of_gust",
}

_ACCUMULATION_WINDOWS = {
    "next_1_hours": 3600,
    "next_6_hours": 6 * 3600,
    "next_12_hours": 12 * 3600,
}


def normalize_compact_forecast(
    payload: Any,
    *,
    location_id: UUID,
    fetched_at_utc: datetime,
    policy_version: str,
    deprecated: bool = False,
    expected_latitude: float | None = None,
    expected_longitude: float | None = None,
) -> list[ForecastSnapshot]:
    """Normalize one MET Norway compact response without performing partial writes.

    Instant values and accumulation windows deliberately become separate snapshots. This
    prevents a one-hour precipitation total from sharing validity metadata with a six-hour
    total that happens to start at the same time.
    """

    if not isinstance(payload, dict):
        raise _normalization_error("response root must be an object", field="payload")
    if (expected_latitude is None) != (expected_longitude is None):
        raise ValueError("expected latitude and longitude must be provided together")
    if expected_latitude is not None and expected_longitude is not None:
        _validate_response_coordinates(
            payload,
            expected_latitude=expected_latitude,
            expected_longitude=expected_longitude,
        )

    fetched_at = _require_aware_utc(fetched_at_utc, "fetched_at_utc")
    properties = _require_mapping(payload.get("properties"), "properties")
    meta = _require_mapping(properties.get("meta"), "properties.meta")
    issued_at = _parse_utc_datetime(meta.get("updated_at"), "properties.meta.updated_at")
    if fetched_at < issued_at:
        raise _normalization_error(
            "fetched_at_utc precedes the provider issue time",
            field="fetched_at_utc",
        )

    units = _require_mapping(meta.get("units"), "properties.meta.units")
    timeseries = properties.get("timeseries")
    if not isinstance(timeseries, list) or not timeseries:
        raise _normalization_error(
            "MET Norway compact response has no timeseries entries",
            field="properties.timeseries",
        )

    payload_hash = _canonical_payload_hash(payload)
    model_run_id = issued_at.isoformat().replace("+00:00", "Z")
    common_quality_flags = [f"normalizer:{NORMALIZER_VERSION}"]
    if deprecated:
        common_quality_flags.append("source_http_203_deprecated")

    snapshots: list[ForecastSnapshot] = []
    logical_keys: set[tuple[datetime, datetime]] = set()
    for index, raw_entry in enumerate(timeseries):
        entry_path = f"properties.timeseries[{index}]"
        entry = _require_mapping(raw_entry, entry_path)
        valid_at = _parse_utc_datetime(entry.get("time"), f"{entry_path}.time")
        if valid_at < issued_at:
            raise _normalization_error(
                "forecast valid time precedes properties.meta.updated_at",
                field=f"{entry_path}.time",
            )

        data = _require_mapping(entry.get("data"), f"{entry_path}.data")
        instant_values = _normalize_instant_values(
            data.get("instant"), units=units, field=f"{entry_path}.data.instant"
        )
        if instant_values:
            snapshot = _build_snapshot(
                location_id=location_id,
                issued_at=issued_at,
                fetched_at=fetched_at,
                valid_from=valid_at,
                valid_to=valid_at,
                model_run_id=model_run_id,
                payload_hash=payload_hash,
                policy_version=policy_version,
                quality_flags=common_quality_flags,
                values=instant_values,
            )
            _append_unique(snapshots, logical_keys, snapshot, entry_path)

        for window_name, interval_seconds in _ACCUMULATION_WINDOWS.items():
            raw_window = data.get(window_name)
            if raw_window is None:
                continue
            window_values = _normalize_accumulation_values(
                raw_window,
                units=units,
                field=f"{entry_path}.data.{window_name}",
            )
            if not window_values:
                raise _normalization_error(
                    f"{window_name} contains no supported values",
                    field=f"{entry_path}.data.{window_name}",
                )
            snapshot = _build_snapshot(
                location_id=location_id,
                issued_at=issued_at,
                fetched_at=fetched_at,
                valid_from=valid_at,
                valid_to=valid_at + timedelta(seconds=interval_seconds),
                model_run_id=model_run_id,
                payload_hash=payload_hash,
                policy_version=policy_version,
                quality_flags=common_quality_flags,
                values=window_values,
            )
            _append_unique(snapshots, logical_keys, snapshot, entry_path)

    if not snapshots:
        raise _normalization_error(
            "MET Norway compact response contains no supported forecast values",
            field="properties.timeseries",
        )
    return snapshots


def _build_snapshot(
    *,
    location_id: UUID,
    issued_at: datetime,
    fetched_at: datetime,
    valid_from: datetime,
    valid_to: datetime,
    model_run_id: str,
    payload_hash: str,
    policy_version: str,
    quality_flags: list[str],
    values: list[ForecastValue],
) -> ForecastSnapshot:
    interval_seconds = int((valid_to - valid_from).total_seconds())
    lead_time_seconds = int((valid_from - issued_at).total_seconds())
    return ForecastSnapshot(
        provider_id=PROVIDER_ID,
        provider_variant=PROVIDER_VARIANT,
        model_name="MET Norway Locationforecast compact",
        model_run_id=model_run_id,
        location_id=location_id,
        issued_at_utc=issued_at,
        fetched_at_utc=fetched_at,
        valid_from_utc=valid_from,
        valid_to_utc=valid_to,
        interval_seconds=interval_seconds,
        lead_time_seconds=lead_time_seconds,
        horizon_bucket=horizon_bucket(lead_time_seconds),
        issue_time_quality=IssueTimeQuality.PROVIDED,
        raw_payload_hash=payload_hash,
        provider_policy_version=policy_version,
        quality_flags=list(quality_flags),
        values=values,
    )


def _normalize_instant_values(
    raw_instant: Any,
    *,
    units: dict[str, Any],
    field: str,
) -> list[ForecastValue]:
    if raw_instant is None:
        return []
    instant = _require_mapping(raw_instant, field)
    details = _require_mapping(instant.get("details"), f"{field}.details")
    values: list[ForecastValue] = []
    parsed: dict[str, float] = {}
    for variable in sorted(_INSTANT_VARIABLES & details.keys()):
        value = _require_finite_number(details[variable], f"{field}.details.{variable}")
        unit = _require_unit(units, variable)
        parsed[variable] = value
        values.append(
            ForecastValue(
                variable=variable,
                value=value,
                unit=unit,
                aggregation="instant",
            )
        )

    if "wind_speed" in parsed and "wind_from_direction" in parsed:
        direction_radians = math.radians(parsed["wind_from_direction"])
        wind_speed_unit = _require_unit(units, "wind_speed")
        values.extend(
            [
                ForecastValue(
                    variable="wind_u",
                    value=-parsed["wind_speed"] * math.sin(direction_radians),
                    unit=wind_speed_unit,
                    aggregation="derived_instant",
                ),
                ForecastValue(
                    variable="wind_v",
                    value=-parsed["wind_speed"] * math.cos(direction_radians),
                    unit=wind_speed_unit,
                    aggregation="derived_instant",
                ),
            ]
        )
    return values


def _normalize_accumulation_values(
    raw_window: Any,
    *,
    units: dict[str, Any],
    field: str,
) -> list[ForecastValue]:
    window = _require_mapping(raw_window, field)
    details = _require_mapping(window.get("details"), f"{field}.details")
    values: list[ForecastValue] = []
    probability: float | None = None
    if "probability_of_precipitation" in details:
        source_probability = _require_finite_number(
            details["probability_of_precipitation"],
            f"{field}.details.probability_of_precipitation",
        )
        probability_unit = _require_unit(units, "probability_of_precipitation").lower()
        if probability_unit in {"%", "percent"}:
            if not 0 <= source_probability <= 100:
                raise _normalization_error(
                    "percentage probability_of_precipitation must be between 0 and 100",
                    field=f"{field}.details.probability_of_precipitation",
                )
            probability = source_probability / 100
        elif probability_unit in {"1", "ratio", "fraction"}:
            if not 0 <= source_probability <= 1:
                raise _normalization_error(
                    "ratio probability_of_precipitation must be between 0 and 1",
                    field=f"{field}.details.probability_of_precipitation",
                )
            probability = source_probability
        else:
            raise _normalization_error(
                "unsupported probability_of_precipitation unit",
                field="properties.meta.units.probability_of_precipitation",
            )
        values.append(
            ForecastValue(
                variable="probability_of_precipitation",
                value=probability,
                unit="ratio",
                aggregation="probability",
                probability=probability,
            )
        )

    if "precipitation_amount" in details:
        amount = _require_finite_number(
            details["precipitation_amount"],
            f"{field}.details.precipitation_amount",
        )
        if amount < 0:
            raise _normalization_error(
                "precipitation_amount must not be negative",
                field=f"{field}.details.precipitation_amount",
            )
        values.append(
            ForecastValue(
                variable="precipitation_amount",
                value=amount,
                unit=_require_unit(units, "precipitation_amount"),
                aggregation="sum",
                probability=probability,
            )
        )

    summary = window.get("summary")
    if summary is not None:
        summary_mapping = _require_mapping(summary, f"{field}.summary")
        symbol_code = summary_mapping.get("symbol_code")
        if symbol_code is not None:
            if not isinstance(symbol_code, str) or not symbol_code.strip():
                raise _normalization_error(
                    "symbol_code must be a non-empty string",
                    field=f"{field}.summary.symbol_code",
                )
            values.append(
                ForecastValue(
                    variable="symbol_code",
                    value=symbol_code,
                    unit="code",
                    aggregation="window_summary",
                )
            )
    return values


def _validate_response_coordinates(
    payload: dict[str, Any],
    *,
    expected_latitude: float,
    expected_longitude: float,
) -> None:
    geometry = _require_mapping(payload.get("geometry"), "geometry")
    if geometry.get("type") != "Point":
        raise _normalization_error("geometry.type must be Point", field="geometry.type")
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise _normalization_error(
            "geometry.coordinates must contain longitude and latitude",
            field="geometry.coordinates",
        )
    response_longitude = _require_finite_number(coordinates[0], "geometry.coordinates[0]")
    response_latitude = _require_finite_number(coordinates[1], "geometry.coordinates[1]")
    # The request client rounds to four decimal places. Half of that resolution plus a
    # small floating-point allowance prevents a valid rounded response from being rejected.
    coordinate_tolerance = 0.000051
    if not math.isclose(
        response_latitude,
        expected_latitude,
        rel_tol=0,
        abs_tol=coordinate_tolerance,
    ) or not math.isclose(
        response_longitude,
        expected_longitude,
        rel_tol=0,
        abs_tol=coordinate_tolerance,
    ):
        raise _normalization_error(
            "response coordinates do not match the requested location",
            field="geometry.coordinates",
        )


def _append_unique(
    snapshots: list[ForecastSnapshot],
    logical_keys: set[tuple[datetime, datetime]],
    snapshot: ForecastSnapshot,
    entry_path: str,
) -> None:
    key = (snapshot.valid_from_utc, snapshot.valid_to_utc)
    if key in logical_keys:
        raise _normalization_error(
            "duplicate forecast validity interval in compact response",
            field=entry_path,
        )
    logical_keys.add(key)
    snapshots.append(snapshot)


def _canonical_payload_hash(payload: dict[str, Any]) -> str:
    try:
        canonical = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise _normalization_error(
            "MET Norway response cannot be canonically serialized",
            field="payload",
        ) from exc
    return hashlib.sha256(canonical).hexdigest()


def _parse_utc_datetime(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise _normalization_error("timestamp must be a non-empty string", field=field)
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise _normalization_error("timestamp is not valid ISO 8601", field=field) from exc
    return _require_aware_utc(parsed, field)


def _require_aware_utc(value: datetime, field: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise _normalization_error("timestamp must include a timezone", field=field)
    return value.astimezone(UTC)


def _require_mapping(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _normalization_error("expected an object", field=field)
    return value


def _require_unit(units: dict[str, Any], variable: str) -> str:
    unit = units.get(variable)
    if not isinstance(unit, str) or not unit.strip():
        raise _normalization_error(
            f"unit is missing for {variable}",
            field=f"properties.meta.units.{variable}",
        )
    return unit


def _require_finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _normalization_error("expected a numeric value", field=field)
    result = float(value)
    if not math.isfinite(result):
        raise _normalization_error("numeric value must be finite", field=field)
    return result


def _normalization_error(message: str, *, field: str) -> UpstreamResponseError:
    return UpstreamResponseError(
        f"MET Norway normalization failed: {message}",
        details={"provider": PROVIDER_ID, "field": field},
    )
