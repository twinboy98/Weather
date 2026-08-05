from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.core.errors import ProviderUnavailable, UpstreamResponseError


@dataclass
class CachedForecast:
    payload: dict[str, Any]
    expires_at: datetime | None
    last_modified: str | None
    deprecated: bool = False


class MetNorwayClient:
    endpoint = "https://api.met.no/weatherapi/locationforecast/2.0/compact"

    def __init__(self, user_agent: str, *, client: httpx.AsyncClient | None = None) -> None:
        if not user_agent.strip() or "WeatherBench" not in user_agent:
            raise ValueError("MET Norway requires an identifiable WeatherBench User-Agent")
        self.user_agent = user_agent
        self.client = client or httpx.AsyncClient(timeout=20, follow_redirects=True)
        self.cache: dict[tuple[float, float], CachedForecast] = {}

    @staticmethod
    def normalize_coordinates(latitude: float, longitude: float) -> tuple[float, float]:
        return round(latitude, 4), round(longitude, 4)

    async def fetch(self, latitude: float, longitude: float) -> CachedForecast:
        key = self.normalize_coordinates(latitude, longitude)
        cached = self.cache.get(key)
        now = datetime.now(UTC)
        if cached and cached.expires_at and now < cached.expires_at:
            return cached

        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
        }
        if cached and cached.last_modified:
            headers["If-Modified-Since"] = cached.last_modified

        response = await self.client.get(
            self.endpoint,
            params={"lat": f"{key[0]:.4f}", "lon": f"{key[1]:.4f}"},
            headers=headers,
        )
        if response.status_code == 304:
            if cached is None:
                raise UpstreamResponseError("MET Norway returned 304 without a cached payload")
            cached.expires_at = (
                _parse_http_date(response.headers.get("Expires")) or cached.expires_at
            )
            return cached
        if response.status_code == 429:
            raise ProviderUnavailable(
                "MET Norway 요청이 제한되었습니다.",
                details={"provider": "met_norway", "status": 429},
            )
        if response.status_code not in (200, 203):
            raise UpstreamResponseError(
                f"MET Norway returned HTTP {response.status_code}",
                details={"provider": "met_norway", "status": response.status_code},
            )
        content_type = response.headers.get("content-type", "").lower()
        if "html" in content_type or response.text.lstrip().lower().startswith("<!doctype html"):
            raise UpstreamResponseError("MET Norway returned HTML instead of forecast JSON")
        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamResponseError("MET Norway returned malformed JSON") from exc
        result = CachedForecast(
            payload=payload,
            expires_at=_parse_http_date(response.headers.get("Expires")),
            last_modified=response.headers.get("Last-Modified"),
            deprecated=response.status_code == 203,
        )
        self.cache[key] = result
        return result


def _parse_http_date(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = parsedate_to_datetime(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def normalize_compact_timeseries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep instant and accumulation windows distinct; never mix 1h and 6h precipitation."""

    result: list[dict[str, Any]] = []
    timeseries = payload.get("properties", {}).get("timeseries", [])
    for entry in timeseries:
        data = entry.get("data", {})
        normalized: dict[str, Any] = {
            "valid_at_utc": entry.get("time"),
            "instant": data.get("instant", {}).get("details", {}),
            "accumulations": {},
        }
        for key, seconds in (("next_1_hours", 3600), ("next_6_hours", 21600)):
            details = data.get(key, {}).get("details", {})
            if "precipitation_amount" in details:
                normalized["accumulations"][key] = {
                    "precipitation_amount_mm": details["precipitation_amount"],
                    "interval_seconds": seconds,
                }
        result.append(normalized)
    return result
