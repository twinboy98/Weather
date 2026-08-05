"""Create the frozen Phase 1 weather domain schema."""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0001_phase1_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _utc_now() -> datetime:
    return datetime.now(UTC)


# This metadata deliberately describes the schema as it existed at revision 0001.
# In particular, model_run_id is nullable and valid_to_utc is not part of the
# forecast revision identity. Later ORM changes must not mutate this migration.
PHASE_1_METADATA = sa.MetaData()

locations = sa.Table(
    "locations",
    PHASE_1_METADATA,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("name", sa.String(100), nullable=False),
    sa.Column("latitude", sa.Float(), nullable=False),
    sa.Column("longitude", sa.Float(), nullable=False),
    sa.Column("elevation_m", sa.Float(), nullable=True),
    sa.Column("timezone", sa.String(64), nullable=False, default="Asia/Seoul"),
    sa.Column("address", sa.Text(), nullable=True),
    sa.Column("is_favorite", sa.Boolean(), nullable=False, default=False),
    sa.Column(
        "is_public_benchmark_location",
        sa.Boolean(),
        nullable=False,
        default=False,
    ),
    sa.Column("display_order", sa.Integer(), nullable=False, default=0),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, default=_utc_now),
    sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        default=_utc_now,
        onupdate=_utc_now,
    ),
)

forecast_snapshots = sa.Table(
    "forecast_snapshots",
    PHASE_1_METADATA,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("provider_id", sa.String(64), nullable=False, index=True),
    sa.Column("provider_variant", sa.String(64), nullable=False, default="default"),
    sa.Column("model_name", sa.String(100), nullable=True),
    sa.Column("model_run_id", sa.String(100), nullable=True),
    sa.Column(
        "location_id",
        sa.String(36),
        sa.ForeignKey("locations.id"),
        nullable=False,
        index=True,
    ),
    sa.Column("issued_at_utc", sa.DateTime(timezone=True), nullable=False, index=True),
    sa.Column("fetched_at_utc", sa.DateTime(timezone=True), nullable=False),
    sa.Column("valid_from_utc", sa.DateTime(timezone=True), nullable=False, index=True),
    sa.Column("valid_to_utc", sa.DateTime(timezone=True), nullable=False),
    sa.Column("interval_seconds", sa.Integer(), nullable=False),
    sa.Column("lead_time_seconds", sa.Integer(), nullable=False),
    sa.Column("horizon_bucket", sa.String(64), nullable=False),
    sa.Column("issue_time_quality", sa.String(32), nullable=False),
    sa.Column("raw_payload_hash", sa.String(64), nullable=False),
    sa.Column("provider_policy_version", sa.String(64), nullable=False),
    sa.Column("revision", sa.Integer(), nullable=False, default=0),
    sa.Column("quality_flags", sa.JSON(), nullable=False, default=list),
    sa.UniqueConstraint(
        "provider_id",
        "provider_variant",
        "model_run_id",
        "location_id",
        "issued_at_utc",
        "valid_from_utc",
        "revision",
        name="uq_forecast_snapshot_revision",
    ),
)

forecast_values = sa.Table(
    "forecast_values",
    PHASE_1_METADATA,
    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
    sa.Column(
        "snapshot_id",
        sa.String(36),
        sa.ForeignKey("forecast_snapshots.id"),
        nullable=False,
        index=True,
    ),
    sa.Column("variable", sa.String(80), nullable=False),
    sa.Column("value_number", sa.Float(), nullable=True),
    sa.Column("value_text", sa.Text(), nullable=True),
    sa.Column("unit", sa.String(32), nullable=False),
    sa.Column("aggregation", sa.String(32), nullable=False),
    sa.Column("probability", sa.Float(), nullable=True),
    sa.Column("lower_bound", sa.Float(), nullable=True),
    sa.Column("upper_bound", sa.Float(), nullable=True),
    sa.UniqueConstraint(
        "snapshot_id",
        "variable",
        name="uq_forecast_value_variable",
    ),
)

observations = sa.Table(
    "observations",
    PHASE_1_METADATA,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "location_id",
        sa.String(36),
        sa.ForeignKey("locations.id"),
        nullable=False,
        index=True,
    ),
    sa.Column("source", sa.String(64), nullable=False),
    sa.Column("station_id", sa.String(64), nullable=False),
    sa.Column("station_name", sa.String(100), nullable=False),
    sa.Column("station_latitude", sa.Float(), nullable=False),
    sa.Column("station_longitude", sa.Float(), nullable=False),
    sa.Column("station_elevation_m", sa.Float(), nullable=True),
    sa.Column("station_distance_km", sa.Float(), nullable=False),
    sa.Column("observed_at_utc", sa.DateTime(timezone=True), nullable=False, index=True),
    sa.Column("interval_seconds", sa.Integer(), nullable=False),
    sa.Column("variable", sa.String(80), nullable=False),
    sa.Column("value", sa.Float(), nullable=False),
    sa.Column("unit", sa.String(32), nullable=False),
    sa.Column("quality_flags", sa.JSON(), nullable=False, default=list),
    sa.Column("is_interpolated", sa.Boolean(), nullable=False, default=False),
    sa.Column("interpolation_method", sa.String(64), nullable=True),
    sa.UniqueConstraint(
        "source",
        "station_id",
        "observed_at_utc",
        "variable",
        name="uq_observation",
    ),
)

nowcast_points = sa.Table(
    "nowcast_points",
    PHASE_1_METADATA,
    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
    sa.Column("provider_id", sa.String(64), nullable=False),
    sa.Column("provider_variant", sa.String(64), nullable=False),
    sa.Column(
        "location_id",
        sa.String(36),
        sa.ForeignKey("locations.id"),
        nullable=False,
        index=True,
    ),
    sa.Column("issued_at_utc", sa.DateTime(timezone=True), nullable=False),
    sa.Column("valid_at_utc", sa.DateTime(timezone=True), nullable=False, index=True),
    sa.Column("lead_minutes", sa.Integer(), nullable=False),
    sa.Column("precipitation_rate_mmh", sa.Float(), nullable=False),
    sa.Column("precipitation_probability", sa.Float(), nullable=True),
    sa.Column("precipitation_type", sa.String(32), nullable=False),
    sa.Column("source_resolution_minutes", sa.Integer(), nullable=False),
    sa.Column("source_age_minutes", sa.Integer(), nullable=False),
    sa.Column("georeferencing_quality", sa.String(32), nullable=False),
    sa.Column("quality_flags", sa.JSON(), nullable=False, default=list),
    sa.UniqueConstraint(
        "provider_id",
        "provider_variant",
        "location_id",
        "issued_at_utc",
        "valid_at_utc",
        name="uq_nowcast_point",
    ),
)

provider_request_logs = sa.Table(
    "provider_request_logs",
    PHASE_1_METADATA,
    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
    sa.Column("provider", sa.String(64), nullable=False, index=True),
    sa.Column("endpoint", sa.Text(), nullable=False),
    sa.Column("request_started_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("response_status", sa.Integer(), nullable=True),
    sa.Column("elapsed_ms", sa.Integer(), nullable=False),
    sa.Column("cache_hit", sa.Boolean(), nullable=False, default=False),
    sa.Column("retry_count", sa.Integer(), nullable=False, default=0),
    sa.Column("rate_limit_remaining", sa.Integer(), nullable=True),
    sa.Column("error_category", sa.String(64), nullable=True),
    sa.Column("response_hash", sa.String(64), nullable=True),
)


def upgrade() -> None:
    PHASE_1_METADATA.create_all(bind=op.get_bind())


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    for table in reversed(PHASE_1_METADATA.sorted_tables):
        if inspector.has_table(table.name):
            table.drop(bind=bind)
