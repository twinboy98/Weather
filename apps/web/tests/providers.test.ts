import { describe, expect, it, vi } from "vitest";

import type { PlaceRef } from "../lib/domain";
import {
  fetchWeather,
  latitudeLongitudeToKmaGrid,
  normalizeAccuWeatherProxy,
  normalizeKmaWeather,
  normalizeMetNorwayCompact,
  normalizeWindyPointForecast,
  parseKmaPrecipitation,
  PROVIDER_INFO,
  selectKmaShortForecastBaseTime,
  selectKmaUltraShortBaseTime,
  WeatherProviderConfigurationError,
} from "../lib/providers";

const place: PlaceRef = {
  key: "home",
  name: "집",
  latitude: 37.5665,
  longitude: 126.978,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("provider registry", () => {
  it("lists the four selectable providers without an implicit fallback entry", () => {
    expect(PROVIDER_INFO.map((provider) => provider.id)).toEqual([
      "kma_forecast",
      "met_norway",
      "windy",
      "accuweather",
    ]);
  });

  it.each([
    ["kma_forecast", "기상청 API 서비스 키"],
    ["windy", "Windy Point Forecast API 키"],
    ["accuweather", "서버 측 프록시 URL"],
  ] as const)("reports missing %s configuration in Korean", async (providerId, message) => {
    const fetchImpl = vi.fn();
    await expect(
      fetchWeather(providerId, place, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      name: "WeatherProviderConfigurationError",
      message: expect.stringContaining(message),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not silently fall back when the selected direct provider fails", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ error: "upstream" }, 503),
    );
    await expect(
      fetchWeather("met_norway", place, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ providerId: "met_norway", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("api.met.no");
  });
});

describe("KMA adapter", () => {
  it("converts Seoul coordinates to the official forecast grid", () => {
    expect(latitudeLongitudeToKmaGrid(37.5665, 126.978)).toEqual({ nx: 60, ny: 127 });
  });

  it("selects publication-safe KST base times across midnight", () => {
    const requested = new Date("2026-08-03T17:05:00Z"); // 02:05 KST next day
    expect(selectKmaShortForecastBaseTime(requested)).toMatchObject({
      baseDate: "20260803",
      baseTime: "2300",
      usedFallback: true,
    });
    expect(selectKmaUltraShortBaseTime(requested)).toMatchObject({
      baseDate: "20260804",
      baseTime: "0100",
      usedFallback: true,
    });
  });

  it("normalizes textual precipitation ranges without treating them as zero", () => {
    expect(parseKmaPrecipitation("강수없음")).toBe(0);
    expect(parseKmaPrecipitation("1.0mm 미만")).toBe(0.5);
    expect(parseKmaPrecipitation("30.0~50.0mm")).toBe(40);
    expect(parseKmaPrecipitation("50.0mm 이상")).toBe(50);
  });

  it("normalizes observation and hourly forecast items", () => {
    const currentBase = selectKmaUltraShortBaseTime(
      new Date("2026-08-05T08:50:00Z"),
    );
    const forecastBase = selectKmaShortForecastBaseTime(
      new Date("2026-08-05T08:50:00Z"),
    );
    const currentPayload = kmaPayload([
      { category: "T1H", obsrValue: "28.5" },
      { category: "REH", obsrValue: "70" },
      { category: "WSD", obsrValue: "3.2" },
      { category: "RN1", obsrValue: "0" },
      { category: "PTY", obsrValue: "0" },
    ]);
    const forecastPayload = kmaPayload([
      forecastItem("TMP", "29"),
      forecastItem("REH", "75"),
      forecastItem("WSD", "4.1"),
      forecastItem("POP", "60"),
      forecastItem("PCP", "1.0mm 미만"),
      forecastItem("PTY", "1"),
    ]);

    const bundle = normalizeKmaWeather(
      currentPayload,
      forecastPayload,
      place,
      new Date("2026-08-05T08:50:00Z"),
      currentBase,
      forecastBase,
    );

    expect(bundle.current).toMatchObject({
      temperatureC: 28.5,
      precipitationAmountMm: 0,
    });
    expect(bundle.points[0]).toMatchObject({
      temperatureC: 29,
      precipitationAmountMm: 0.5,
      precipitationProbability: 0.6,
      conditionCode: "rain",
    });
  });

  it("uses the user's service key for exactly the KMA current and forecast calls", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getUltraSrtNcst")) {
        return jsonResponse(kmaPayload([{ category: "T1H", obsrValue: "27" }]));
      }
      return jsonResponse(kmaPayload([forecastItem("TMP", "28")]));
    });
    const bundle = await fetchWeather("kma_forecast", place, {
      config: { kmaServiceKey: "user-key" },
      now: new Date("2026-08-05T08:50:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(bundle.providerId).toBe("kma_forecast");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [input] of fetchImpl.mock.calls) {
      expect(new URL(String(input)).searchParams.get("serviceKey")).toBe("user-key");
    }
  });
});

describe("MET Norway adapter", () => {
  const payload = {
    properties: {
      meta: { updated_at: "2026-08-05T08:00:00Z" },
      timeseries: [
        {
          time: "2026-08-05T09:00:00Z",
          data: {
            instant: {
              details: {
                air_temperature: 27,
                relative_humidity: 71,
                wind_speed: 4,
              },
            },
            next_1_hours: {
              summary: { symbol_code: "rainshowers_day" },
              details: {
                precipitation_amount: 0.4,
                probability_of_precipitation: 35,
              },
            },
          },
        },
      ],
    },
  };

  it("keeps one-hour accumulation and probability semantics", () => {
    const bundle = normalizeMetNorwayCompact(
      payload,
      place,
      new Date("2026-08-05T09:00:00Z"),
    );
    expect(bundle.points[0]).toMatchObject({
      validAt: "2026-08-05T09:00:00.000Z",
      validTo: "2026-08-05T10:00:00.000Z",
      temperatureC: 27,
      precipitationAmountMm: 0.4,
      precipitationRateMmh: 0.4,
      precipitationProbability: 0.35,
    });
  });

  it("rounds direct request coordinates to four decimals", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(payload),
    );
    await fetchWeather(
      "met_norway",
      { ...place, latitude: 37.5665123, longitude: 126.9780432 },
      {
        now: new Date("2026-08-05T09:00:00Z"),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("lat")).toBe("37.5665");
    expect(url.searchParams.get("lon")).toBe("126.9780");
  });
});

describe("Windy adapter", () => {
  const payload = {
    ts: [Date.parse("2026-08-05T09:00:00Z")],
    units: {
      "temp-surface": "K",
      "rh-surface": "%",
      "wind_u-surface": "m*s-1",
      "wind_v-surface": "m*s-1",
      "gust-surface": "m*s-1",
      "past3hprecip-surface": "m",
    },
    "temp-surface": [300],
    "rh-surface": [70],
    "wind_u-surface": [3],
    "wind_v-surface": [4],
    "gust-surface": [8],
    "past3hprecip-surface": [0.003],
    "ptype-surface": [1],
  };

  it("normalizes units and preserves the selected model", () => {
    const bundle = normalizeWindyPointForecast(
      payload,
      place,
      new Date("2026-08-05T09:00:00Z"),
      "icon",
      "professional",
    );
    expect(bundle.isDemo).toBe(false);
    expect(bundle.attribution).toContain("ICON");
    expect(bundle.points[0]).toMatchObject({
      temperatureC: 26.850000000000023,
      windSpeedMs: 5,
      precipitationAmountMm: 3,
      precipitationRateMmh: 1,
      conditionCode: "rain",
    });
  });

  it("posts only the requested gfs/icon model and key", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(payload),
    );
    await fetchWeather("windy", place, {
      config: {
        windyApiKey: "windy-user-key",
        windyModel: "icon",
        windyApiMode: "professional",
      },
      now: new Date("2026-08-05T09:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "icon",
      key: "windy-user-key",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("AccuWeather proxy adapter", () => {
  const payload = {
    current: [
      {
        LocalObservationDateTime: "2026-08-05T18:00:00+09:00",
        WeatherText: "약한 비",
        Temperature: { Metric: { Value: 27, Unit: "C" } },
        RealFeelTemperature: { Metric: { Value: 29, Unit: "C" } },
        RelativeHumidity: 80,
        Wind: { Speed: { Metric: { Value: 36, Unit: "km/h" } } },
      },
    ],
    hourly: [
      {
        DateTime: "2026-08-05T19:00:00+09:00",
        IconPhrase: "소나기",
        Temperature: { Value: 26, Unit: "C" },
        PrecipitationProbability: 75,
        Rain: { Value: 2, Unit: "mm" },
      },
    ],
  };

  it("normalizes current and hourly proxy responses", () => {
    const bundle = normalizeAccuWeatherProxy(
      payload,
      place,
      new Date("2026-08-05T09:00:00Z"),
    );
    expect(bundle.current).toMatchObject({
      validAt: "2026-08-05T09:00:00.000Z",
      temperatureC: 27,
      windSpeedMs: 10,
    });
    expect(bundle.points[0]).toMatchObject({
      precipitationAmountMm: 2,
      precipitationProbability: 0.75,
    });
  });

  it("calls only the configured proxy and never sends an AccuWeather key", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(payload),
    );
    await fetchWeather("accuweather", place, {
      config: { accuweatherProxyUrl: "https://proxy.example/weather/accu" },
      now: new Date("2026-08-05T09:00:00Z"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [input, init] = fetchImpl.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.hostname).toBe("proxy.example");
    expect(url.searchParams.get("lat")).toBe(String(place.latitude));
    expect(init?.headers).toBeUndefined();
  });

  it("rejects the official AccuWeather API as a browser proxy URL", async () => {
    await expect(
      fetchWeather("accuweather", place, {
        config: { accuweatherProxyUrl: "https://dataservice.accuweather.com/currentconditions/v1/1" },
      }),
    ).rejects.toBeInstanceOf(WeatherProviderConfigurationError);
  });
});

function kmaPayload(items: Array<Record<string, unknown>>): unknown {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: { items: { item: items } },
    },
  };
}

function forecastItem(category: string, fcstValue: string): Record<string, string> {
  return {
    category,
    fcstValue,
    fcstDate: "20260805",
    fcstTime: "1900",
  };
}

