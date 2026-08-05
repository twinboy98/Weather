# Local weather data

Raw upstream weather payloads are not committed. Only provider-policy-approved normalized exports may be generated under this directory. Private locations and exact current coordinates are always excluded from Git exports.

`fixtures/met_norway_compact.json` is a small synthetic, sanitized test payload rather than a captured upstream response. It exists solely to reproduce the policy-gated normalization and append-only ingestion path without a network call.
