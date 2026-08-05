from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

import pytest
from app.core.errors import UpstreamResponseError
from app.domain.models import ForecastSnapshot, ForecastValue
from app.providers.met_norway.normalizer import NORMALIZER_VERSION, normalize_compact_forecast

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "data"
    / "fixtures"
    / "met_norway_compact.json"
)
LOCATION_ID = UUID("11111111-2222-3333-4444-555555555555")
FETCHED_AT = datetime(2026, 8, 3, 9, 5, tzinfo=UTC)
ISSUED_AT = datetime(2026, 8, 3, 9, tzinfo=UTC)
FIRST_VALID_AT = datetime(2026, 8, 3, 10, tzinfo=UTC)
EXPECTED_PAYLOAD_HASH = (
    "dcb11b886fb75079570a3dbf63d9dc61d7d01af15822f73eb86100d50581eb72"
)


def load_payload() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def normalize(
    payload: dict[str, Any], *, deprecated: bool = False
) -> list[ForecastSnapshot]:
    return normalize_compact_forecast(
        payload,
        location_id=LOCATION_ID,
        fetched_at_utc=FETCHED_AT,
        policy_version="policy-test-v1",
        deprecated=deprecated,
    )


def snapshot_at(
    snapshots: list[ForecastSnapshot], valid_from: datetime, interval_seconds: int
) -> ForecastSnapshot:
    matches = [
        snapshot
        for snapshot in snapshots
        if snapshot.valid_from_utc == valid_from
        and snapshot.interval_seconds == interval_seconds
    ]
    assert len(matches) == 1
    return matches[0]


def value_for(snapshot: ForecastSnapshot, variable: str) -> ForecastValue:
    matches = [value for value in snapshot.values if value.variable == variable]
    assert len(matches) == 1
    return matches[0]


def reverse_mapping_order(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: reverse_mapping_order(value[key])
            for key in reversed(tuple(value.keys()))
        }
    if isinstance(value, list):
        return [reverse_mapping_order(item) for item in value]
    return value


def test_met_compact_normalizes_times_and_keeps_intervals_distinct() -> None:
    snapshots = normalize(load_payload())

    assert len(snapshots) == 4
    assert isinstance(NORMALIZER_VERSION, str)
    assert NORMALIZER_VERSION.strip()
    assert all(isinstance(snapshot, ForecastSnapshot) for snapshot in snapshots)
    assert all(snapshot.provider_id == "met_norway" for snapshot in snapshots)
    assert all(snapshot.provider_variant == "compact" for snapshot in snapshots)
    assert all(snapshot.location_id == LOCATION_ID for snapshot in snapshots)
    assert all(snapshot.issued_at_utc == ISSUED_AT for snapshot in snapshots)
    assert all(snapshot.fetched_at_utc == FETCHED_AT for snapshot in snapshots)
    assert all(
        f"normalizer:{NORMALIZER_VERSION}" in snapshot.quality_flags
        for snapshot in snapshots
    )

    for snapshot in snapshots:
        for timestamp in (
            snapshot.issued_at_utc,
            snapshot.fetched_at_utc,
            snapshot.valid_from_utc,
            snapshot.valid_to_utc,
        ):
            assert timestamp.tzinfo is not None
            assert timestamp.utcoffset() == timedelta(0)

    instant = snapshot_at(snapshots, FIRST_VALID_AT, 0)
    one_hour = snapshot_at(snapshots, FIRST_VALID_AT, 3600)
    six_hours = snapshot_at(snapshots, FIRST_VALID_AT, 21600)

    assert instant.valid_from_utc == instant.valid_to_utc == FIRST_VALID_AT
    assert one_hour.valid_from_utc == six_hours.valid_from_utc == FIRST_VALID_AT
    assert one_hour.valid_to_utc == FIRST_VALID_AT + timedelta(hours=1)
    assert six_hours.valid_to_utc == FIRST_VALID_AT + timedelta(hours=6)


def test_met_compact_normalizes_units_probabilities_and_wind_vectors() -> None:
    snapshots = normalize(load_payload())
    instant = snapshot_at(snapshots, FIRST_VALID_AT, 0)
    one_hour = snapshot_at(snapshots, FIRST_VALID_AT, 3600)
    six_hours = snapshot_at(snapshots, FIRST_VALID_AT, 21600)

    temperature = value_for(instant, "air_temperature")
    assert temperature.value == pytest.approx(27.2)
    assert temperature.unit == "celsius"

    wind_u = value_for(instant, "wind_u")
    wind_v = value_for(instant, "wind_v")
    assert wind_u.unit == wind_v.unit == "m/s"
    assert wind_u.value == pytest.approx(2.82842712474619)
    assert wind_v.value == pytest.approx(2.82842712474619)

    one_hour_amount = value_for(one_hour, "precipitation_amount")
    one_hour_probability = value_for(one_hour, "probability_of_precipitation")
    assert one_hour_amount.value == pytest.approx(0.4)
    assert one_hour_amount.unit == "mm"
    assert one_hour_amount.probability == pytest.approx(0.35)
    assert one_hour_probability.value == pytest.approx(0.35)
    assert one_hour_probability.unit == "ratio"

    six_hour_amount = value_for(six_hours, "precipitation_amount")
    six_hour_probability = value_for(six_hours, "probability_of_precipitation")
    assert six_hour_amount.value == pytest.approx(2.1)
    assert six_hour_amount.unit == "mm"
    assert six_hour_amount.probability == pytest.approx(0.70)
    assert six_hour_probability.value == pytest.approx(0.70)
    assert six_hour_probability.unit == "ratio"

    normalized_probabilities = [
        value.value
        for snapshot in snapshots
        for value in snapshot.values
        if value.variable == "probability_of_precipitation"
    ]
    assert normalized_probabilities
    assert all(
        isinstance(probability, float) and 0 <= probability <= 1
        for probability in normalized_probabilities
    )


def test_met_compact_uses_stable_canonical_sha256() -> None:
    payload = load_payload()
    reordered_payload = reverse_mapping_order(payload)

    hashes = {snapshot.raw_payload_hash for snapshot in normalize(payload)}
    reordered_hashes = {
        snapshot.raw_payload_hash for snapshot in normalize(reordered_payload)
    }

    assert hashes == {EXPECTED_PAYLOAD_HASH}
    assert reordered_hashes == hashes


def test_met_compact_marks_deprecated_203_source() -> None:
    snapshots = normalize(load_payload(), deprecated=True)

    assert snapshots
    assert all(
        any("203" in flag and "deprecat" in flag.lower() for flag in snapshot.quality_flags)
        for snapshot in snapshots
    )


def test_met_compact_supports_twelve_hour_accumulation_without_mixing_windows() -> None:
    payload = load_payload()
    payload["properties"]["timeseries"][0]["data"]["next_12_hours"] = {
        "summary": {"symbol_code": "heavyrain"},
        "details": {
            "precipitation_amount": 5.4,
            "probability_of_precipitation": 85.0,
        },
    }

    snapshots = normalize(payload)
    twelve_hours = snapshot_at(snapshots, FIRST_VALID_AT, 43200)

    assert twelve_hours.valid_to_utc == FIRST_VALID_AT + timedelta(hours=12)
    assert value_for(twelve_hours, "precipitation_amount").value == pytest.approx(5.4)
    assert value_for(twelve_hours, "probability_of_precipitation").value == pytest.approx(
        0.85
    )


def test_met_compact_converts_probability_according_to_declared_unit() -> None:
    payload = load_payload()
    payload["properties"]["meta"]["units"]["probability_of_precipitation"] = "ratio"
    first_details = payload["properties"]["timeseries"][0]["data"]
    first_details["next_1_hours"]["details"]["probability_of_precipitation"] = 0.35
    first_details["next_6_hours"]["details"]["probability_of_precipitation"] = 0.70

    one_hour = snapshot_at(normalize(payload), FIRST_VALID_AT, 3600)

    assert value_for(one_hour, "probability_of_precipitation").value == pytest.approx(0.35)


def test_met_compact_rejects_unknown_probability_unit() -> None:
    payload = load_payload()
    payload["properties"]["meta"]["units"]["probability_of_precipitation"] = "unknown"

    with pytest.raises(UpstreamResponseError):
        normalize(payload)


def test_met_compact_rejects_non_object_response_root() -> None:
    with pytest.raises(UpstreamResponseError):
        normalize_compact_forecast(
            [],
            location_id=LOCATION_ID,
            fetched_at_utc=FETCHED_AT,
            policy_version="policy-test-v1",
        )


@pytest.mark.parametrize(
    "malformation",
    [
        "known_numeric",
        "naive_issued_at",
        "missing_issued_at",
        "naive_valid_at",
        "missing_valid_at",
    ],
)
def test_met_compact_rejects_malformed_payload_atomically(malformation: str) -> None:
    payload = deepcopy(load_payload())
    properties = payload["properties"]
    second_point = properties["timeseries"][1]

    if malformation == "known_numeric":
        second_point["data"]["instant"]["details"]["air_temperature"] = "warm"
    elif malformation == "naive_issued_at":
        properties["meta"]["updated_at"] = "2026-08-03T09:00:00"
    elif malformation == "missing_issued_at":
        del properties["meta"]["updated_at"]
    elif malformation == "naive_valid_at":
        second_point["time"] = "2026-08-03T11:00:00"
    else:
        del second_point["time"]

    with pytest.raises(UpstreamResponseError):
        normalize(payload)
