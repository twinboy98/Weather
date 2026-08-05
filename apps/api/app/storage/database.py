from __future__ import annotations

from collections.abc import Generator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.settings import get_settings
from app.domain.models import (
    ForecastSnapshot,
    ForecastValue,
    Location,
    LocationCreate,
    LocationUpdate,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class LocationRow(Base):
    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Seoul")
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_public_benchmark_location: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ForecastSnapshotRow(Base):
    __tablename__ = "forecast_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "provider_id",
            "provider_variant",
            "model_run_id",
            "location_id",
            "issued_at_utc",
            "valid_from_utc",
            "valid_to_utc",
            "revision",
            name="uq_forecast_snapshot_revision",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider_id: Mapped[str] = mapped_column(String(64), index=True)
    provider_variant: Mapped[str] = mapped_column(String(64), default="default")
    model_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model_run_id: Mapped[str] = mapped_column(String(100), nullable=False)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), index=True)
    issued_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_from_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    valid_to_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    interval_seconds: Mapped[int] = mapped_column(Integer)
    lead_time_seconds: Mapped[int] = mapped_column(Integer)
    horizon_bucket: Mapped[str] = mapped_column(String(64))
    issue_time_quality: Mapped[str] = mapped_column(String(32))
    raw_payload_hash: Mapped[str] = mapped_column(String(64))
    provider_policy_version: Mapped[str] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    quality_flags: Mapped[list[str]] = mapped_column(JSON, default=list)


class ForecastValueRow(Base):
    __tablename__ = "forecast_values"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "variable", name="uq_forecast_value_variable"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("forecast_snapshots.id"), index=True)
    variable: Mapped[str] = mapped_column(String(80))
    value_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(32))
    aggregation: Mapped[str] = mapped_column(String(32))
    probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    lower_bound: Mapped[float | None] = mapped_column(Float, nullable=True)
    upper_bound: Mapped[float | None] = mapped_column(Float, nullable=True)


class ObservationRow(Base):
    __tablename__ = "observations"
    __table_args__ = (
        UniqueConstraint(
            "source", "station_id", "observed_at_utc", "variable", name="uq_observation"
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), index=True)
    source: Mapped[str] = mapped_column(String(64))
    station_id: Mapped[str] = mapped_column(String(64))
    station_name: Mapped[str] = mapped_column(String(100))
    station_latitude: Mapped[float] = mapped_column(Float)
    station_longitude: Mapped[float] = mapped_column(Float)
    station_elevation_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    station_distance_km: Mapped[float] = mapped_column(Float)
    observed_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    interval_seconds: Mapped[int] = mapped_column(Integer)
    variable: Mapped[str] = mapped_column(String(80))
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(32))
    quality_flags: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_interpolated: Mapped[bool] = mapped_column(Boolean, default=False)
    interpolation_method: Mapped[str | None] = mapped_column(String(64), nullable=True)


class NowcastPointRow(Base):
    __tablename__ = "nowcast_points"
    __table_args__ = (
        UniqueConstraint(
            "provider_id",
            "provider_variant",
            "location_id",
            "issued_at_utc",
            "valid_at_utc",
            name="uq_nowcast_point",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider_id: Mapped[str] = mapped_column(String(64))
    provider_variant: Mapped[str] = mapped_column(String(64))
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id"), index=True)
    issued_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_at_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    lead_minutes: Mapped[int] = mapped_column(Integer)
    precipitation_rate_mmh: Mapped[float] = mapped_column(Float)
    precipitation_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    precipitation_type: Mapped[str] = mapped_column(String(32))
    source_resolution_minutes: Mapped[int] = mapped_column(Integer)
    source_age_minutes: Mapped[int] = mapped_column(Integer)
    georeferencing_quality: Mapped[str] = mapped_column(String(32))
    quality_flags: Mapped[list[str]] = mapped_column(JSON, default=list)


class ProviderRequestLogRow(Base):
    __tablename__ = "provider_request_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(64), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    request_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    elapsed_ms: Mapped[int] = mapped_column(Integer)
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    rate_limit_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    response_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


def create_session_factory(database_url: str | None = None) -> sessionmaker[Session]:
    url = database_url or get_settings().database_url
    connect_args: dict[str, Any] = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)

    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(
            dbapi_connection: Any,
            _: Any,
        ) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return sessionmaker(bind=engine, expire_on_commit=False)


SessionLocal = create_session_factory()


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
ALEMBIC_CONFIG_PATH = REPOSITORY_ROOT / "apps" / "api" / "alembic.ini"
ALEMBIC_SCRIPT_PATH = REPOSITORY_ROOT / "apps" / "api" / "alembic"


def upgrade_database(database_url: str | None = None) -> None:
    """Upgrade the configured database to the current Alembic revision."""
    url = database_url or get_settings().database_url
    alembic_config = Config(str(ALEMBIC_CONFIG_PATH))
    alembic_config.set_main_option("script_location", str(ALEMBIC_SCRIPT_PATH))
    alembic_config.attributes["database_url"] = url
    command.upgrade(alembic_config, "head")


def initialize_database() -> None:
    upgrade_database()
    if get_settings().demo_mode:
        with SessionLocal() as session:
            seed_demo_locations(session)


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


DEMO_LOCATIONS = [
    LocationCreate(
        name="서울",
        latitude=37.5665,
        longitude=126.9780,
        elevation_m=38,
        address="서울특별시 중구",
        is_favorite=True,
        is_public_benchmark_location=True,
        display_order=0,
    ),
    LocationCreate(
        name="인천",
        latitude=37.4563,
        longitude=126.7052,
        elevation_m=69,
        address="인천광역시 남동구",
        is_public_benchmark_location=True,
        display_order=1,
    ),
    LocationCreate(
        name="부산",
        latitude=35.1796,
        longitude=129.0756,
        elevation_m=15,
        address="부산광역시 부산진구",
        is_public_benchmark_location=True,
        display_order=2,
    ),
]


def seed_demo_locations(session: Session) -> None:
    if session.scalar(select(LocationRow.id).limit(1)) is not None:
        return
    for index, item in enumerate(DEMO_LOCATIONS):
        data = item.model_dump()
        data["display_order"] = index
        session.add(LocationRow(id=str(uuid4()), **data))
    session.commit()


def location_from_row(row: LocationRow) -> Location:
    return Location.model_validate(row)


class LocationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self) -> list[Location]:
        rows = self.session.scalars(
            select(LocationRow).order_by(LocationRow.display_order, LocationRow.created_at)
        ).all()
        return [location_from_row(row) for row in rows]

    def get(self, location_id: str) -> Location | None:
        row = self.session.get(LocationRow, location_id)
        return location_from_row(row) if row else None

    def create(self, payload: LocationCreate) -> Location:
        row = LocationRow(id=str(uuid4()), **payload.model_dump())
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)
        return location_from_row(row)

    def update(self, location_id: str, payload: LocationUpdate) -> Location | None:
        row = self.session.get(LocationRow, location_id)
        if row is None:
            return None
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
        row.updated_at = utc_now()
        self.session.commit()
        self.session.refresh(row)
        return location_from_row(row)

    def delete(self, location_id: str) -> bool:
        row = self.session.get(LocationRow, location_id)
        if row is None:
            return False
        self.session.delete(row)
        self.session.commit()
        return True


@dataclass(frozen=True, slots=True)
class ForecastWriteResult:
    inserted: int = 0
    unchanged: int = 0
    revised: int = 0


def _forecast_value_signature(value: ForecastValue) -> tuple[object, ...]:
    value_number = None if isinstance(value.value, str) else float(value.value)
    value_text = value.value if isinstance(value.value, str) else None
    return (
        value.variable,
        value_number,
        value_text,
        value.unit,
        value.aggregation,
        value.probability,
        value.lower_bound,
        value.upper_bound,
    )


def _forecast_value_row_signature(value: ForecastValueRow) -> tuple[object, ...]:
    return (
        value.variable,
        value.value_number,
        value.value_text,
        value.unit,
        value.aggregation,
        value.probability,
        value.lower_bound,
        value.upper_bound,
    )


def _ordered_value_signatures(values: Sequence[ForecastValue]) -> tuple[tuple[object, ...], ...]:
    signatures = [_forecast_value_signature(value) for value in values]
    return tuple(sorted(signatures, key=lambda value: str(value[0])))


class ForecastRepository:
    """Persist immutable forecast revisions and their normalized values."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def save_all(self, snapshots: Sequence[ForecastSnapshot]) -> ForecastWriteResult:
        if not snapshots:
            return ForecastWriteResult()

        # A row lock cannot protect a logical identity that has no row yet. If
        # two writers choose the same revision, let the unique constraint pick
        # the winner, then roll back and re-read the committed winner.
        max_attempts = 3
        for attempt in range(max_attempts):
            inserted = 0
            unchanged = 0
            revised = 0
            try:
                for snapshot in snapshots:
                    latest = self._latest(snapshot)
                    if latest is None:
                        self._insert(snapshot, revision=0)
                        inserted += 1
                    elif self._has_same_content(latest, snapshot):
                        unchanged += 1
                    else:
                        self._insert(snapshot, revision=latest.revision + 1)
                        revised += 1
                self.session.commit()
            except IntegrityError:
                self.session.rollback()
                if attempt == max_attempts - 1:
                    raise
                continue
            except Exception:
                self.session.rollback()
                raise

            return ForecastWriteResult(
                inserted=inserted,
                unchanged=unchanged,
                revised=revised,
            )

        raise AssertionError("unreachable")

    def _latest(self, snapshot: ForecastSnapshot) -> ForecastSnapshotRow | None:
        statement = (
            select(ForecastSnapshotRow)
            .where(
                ForecastSnapshotRow.provider_id == snapshot.provider_id,
                ForecastSnapshotRow.provider_variant == snapshot.provider_variant,
                ForecastSnapshotRow.model_run_id == snapshot.model_run_id,
                ForecastSnapshotRow.location_id == str(snapshot.location_id),
                ForecastSnapshotRow.issued_at_utc == snapshot.issued_at_utc,
                ForecastSnapshotRow.valid_from_utc == snapshot.valid_from_utc,
                ForecastSnapshotRow.valid_to_utc == snapshot.valid_to_utc,
            )
            .order_by(ForecastSnapshotRow.revision.desc())
            .limit(1)
            .with_for_update()
        )
        return self.session.scalars(statement).first()

    def _has_same_content(
        self,
        latest: ForecastSnapshotRow,
        snapshot: ForecastSnapshot,
    ) -> bool:
        value_rows = self.session.scalars(
            select(ForecastValueRow)
            .where(ForecastValueRow.snapshot_id == latest.id)
            .order_by(ForecastValueRow.variable, ForecastValueRow.id)
        ).all()
        stored_values = tuple(_forecast_value_row_signature(value) for value in value_rows)
        return (
            latest.raw_payload_hash == snapshot.raw_payload_hash
            and latest.model_name == snapshot.model_name
            and latest.interval_seconds == snapshot.interval_seconds
            and latest.lead_time_seconds == snapshot.lead_time_seconds
            and latest.horizon_bucket == snapshot.horizon_bucket.value
            and latest.issue_time_quality == snapshot.issue_time_quality.value
            and latest.provider_policy_version == snapshot.provider_policy_version
            and tuple(sorted(latest.quality_flags)) == tuple(sorted(snapshot.quality_flags))
            and stored_values == _ordered_value_signatures(snapshot.values)
        )

    def _insert(self, snapshot: ForecastSnapshot, revision: int) -> None:
        requested_id = str(snapshot.id)
        row_id = (
            requested_id
            if self.session.get(ForecastSnapshotRow, requested_id) is None
            else str(uuid4())
        )
        row = ForecastSnapshotRow(
            id=row_id,
            provider_id=snapshot.provider_id,
            provider_variant=snapshot.provider_variant,
            model_name=snapshot.model_name,
            model_run_id=snapshot.model_run_id,
            location_id=str(snapshot.location_id),
            issued_at_utc=snapshot.issued_at_utc,
            fetched_at_utc=snapshot.fetched_at_utc,
            valid_from_utc=snapshot.valid_from_utc,
            valid_to_utc=snapshot.valid_to_utc,
            interval_seconds=snapshot.interval_seconds,
            lead_time_seconds=snapshot.lead_time_seconds,
            horizon_bucket=snapshot.horizon_bucket.value,
            issue_time_quality=snapshot.issue_time_quality.value,
            raw_payload_hash=snapshot.raw_payload_hash,
            provider_policy_version=snapshot.provider_policy_version,
            revision=revision,
            quality_flags=list(snapshot.quality_flags),
        )
        self.session.add(row)
        for value in snapshot.values:
            value_number = None if isinstance(value.value, str) else float(value.value)
            value_text = value.value if isinstance(value.value, str) else None
            self.session.add(
                ForecastValueRow(
                    snapshot_id=row_id,
                    variable=value.variable,
                    value_number=value_number,
                    value_text=value_text,
                    unit=value.unit,
                    aggregation=value.aggregation,
                    probability=value.probability,
                    lower_bound=value.lower_bound,
                    upper_bound=value.upper_bound,
                )
            )
        self.session.flush()
