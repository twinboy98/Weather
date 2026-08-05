from datetime import UTC, datetime, timedelta

import httpx
import pytest
from app.core.errors import ProviderUnavailable, UpstreamResponseError
from app.providers.met_norway.client import MetNorwayClient, normalize_compact_timeseries


@pytest.mark.asyncio
async def test_met_uses_cache_headers_and_handles_304() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(
                200,
                json={"properties": {"timeseries": []}},
                headers={
                    "Expires": "Mon, 03 Aug 2026 10:00:00 GMT",
                    "Last-Modified": "Mon, 03 Aug 2026 09:00:00 GMT",
                    "Content-Type": "application/json",
                },
            )
        return httpx.Response(304, headers={"Expires": "Mon, 03 Aug 2026 11:00:00 GMT"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = MetNorwayClient("WeatherBenchKorea/0.1 contact@example.com", client=client)
    first = await adapter.fetch(37.5665123, 126.9780123)
    first.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    second = await adapter.fetch(37.5665123, 126.9780123)
    assert second.payload == first.payload
    assert requests[0].url.params["lat"] == "37.5665"
    assert requests[1].headers["If-Modified-Since"] == "Mon, 03 Aug 2026 09:00:00 GMT"
    await client.aclose()


@pytest.mark.asyncio
async def test_met_handles_429() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(429)))
    adapter = MetNorwayClient("WeatherBenchKorea/0.1 contact@example.com", client=client)
    with pytest.raises(ProviderUnavailable):
        await adapter.fetch(37.5, 127.0)
    await client.aclose()


@pytest.mark.asyncio
async def test_met_rejects_html_error_body() -> None:
    response = httpx.Response(
        200,
        text="<!doctype html><h1>error</h1>",
        headers={"Content-Type": "text/html"},
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response))
    adapter = MetNorwayClient("WeatherBenchKorea/0.1 contact@example.com", client=client)
    with pytest.raises(UpstreamResponseError):
        await adapter.fetch(37.5, 127.0)
    await client.aclose()


def test_met_keeps_precipitation_intervals_distinct() -> None:
    result = normalize_compact_timeseries(
        {
            "properties": {
                "timeseries": [
                    {
                        "time": "2026-08-03T00:00:00Z",
                        "data": {
                            "instant": {"details": {"air_temperature": 25}},
                            "next_1_hours": {"details": {"precipitation_amount": 1.2}},
                            "next_6_hours": {"details": {"precipitation_amount": 4.5}},
                        },
                    }
                ]
            }
        }
    )
    accumulations = result[0]["accumulations"]
    assert accumulations["next_1_hours"]["interval_seconds"] == 3600
    assert accumulations["next_6_hours"]["interval_seconds"] == 21600
