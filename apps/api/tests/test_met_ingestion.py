from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from app.core.errors import PolicyViolation, UpstreamResponseError
from app.core.policy import PolicyAction, PolicyGate
from app.domain.models import Location, LocationCreate
from app.providers.met_norway.ingestion import MetNorwayForecastIngestionService
from app.storage.database import (
    Base,
    ForecastSnapshotRow,
    LocationRepository,
    create_session_factory,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from scripts.ingest_forecasts import main as ingest_forecasts_main

ROOT = Path(__file__).resolve().parents[3]
FIXTURE_PATH = ROOT / "data" / "fixtures" / "met_norway_compact.json"
FETCHED_AT = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)


def _fixture_payload() -> dict[str, Any]:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


@pytest.fixture
def isolated_session(tmp_path: Path) -> tuple[Session, Location]:
    factory = create_session_factory(f"sqlite:///{(tmp_path / 'forecast.db').as_posix()}")
    Base.metadata.create_all(factory.kw["bind"])
    session = factory()
    try:
        location = LocationRepository(session).create(
            LocationCreate(
                name="정규화 테스트",
                latitude=37.5665,
                longitude=126.9780,
                is_public_benchmark_location=True,
            )
        )
        yield session, location
    finally:
        session.close()


def test_ingestion_is_idempotent_and_keeps_last_valid_data(
    isolated_session: tuple[Session, Location],
) -> None:
    session, location = isolated_session
    gate = PolicyGate.from_yaml(ROOT / "config" / "provider_policy.yaml")
    service = MetNorwayForecastIngestionService(gate, session)

    first = service.ingest_payload(
        _fixture_payload(), location=location, fetched_at_utc=FETCHED_AT
    )
    second = service.ingest_payload(
        _fixture_payload(), location=location, fetched_at_utc=FETCHED_AT
    )
    assert first.inserted == first.snapshots_normalized
    assert first.unchanged == 0
    assert second.inserted == 0
    assert second.unchanged == first.snapshots_normalized

    row_count_before_error = session.scalar(select(func.count(ForecastSnapshotRow.id)))
    malformed = copy.deepcopy(_fixture_payload())
    malformed["properties"]["timeseries"][0]["data"]["instant"]["details"][
        "air_temperature"
    ] = "not-a-number"
    with pytest.raises(UpstreamResponseError):
        service.ingest_payload(malformed, location=location, fetched_at_utc=FETCHED_AT)
    assert session.scalar(select(func.count(ForecastSnapshotRow.id))) == row_count_before_error


def test_persistence_policy_is_checked_before_any_write(
    isolated_session: tuple[Session, Location],
) -> None:
    session, location = isolated_session

    class DenyingGate:
        version = "deny-test"

        def require(self, provider_id: str, action: PolicyAction) -> None:
            assert provider_id == "met_norway"
            assert action is PolicyAction.NORMALIZED_PERSISTENCE
            raise PolicyViolation("blocked for test")

    service = MetNorwayForecastIngestionService(DenyingGate(), session)  # type: ignore[arg-type]
    with pytest.raises(PolicyViolation):
        service.ingest_payload(
            _fixture_payload(), location=location, fetched_at_utc=FETCHED_AT
        )
    assert session.scalar(select(func.count(ForecastSnapshotRow.id))) == 0


def test_ingestion_rejects_response_for_a_different_location(
    isolated_session: tuple[Session, Location],
) -> None:
    session, location = isolated_session
    gate = PolicyGate.from_yaml(ROOT / "config" / "provider_policy.yaml")
    payload = _fixture_payload()
    payload["geometry"]["coordinates"][:2] = [129.0756, 35.1796]

    with pytest.raises(UpstreamResponseError):
        MetNorwayForecastIngestionService(gate, session).ingest_payload(
            payload,
            location=location,
            fetched_at_utc=FETCHED_AT,
        )

    assert session.scalar(select(func.count(ForecastSnapshotRow.id))) == 0


def test_fixture_cli_never_constructs_a_network_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from app.providers.met_norway import client as client_module

    def fail_if_constructed(*_: object, **__: object) -> None:
        raise AssertionError("fixture ingestion must not construct MetNorwayClient")

    monkeypatch.setattr(client_module.MetNorwayClient, "__init__", fail_if_constructed)
    database_url = f"sqlite:///{(tmp_path / 'cli.db').as_posix()}"
    arguments = [
        "--fixture",
        str(FIXTURE_PATH),
        "--database-url",
        database_url,
        "--fetched-at",
        FETCHED_AT.isoformat(),
    ]

    assert ingest_forecasts_main(arguments) == 0
    first = json.loads(capsys.readouterr().out)
    assert first["inserted"] == first["snapshots_normalized"]

    assert ingest_forecasts_main(arguments) == 0
    second = json.loads(capsys.readouterr().out)
    assert second["inserted"] == 0
    assert second["unchanged"] == first["snapshots_normalized"]


def test_fixture_cli_checks_policy_before_fixture_or_database_io(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from scripts import ingest_forecasts as cli_module

    class DenyingPolicyGate:
        @classmethod
        def from_yaml(cls, _: Path) -> DenyingPolicyGate:
            return cls()

        def require(self, provider_id: str, action: PolicyAction) -> None:
            assert provider_id == "met_norway"
            assert action is PolicyAction.NORMALIZED_PERSISTENCE
            raise PolicyViolation("blocked before I/O")

    def unexpected_io(*_: object, **__: object) -> None:
        raise AssertionError("fixture and database I/O must happen after the policy check")

    monkeypatch.setattr(cli_module, "PolicyGate", DenyingPolicyGate)
    monkeypatch.setattr(cli_module, "_load_fixture", unexpected_io)
    monkeypatch.setattr(cli_module, "upgrade_database", unexpected_io)

    result = cli_module.main(
        [
            "--fixture",
            str(tmp_path / "must-not-be-opened.json"),
            "--database-url",
            f"sqlite:///{(tmp_path / 'must-not-be-opened.db').as_posix()}",
        ]
    )

    assert result == 2
    assert "blocked before I/O" in capsys.readouterr().err
