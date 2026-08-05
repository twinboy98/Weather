# ADR 0001: Policy-first provider boundary

Status: accepted

Every provider action is authorized before any HTTP request or data mutation. The policy uses explicit booleans for live fetch, display, raw/normalized persistence, GitHub export, and benchmarking. Missing policy or a false permission raises `PolicyViolation`. This prevents accidental leakage through a newly added adapter or export path.

