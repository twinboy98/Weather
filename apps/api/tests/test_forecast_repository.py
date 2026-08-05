from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from app.domain.models import (
    ForecastSnapshot,
    ForecastValue,
    HorizonBucket,
    IssueTimeQuality,
)
from app.storage.database import (
    Base,
    ForecastRepository,
    ForecastSnapshotRow,
    ForecastValueRow,
    ForecastWriteResult,
    LocationRow,
    create_session_factory,
)
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


@pytest.fixture
def session() -> Generator[Session, None, None]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as database_session:
        yield database_session
    engine.dispose()


@pytest.fixture
def location_id(session: Session) -> UUID:
    identifier = uuid4()
    session.add(
        LocationRow(
            id=str(identifier),
            name="Repository test",
            latitude=37.5,
            longitude=127.0,
        )
    )
    session.commit()
    return identifier


def make_snapshot(
    location_id: UUID,
    *,
    valid_to_hours: int = 1,
    raw_payload_hash: str = "a" * 64,
    temperature: float = 12.5,
) -> ForecastSnapshot:
    issued_at = datetime(2026, 8, 3, tzinfo=UTC)
    valid_from = issued_at + timedelta(hours=1)
    return ForecastSnapshot(
        provider_id="met_norway",
        provider_variant="compact",
        model_name="locationforecast",
        model_run_id="2026-08-03T00:00:00Z",
        location_id=location_id,
        issued_at_utc=issued_at,
        fetched_at_utc=issued_at + timedelta(minutes=2),
        valid_from_utc=valid_from,
        valid_to_utc=valid_from + timedelta(hours=valid_to_hours),
        interval_seconds=valid_to_hours * 3600,
        lead_time_seconds=3600,
        horizon_bucket=HorizonBucket.RADAR_NOWCAST,
        issue_time_quality=IssueTimeQuality.PROVIDED,
        raw_payload_hash=raw_payload_hash,
        provider_policy_version="2026-08-03",
        quality_flags=["fixture"],
        values=[
            ForecastValue(
                variable="air_temperature",
                value=temperature,
                unit="degC",
                aggregation="instant",
            ),
            ForecastValue(
                variable="symbol_code",
                value="clearsky_day",
                unit="code",
                aggregation="instant",
            ),
        ],
    )


def test_session_factory_enables_sqlite_foreign_keys() -> None:
    factory = create_session_factory("sqlite://")
    engine = factory.kw["bind"]
    try:
        with factory() as sqlite_session:
            assert sqlite_session.scalar(text("PRAGMA foreign_keys")) == 1
    finally:
        engine.dispose()


def test_save_all_inserts_snapshot_and_numeric_and_text_values(
    session: Session,
    location_id: UUID,
) -> None:
    result = ForecastRepository(session).save_all([make_snapshot(location_id)])

    assert result == ForecastWriteResult(inserted=1, unchanged=0, revised=0)
    snapshot_row = session.scalars(select(ForecastSnapshotRow)).one()
    assert snapshot_row.revision == 0
    assert snapshot_row.model_run_id == "2026-08-03T00:00:00Z"

    values = {row.variable: row for row in session.scalars(select(ForecastValueRow)).all()}
    assert values["air_temperature"].value_number == 12.5
    assert values["air_temperature"].value_text is None
    assert values["symbol_code"].value_number is None
    assert values["symbol_code"].value_text == "clearsky_day"


def test_save_all_treats_same_latest_content_as_unchanged(
    session: Session,
    location_id: UUID,
) -> None:
    repository = ForecastRepository(session)
    original = make_snapshot(location_id)
    repository.save_all([original])
    repeated = original.model_copy(
        update={
            "id": uuid4(),
            "fetched_at_utc": original.fetched_at_utc + timedelta(hours=1),
            "quality_flags": list(reversed(original.quality_flags)),
            "values": list(reversed(original.values)),
        }
    )

    result = repository.save_all([repeated])

    assert result == ForecastWriteResult(inserted=0, unchanged=1, revised=0)
    assert len(session.scalars(select(ForecastSnapshotRow)).all()) == 1
    assert len(session.scalars(select(ForecastValueRow)).all()) == 2


def test_save_all_retries_a_stale_read_after_unique_race(
    session: Session,
    location_id: UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    winner = make_snapshot(location_id)
    ForecastRepository(session).save_all([winner])
    contender = winner.model_copy(update={"id": uuid4()})
    repository = ForecastRepository(session)
    actual_latest = repository._latest
    reads = 0

    def stale_once(snapshot: ForecastSnapshot) -> ForecastSnapshotRow | None:
        nonlocal reads
        reads += 1
        if reads == 1:
            return None
        return actual_latest(snapshot)

    monkeypatch.setattr(repository, "_latest", stale_once)

    result = repository.save_all([contender])

    assert result == ForecastWriteResult(inserted=0, unchanged=1, revised=0)
    assert reads == 2
    assert len(session.scalars(select(ForecastSnapshotRow)).all()) == 1


def test_save_all_appends_revision_and_preserves_old_values(
    session: Session,
    location_id: UUID,
) -> None:
    repository = ForecastRepository(session)
    original = make_snapshot(location_id, temperature=12.5)
    repository.save_all([original])
    changed = original.model_copy(
        update={
            "raw_payload_hash": "b" * 64,
            "values": [
                value.model_copy(update={"value": 13.75})
                if value.variable == "air_temperature"
                else value
                for value in original.values
            ],
        }
    )

    result = repository.save_all([changed])

    assert result == ForecastWriteResult(inserted=0, unchanged=0, revised=1)
    rows = session.scalars(select(ForecastSnapshotRow).order_by(ForecastSnapshotRow.revision)).all()
    assert [row.revision for row in rows] == [0, 1]
    temperatures = [
        session.scalars(
            select(ForecastValueRow).where(
                ForecastValueRow.snapshot_id == row.id,
                ForecastValueRow.variable == "air_temperature",
            )
        )
        .one()
        .value_number
        for row in rows
    ]
    assert temperatures == [12.5, 13.75]


def test_valid_to_is_part_of_logical_identity(
    session: Session,
    location_id: UUID,
) -> None:
    result = ForecastRepository(session).save_all(
        [
            make_snapshot(location_id, valid_to_hours=1),
            make_snapshot(location_id, valid_to_hours=6),
        ]
    )

    assert result == ForecastWriteResult(inserted=2, unchanged=0, revised=0)
    rows = session.scalars(
        select(ForecastSnapshotRow).order_by(ForecastSnapshotRow.valid_to_utc)
    ).all()
    assert [row.revision for row in rows] == [0, 0]
    assert [row.interval_seconds for row in rows] == [3600, 21600]


def test_save_all_rolls_back_whole_batch_on_error(
    session: Session,
    location_id: UUID,
) -> None:
    first = make_snapshot(location_id)
    duplicate_value = first.values[0].model_copy()
    invalid = first.model_copy(
        update={
            "id": uuid4(),
            "model_run_id": "2026-08-03T06:00:00Z",
            "values": [duplicate_value, duplicate_value.model_copy()],
        }
    )

    with pytest.raises(IntegrityError):
        ForecastRepository(session).save_all([first, invalid])

    assert session.scalars(select(ForecastSnapshotRow)).all() == []
    assert session.scalars(select(ForecastValueRow)).all() == []
