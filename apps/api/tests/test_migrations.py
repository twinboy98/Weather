from __future__ import annotations

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.storage.database import Base, ForecastSnapshotRow, LocationRow, upgrade_database
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine.interfaces import ReflectedColumn
from sqlalchemy.engine.reflection import Inspector

ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_CONFIG = ROOT / "apps" / "api" / "alembic.ini"
LEGACY_IDENTITY = [
    "provider_id",
    "provider_variant",
    "model_run_id",
    "location_id",
    "issued_at_utc",
    "valid_from_utc",
    "revision",
]
CURRENT_IDENTITY = [
    "provider_id",
    "provider_variant",
    "model_run_id",
    "location_id",
    "issued_at_utc",
    "valid_from_utc",
    "valid_to_utc",
    "revision",
]


def _database_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _run_alembic(
    path: Path,
    *arguments: str,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = _database_url(path)
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_CONFIG), *arguments],
        cwd=ROOT,
        env=environment,
        check=check,
        capture_output=True,
        text=True,
    )


def _model_run_column(database_inspector: Inspector) -> ReflectedColumn:
    columns = database_inspector.get_columns("forecast_snapshots")
    return next(column for column in columns if column["name"] == "model_run_id")


def _forecast_identity(database_inspector: Inspector) -> list[str] | None:
    constraints = database_inspector.get_unique_constraints("forecast_snapshots")
    for constraint in constraints:
        if constraint["name"] == "uq_forecast_snapshot_revision":
            return [str(column) for column in constraint["column_names"]]
    return None


def test_fresh_upgrade_matches_current_orm_metadata(tmp_path: Path) -> None:
    database_path = tmp_path / "fresh.db"

    _run_alembic(database_path, "upgrade", "head")

    engine = create_engine(_database_url(database_path))
    database_inspector = inspect(engine)
    assert _model_run_column(database_inspector)["nullable"] is False
    assert _forecast_identity(database_inspector) == CURRENT_IDENTITY
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        assert compare_metadata(context, Base.metadata) == []
    engine.dispose()


def test_programmatic_upgrade_uses_explicit_database_url(tmp_path: Path) -> None:
    database_path = tmp_path / "explicit.db"

    upgrade_database(_database_url(database_path))

    engine = create_engine(_database_url(database_path))
    try:
        with engine.connect() as connection:
            current_revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            assert current_revision == "0002_forecast_snapshot_identity"
    finally:
        engine.dispose()


def test_legacy_upgrade_rewrites_null_run_id_and_old_identity(tmp_path: Path) -> None:
    database_path = tmp_path / "legacy.db"
    _run_alembic(database_path, "upgrade", "0001_phase1_schema")

    engine = create_engine(_database_url(database_path))
    database_inspector = inspect(engine)
    assert _model_run_column(database_inspector)["nullable"] is True
    assert _forecast_identity(database_inspector) == LEGACY_IDENTITY

    location_id = "11111111-1111-1111-1111-111111111111"
    snapshot_id = "22222222-2222-2222-2222-222222222222"
    issued_at = datetime(2026, 8, 3, tzinfo=UTC)
    issued_at_text = issued_at.isoformat()
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO locations (
                    id, name, latitude, longitude, timezone, is_favorite,
                    is_public_benchmark_location, display_order, created_at, updated_at
                ) VALUES (
                    :id, :name, :latitude, :longitude, :timezone, :is_favorite,
                    :is_public, :display_order, :created_at, :updated_at
                )
                """
            ),
            {
                "id": location_id,
                "name": "legacy",
                "latitude": 37.5,
                "longitude": 127.0,
                "timezone": "Asia/Seoul",
                "is_favorite": False,
                "is_public": False,
                "display_order": 0,
                "created_at": issued_at_text,
                "updated_at": issued_at_text,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO forecast_snapshots (
                    id, provider_id, provider_variant, model_name, model_run_id,
                    location_id, issued_at_utc, fetched_at_utc, valid_from_utc,
                    valid_to_utc, interval_seconds, lead_time_seconds, horizon_bucket,
                    issue_time_quality, raw_payload_hash, provider_policy_version,
                    revision, quality_flags
                ) VALUES (
                    :id, :provider_id, :provider_variant, NULL, NULL,
                    :location_id, :issued_at, :fetched_at, :valid_from,
                    :valid_to, :interval_seconds, :lead_time_seconds, :horizon_bucket,
                    :issue_time_quality, :raw_payload_hash, :policy_version,
                    :revision, :quality_flags
                )
                """
            ),
            {
                "id": snapshot_id,
                "provider_id": "met_norway",
                "provider_variant": "compact",
                "location_id": location_id,
                "issued_at": issued_at_text,
                "fetched_at": issued_at_text,
                "valid_from": issued_at_text,
                "valid_to": (issued_at + timedelta(hours=1)).isoformat(),
                "interval_seconds": 3600,
                "lead_time_seconds": 0,
                "horizon_bucket": "radar_nowcast_0_2h",
                "issue_time_quality": "provided",
                "raw_payload_hash": "a" * 64,
                "policy_version": "legacy",
                "revision": 0,
                "quality_flags": "[]",
            },
        )
    engine.dispose()

    _run_alembic(database_path, "upgrade", "head")

    engine = create_engine(_database_url(database_path))
    database_inspector = inspect(engine)
    assert _model_run_column(database_inspector)["nullable"] is False
    assert _forecast_identity(database_inspector) == CURRENT_IDENTITY
    with engine.connect() as connection:
        run_id = connection.execute(
            text("SELECT model_run_id FROM forecast_snapshots WHERE id = :id"),
            {"id": snapshot_id},
        ).scalar_one()
    assert run_id == f"legacy:{snapshot_id}"
    engine.dispose()


def test_downgrade_reports_interval_identity_collisions_before_schema_change(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "downgrade-collision.db"
    _run_alembic(database_path, "upgrade", "head")
    engine = create_engine(_database_url(database_path))
    issued_at = datetime(2026, 8, 3, tzinfo=UTC)
    valid_from = issued_at + timedelta(hours=1)
    location_id = "11111111-1111-1111-1111-111111111111"
    common_snapshot = {
        "provider_id": "met_norway",
        "provider_variant": "compact",
        "model_name": "locationforecast",
        "model_run_id": "2026-08-03T00:00:00Z",
        "location_id": location_id,
        "issued_at_utc": issued_at,
        "fetched_at_utc": issued_at + timedelta(minutes=2),
        "valid_from_utc": valid_from,
        "lead_time_seconds": 3600,
        "horizon_bucket": "radar_nowcast_0_2h",
        "issue_time_quality": "provided",
        "raw_payload_hash": "a" * 64,
        "provider_policy_version": "test",
        "revision": 0,
        "quality_flags": [],
    }
    with engine.begin() as connection:
        connection.execute(
            LocationRow.__table__.insert().values(
                id=location_id,
                name="downgrade test",
                latitude=37.5,
                longitude=127.0,
            )
        )
        connection.execute(
            ForecastSnapshotRow.__table__.insert(),
            [
                {
                    **common_snapshot,
                    "id": "22222222-2222-2222-2222-222222222222",
                    "valid_to_utc": valid_from + timedelta(hours=1),
                    "interval_seconds": 3600,
                },
                {
                    **common_snapshot,
                    "id": "33333333-3333-3333-3333-333333333333",
                    "valid_to_utc": valid_from + timedelta(hours=6),
                    "interval_seconds": 21600,
                },
            ],
        )
    engine.dispose()

    result = _run_alembic(
        database_path,
        "downgrade",
        "0001_phase1_schema",
        check=False,
    )

    assert result.returncode != 0
    assert "legacy key excludes valid_to_utc" in f"{result.stdout}\n{result.stderr}"
    engine = create_engine(_database_url(database_path))
    try:
        assert _forecast_identity(inspect(engine)) == CURRENT_IDENTITY
        with engine.connect() as connection:
            assert connection.execute(
                text("SELECT count(*) FROM forecast_snapshots")
            ).scalar_one() == 2
            current_revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
            assert current_revision == "0002_forecast_snapshot_identity"
    finally:
        engine.dispose()
