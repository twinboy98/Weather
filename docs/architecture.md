# Architecture

Browser clients only call the FastAPI backend. Provider credentials never enter the Next.js bundle. The API serves cached normalized data, while a separate worker owns upstream refresh schedules. PostgreSQL is the operational store; SQLite supports local demo and tests; analytical exports are designed for DuckDB and Parquet.

The execution order for every provider operation is: resolve provider policy, require the exact action, perform the call or mutation, retain issue/fetch/valid time separately, then emit attribution and quality metadata. Unknown policy IDs fail closed.

Phase 1 keeps fixture data deterministic and local. `NowcastPoint` preserves source resolution and age. Rain events use hysteresis, and departure candidates integrate source-frame intervals without claiming finer forecast precision.

