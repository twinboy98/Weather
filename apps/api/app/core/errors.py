from typing import Any


class WeatherBenchError(Exception):
    """Base structured application error."""

    code = "weatherbench_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class PolicyViolation(WeatherBenchError):
    code = "provider_policy_violation"


class ProviderUnavailable(WeatherBenchError):
    code = "provider_unavailable"


class UpstreamResponseError(WeatherBenchError):
    code = "upstream_response_error"

