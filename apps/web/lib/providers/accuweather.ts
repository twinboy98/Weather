import type { ForecastPoint, PlaceRef, WeatherBundle } from "../domain";
import {
  asRecord,
  clampProbability,
  fetchJson,
  finiteNumber,
  getNow,
  isoDate,
  makeBundle,
  nonBlankString,
  requireNonBlank,
  WeatherProviderConfigurationError,
  WeatherProviderError,
} from "./common";
import type { FetchWeatherOptions } from "./types";

const ATTRIBUTION = "Weather data provided by AccuWeather";

/**
 * Proxy response contract:
 * {
 *   current: AccuWeatherCurrentCondition | AccuWeatherCurrentCondition[],
 *   hourly: AccuWeatherHourlyForecast[]
 * }
 *
 * The proxy owns the API key and makes the Locations/current/hourly upstream
 * calls. No AccuWeather credential is accepted by this browser adapter.
 */
export async function fetchAccuWeather(
  place: PlaceRef,
  options?: FetchWeatherOptions,
): Promise<WeatherBundle> {
  const proxyUrl = requireNonBlank(
    options?.config?.accuweatherProxyUrl,
    "accuweather",
    "AccuWeather는 API 키를 브라우저에 노출할 수 없습니다. 서버 측 프록시 URL을 설정해 주세요.",
  );
  rejectDirectAccuWeatherUrl(proxyUrl);
  const fetchedAt = getNow(options);
  const url = appendProxyParameters(proxyUrl, place);
  const payload = await fetchJson(
    "accuweather",
    url,
    { method: "GET", signal: options?.signal },
    options,
  );
  return normalizeAccuWeatherProxy(payload, place, fetchedAt);
}

export function normalizeAccuWeatherProxy(
  payload: unknown,
  place: PlaceRef,
  fetchedAt: Date,
): WeatherBundle {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    throw new WeatherProviderError("accuweather", "AccuWeather 프록시 응답이 비어 있습니다.");
  }

  const rawCurrent = data.current ?? data.currentConditions;
  const currentEntry = Array.isArray(rawCurrent) ? rawCurrent[0] : rawCurrent;
  const current = normalizeAccuCurrent(currentEntry);
  const rawHourly = data.hourly ?? data.hourlyForecasts;
  const points = Array.isArray(rawHourly)
    ? rawHourly
        .map(normalizeAccuHourly)
        .filter((point): point is ForecastPoint => Boolean(point))
    : [];

  const issuedAt = current?.validAt;
  return makeBundle({
    providerId: "accuweather",
    place,
    fetchedAt,
    issuedAt,
    current,
    points,
    attribution: ATTRIBUTION,
    warnings: [
      "AccuWeather 자료는 선택된 공급자 화면과 계산에서만 사용하며 다른 날씨 공급자 자료와 합성하지 않습니다.",
    ],
  });
}

function normalizeAccuCurrent(value: unknown): ForecastPoint | undefined {
  const item = asRecord(value);
  if (!item) return undefined;
  const validAt =
    isoDate(item.LocalObservationDateTime) ?? epochSecondsToIso(item.EpochTime);
  if (!validAt) return undefined;
  return {
    validAt,
    temperatureC: metricMeasurement(item.Temperature),
    apparentTemperatureC:
      metricMeasurement(item.RealFeelTemperature) ?? metricMeasurement(item.ApparentTemperature),
    relativeHumidityPercent: finiteNumber(item.RelativeHumidity),
    windSpeedMs: speedMeasurement(asRecord(item.Wind)?.Speed),
    windGustMs: speedMeasurement(asRecord(item.WindGust)?.Speed),
    precipitationAmountMm:
      metricMeasurement(item.Precip1hr) ?? metricMeasurement(item.PrecipitationSummary),
    precipitationRateMmh:
      metricMeasurement(item.Precip1hr) ?? metricMeasurement(item.PrecipitationSummary),
    conditionCode:
      nonBlankString(item.WeatherText) ?? numberCode("accuweather", item.WeatherIcon),
    resolutionMinutes: 60,
  };
}

function normalizeAccuHourly(value: unknown): ForecastPoint | undefined {
  const item = asRecord(value);
  if (!item) return undefined;
  const validAt = isoDate(item.DateTime) ?? epochSecondsToIso(item.EpochDateTime);
  if (!validAt) return undefined;
  const precipitationAmountMm =
    metricMeasurement(item.Rain) ??
    metricMeasurement(item.TotalLiquid) ??
    metricMeasurement(item.Ice) ??
    metricMeasurement(item.Snow);
  return {
    validAt,
    validTo: new Date(Date.parse(validAt) + 60 * 60 * 1_000).toISOString(),
    temperatureC: metricMeasurement(item.Temperature),
    apparentTemperatureC: metricMeasurement(item.RealFeelTemperature),
    relativeHumidityPercent: finiteNumber(item.RelativeHumidity),
    windSpeedMs: speedMeasurement(asRecord(item.Wind)?.Speed),
    windGustMs: speedMeasurement(asRecord(item.WindGust)?.Speed),
    precipitationAmountMm,
    precipitationRateMmh: precipitationAmountMm,
    precipitationProbability: clampProbability(item.PrecipitationProbability),
    conditionCode:
      nonBlankString(item.IconPhrase) ?? numberCode("accuweather", item.WeatherIcon),
    resolutionMinutes: 60,
  };
}

function metricMeasurement(value: unknown): number | undefined {
  const measurement = asRecord(value);
  if (!measurement) return finiteNumber(value);
  const metric = asRecord(measurement.Metric);
  const target = metric ?? measurement;
  const numeric = finiteNumber(target.Value);
  if (numeric === undefined) return undefined;
  const unit = String(target.Unit ?? "").toLowerCase();
  if (unit === "f") return ((numeric - 32) * 5) / 9;
  if (unit === "cm") return numeric * 10;
  return numeric;
}

function speedMeasurement(value: unknown): number | undefined {
  const measurement = asRecord(value);
  if (!measurement) return finiteNumber(value);
  const metric = asRecord(measurement.Metric);
  const target = metric ?? measurement;
  const numeric = finiteNumber(target.Value);
  if (numeric === undefined) return undefined;
  const unit = String(target.Unit ?? "").toLowerCase();
  if (unit === "km/h" || unit === "kmh") return numeric / 3.6;
  if (unit === "mph") return numeric * 0.44704;
  return numeric;
}

function epochSecondsToIso(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function numberCode(prefix: string, value: unknown): string | undefined {
  const numeric = finiteNumber(value);
  return numeric === undefined ? undefined : `${prefix}-${numeric}`;
}

function rejectDirectAccuWeatherUrl(value: string): void {
  try {
    const parsed = new URL(value, "https://weather-proxy.invalid");
    if (parsed.hostname.toLowerCase() === "dataservice.accuweather.com") {
      throw new WeatherProviderConfigurationError(
        "accuweather",
        "AccuWeather 공식 API 주소를 브라우저에서 직접 사용할 수 없습니다. API 키를 보관하는 서버 측 프록시를 설정해 주세요.",
      );
    }
  } catch (error) {
    if (error instanceof WeatherProviderConfigurationError) throw error;
    throw new WeatherProviderConfigurationError(
      "accuweather",
      "AccuWeather 프록시 URL 형식이 올바르지 않습니다.",
    );
  }
}

function appendProxyParameters(proxyUrl: string, place: PlaceRef): string {
  const isRelative = proxyUrl.startsWith("/");
  const url = new URL(proxyUrl, "https://weather-proxy.invalid");
  url.searchParams.set("lat", String(place.latitude));
  url.searchParams.set("lon", String(place.longitude));
  url.searchParams.set("language", "ko-kr");
  url.searchParams.set("hours", "24");
  return isRelative ? `${url.pathname}${url.search}` : url.toString();
}

