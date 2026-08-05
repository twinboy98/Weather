# Operations

Run API, worker, database, and web as separate services with Docker Compose. The worker owns ten-minute nowcast refreshes with jitter; the API does not call every upstream when a page opens. Admin ingestion, scoring, and export endpoints require `X-Admin-Token`.

Schema changes are applied with `alembic upgrade head`, never inferred from ORM `create_all`. Docker Compose runs the one-shot `migrate` service after PostgreSQL is healthy and starts API/worker only after migration succeeds. Local API and worker initialization also upgrade to `head`; the fixture ingestion CLI migrates the exact URL passed through `--database-url`. SQLite session factories enable foreign-key enforcement on every connection. Foreign keys without an explicit cascade retain the database's default `RESTRICT`/`NO ACTION` deletion behavior.

Provider parsing errors must transition that provider to degraded state and retain the last valid payload. Stale fallback data must surface source age and a stale flag. GitHub Actions are not a real-time scheduler.

Before enabling live MET Norway scheduling, validate the normalization and append-only database path with `scripts/ingest_forecasts.py --fixture data/fixtures/met_norway_compact.json`. Fixture mode is structurally offline, policy-gates normalized persistence, and commits a complete response atomically. Durable HTTP cache, provider request logging, and periodic worker wiring remain prerequisites for unattended live ingestion.
