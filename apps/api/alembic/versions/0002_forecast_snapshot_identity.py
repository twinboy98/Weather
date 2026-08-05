"""Make forecast snapshot identities append-only across interval lengths."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "0002_forecast_snapshot_identity"
down_revision: str | None = "0001_phase1_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE_NAME = "forecast_snapshots"
CONSTRAINT_NAME = "uq_forecast_snapshot_revision"
LEGACY_IDENTITY_COLUMNS = (
    "provider_id",
    "provider_variant",
    "model_run_id",
    "location_id",
    "issued_at_utc",
    "valid_from_utc",
    "revision",
)
IDENTITY_COLUMNS = (
    "provider_id",
    "provider_variant",
    "model_run_id",
    "location_id",
    "issued_at_utc",
    "valid_from_utc",
    "valid_to_utc",
    "revision",
)
BATCH_NAMING_CONVENTION = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def _fill_missing_model_run_ids(bind: sa.engine.Connection) -> None:
    snapshots = sa.table(
        TABLE_NAME,
        sa.column("id", sa.String(36)),
        sa.column("model_run_id", sa.String(100)),
    )
    missing = sa.or_(
        snapshots.c.model_run_id.is_(None),
        sa.func.trim(snapshots.c.model_run_id) == "",
    )
    row_ids = bind.execute(
        sa.select(snapshots.c.id).where(missing).order_by(snapshots.c.id)
    ).scalars()
    for row_id in row_ids:
        bind.execute(
            snapshots.update()
            .where(snapshots.c.id == row_id)
            .values(model_run_id=f"legacy:{row_id}")
        )


def _effective_constraint_name(constraint: dict[str, object]) -> str:
    name = constraint.get("name")
    if isinstance(name, str):
        return name
    columns = constraint.get("column_names")
    if isinstance(columns, list) and columns:
        return f"uq_{TABLE_NAME}_{columns[0]}"
    raise RuntimeError("cannot identify unnamed forecast snapshot constraint")


def _assert_legacy_identity_compatible(bind: sa.engine.Connection) -> None:
    snapshots = sa.table(
        TABLE_NAME,
        *(sa.column(column_name) for column_name in IDENTITY_COLUMNS),
    )
    legacy_columns = [getattr(snapshots.c, column_name) for column_name in LEGACY_IDENTITY_COLUMNS]
    collision = (
        bind.execute(
            sa.select(
                *legacy_columns,
                sa.func.count().label("row_count"),
                sa.func.count(sa.distinct(snapshots.c.valid_to_utc)).label(
                    "valid_to_count"
                ),
            )
            .group_by(*legacy_columns)
            .having(sa.func.count() > 1)
            .limit(1)
        )
        .mappings()
        .first()
    )
    if collision is None:
        return

    identity = ", ".join(
        f"{column_name}={collision[column_name]!r}"
        for column_name in LEGACY_IDENTITY_COLUMNS
    )
    raise RuntimeError(
        "Cannot downgrade forecast_snapshots to the legacy identity: "
        f"{collision['row_count']} rows ({collision['valid_to_count']} distinct "
        "valid_to_utc values) would collide because the legacy key excludes "
        f"valid_to_utc. Merge or remove the colliding rows first. Example: {identity}"
    )


def _alter_schema(
    bind: sa.engine.Connection,
    *,
    drop_constraints: list[str],
    model_run_nullable: bool | None,
    create_columns: tuple[str, ...] | None,
) -> None:
    column = next(
        item for item in inspect(bind).get_columns(TABLE_NAME) if item["name"] == "model_run_id"
    )

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(
            TABLE_NAME,
            naming_convention=BATCH_NAMING_CONVENTION,
        ) as batch_op:
            for name in drop_constraints:
                batch_op.drop_constraint(name, type_="unique")
            if model_run_nullable is not None:
                batch_op.alter_column(
                    "model_run_id",
                    existing_type=column["type"],
                    nullable=model_run_nullable,
                )
            if create_columns is not None:
                batch_op.create_unique_constraint(CONSTRAINT_NAME, list(create_columns))
        return

    for name in drop_constraints:
        op.drop_constraint(name, TABLE_NAME, type_="unique")
    if model_run_nullable is not None:
        op.alter_column(
            TABLE_NAME,
            "model_run_id",
            existing_type=column["type"],
            nullable=model_run_nullable,
        )
    if create_columns is not None:
        op.create_unique_constraint(CONSTRAINT_NAME, TABLE_NAME, list(create_columns))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table(TABLE_NAME):
        return

    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    if "model_run_id" not in columns:
        return

    _fill_missing_model_run_ids(bind)

    constraints = inspector.get_unique_constraints(TABLE_NAME)
    desired_exists = any(
        tuple(constraint.get("column_names") or ()) == IDENTITY_COLUMNS
        for constraint in constraints
    )
    obsolete = [
        constraint
        for constraint in constraints
        if (
            tuple(constraint.get("column_names") or ()) == LEGACY_IDENTITY_COLUMNS
            or (
                constraint.get("name") == CONSTRAINT_NAME
                and tuple(constraint.get("column_names") or ()) != IDENTITY_COLUMNS
            )
        )
    ]
    drop_constraints = [_effective_constraint_name(item) for item in obsolete]
    make_not_null = bool(columns["model_run_id"].get("nullable", True))

    if not drop_constraints and not make_not_null and desired_exists:
        return

    _alter_schema(
        bind,
        drop_constraints=drop_constraints,
        model_run_nullable=False if make_not_null else None,
        create_columns=None if desired_exists else IDENTITY_COLUMNS,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table(TABLE_NAME):
        return

    columns = {column["name"]: column for column in inspector.get_columns(TABLE_NAME)}
    if "model_run_id" not in columns:
        return

    constraints = inspector.get_unique_constraints(TABLE_NAME)
    legacy_exists = any(
        tuple(constraint.get("column_names") or ()) == LEGACY_IDENTITY_COLUMNS
        for constraint in constraints
    )
    current = [
        constraint
        for constraint in constraints
        if tuple(constraint.get("column_names") or ()) == IDENTITY_COLUMNS
    ]
    drop_constraints = [_effective_constraint_name(item) for item in current]
    make_nullable = not bool(columns["model_run_id"].get("nullable", True))

    if not legacy_exists:
        _assert_legacy_identity_compatible(bind)

    if not drop_constraints and not make_nullable and legacy_exists:
        return

    _alter_schema(
        bind,
        drop_constraints=drop_constraints,
        model_run_nullable=True if make_nullable else None,
        create_columns=None if legacy_exists else LEGACY_IDENTITY_COLUMNS,
    )
