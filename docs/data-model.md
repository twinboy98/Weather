# Data model

`Location`, `ForecastSnapshot`, `ForecastValue`, `Observation`, `NowcastPoint`, and `ProviderRequestLog` are represented in the SQLAlchemy schema. Forecast snapshots are append-only by provider, variant, non-null model run, location, issue time, validity start/end, and revision. An identical latest source-response hash and normalized value set is an idempotent no-op; changed provenance or normalized content for the same logical identity receives the next revision without updating prior rows. The canonical hash covers the complete provider response and is copied to each derived snapshot, so one response-level change can intentionally revision multiple otherwise unchanged intervals. Forecast values remain separate so unit and aggregation metadata cannot be lost.

Weather timestamps have distinct meanings:

- `issued_at_utc`: provider/model publication or run time
- `fetched_at_utc`: time WeatherBench received the response
- `valid_from_utc`/`valid_to_utc`: forecast interval

Instant values use `valid_from_utc == valid_to_utc` and `interval_seconds = 0`. Accumulations use an exact positive interval matching their bounds, so MET Norway `next_1_hours` and `next_6_hours` values that begin together remain distinct snapshots. Wind persists both speed/direction and derived meteorological u/v components.
