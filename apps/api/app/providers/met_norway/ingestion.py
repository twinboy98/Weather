from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.policy import PolicyAction, PolicyGate
from app.domain.models import Location
from app.providers.met_norway.client import MetNorwayClient
from app.providers.met_norway.normalizer import PROVIDER_ID, normalize_compact_forecast
from app.storage.database import ForecastRepository


@dataclass(frozen=True)
class MetNorwayIngestionResult:
    location_id: str
    snapshots_normalized: int
    inserted: int
    unchanged: int
    revised: int


class MetNorwayForecastIngestionService:
    """Policy-gated bridge from a compact response to append-only forecast rows."""

    def __init__(self, policy_gate: PolicyGate, session: Session) -> None:
        self.policy_gate = policy_gate
        self.repository = ForecastRepository(session)

    def ingest_payload(
        self,
        payload: dict[str, Any],
        *,
        location: Location,
        fetched_at_utc: datetime,
        deprecated: bool = False,
    ) -> MetNorwayIngestionResult:
        self.policy_gate.require(PROVIDER_ID, PolicyAction.NORMALIZED_PERSISTENCE)
        return self._normalize_and_persist(
            payload,
            location=location,
            fetched_at_utc=fetched_at_utc,
            deprecated=deprecated,
        )

    async def fetch_and_ingest(
        self,
        client: MetNorwayClient,
        *,
        location: Location,
        fetched_at_utc: datetime | None = None,
    ) -> MetNorwayIngestionResult:
        # Both permissions are checked before any upstream request. A provider that may be
        # displayed but not persisted must never be fetched through this ingestion path.
        self.policy_gate.require(PROVIDER_ID, PolicyAction.LIVE_FETCH)
        self.policy_gate.require(PROVIDER_ID, PolicyAction.NORMALIZED_PERSISTENCE)
        response = await client.fetch(location.latitude, location.longitude)
        return self._normalize_and_persist(
            response.payload,
            location=location,
            fetched_at_utc=fetched_at_utc or datetime.now(UTC),
            deprecated=response.deprecated,
        )

    def _normalize_and_persist(
        self,
        payload: dict[str, Any],
        *,
        location: Location,
        fetched_at_utc: datetime,
        deprecated: bool,
    ) -> MetNorwayIngestionResult:
        # Normalize the complete response before opening the repository write path. Any
        # malformed entry therefore leaves the last valid database state untouched.
        snapshots = normalize_compact_forecast(
            payload,
            location_id=location.id,
            fetched_at_utc=fetched_at_utc,
            policy_version=self.policy_gate.version,
            deprecated=deprecated,
            expected_latitude=location.latitude,
            expected_longitude=location.longitude,
        )
        write_result = self.repository.save_all(snapshots)
        return MetNorwayIngestionResult(
            location_id=str(location.id),
            snapshots_normalized=len(snapshots),
            inserted=write_result.inserted,
            unchanged=write_result.unchanged,
            revised=write_result.revised,
        )
