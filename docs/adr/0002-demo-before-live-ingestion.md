# ADR 0002: Demo before live ingestion

Status: accepted

The full UI and algorithms run on fixtures without keys. Live data cannot silently substitute for fixtures until provider-specific parsing, policy, caching, and failure tests pass. This keeps local onboarding deterministic and ensures an API key is never treated as a license grant.

