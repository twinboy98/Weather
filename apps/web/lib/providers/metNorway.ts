import type { ForecastPoint, PlaceRef, WeatherBundle } from "../domain";
import {
  asRecord,
  clampProbability,
  fetchJson,
  finiteNumber,
  getNow,
  isoDate,
  makeBundle,
  nearestPoint,
  nonBlankString,
  sourceAgeMinutes,
  WeatherProviderError,
} from "./common";
import type { FetchWeatherOptions } from "./types";

export const MET_NORWAY_ENDPOINT =
  "https://api.met.no/weatherapi/locationforecast/2.0/compact";

const ATTRIBUTION = "Weather data from MET Norway · CC BY 4.0";

export async function fetchMetNorwayWeather(
  place: PlaceRef,
  options?: FetchWeatherOptions,
): Promise<WeatherBundle> {
  const fetchedAt = getNow(options);
  const url = new URL(MET_NORWAY_ENDPOINT);
  // MET Norway rejects overly precise coordinates and asks clients to round to
  // at most four decimals so responses remain cacheable.
  url.searchParams.set("lat", place.latitude.toFixed(4));
  url.searchParams.set("lon", place.longitude.toFixed(4));

  const payload = await fetchJson(
    "met_norway",
    url,
    { method: "GET", signal: options?.signal },
    options,
  );
  return normalizeMetNorwayCompact(payload, place, fetchedAt);
}

export function normalizeMetNorwayCompact(
  payload: unknown,
  place: PlaceRef,
  fetchedAt: Date,
): WeatherBundle {
  const root = asRecord(payload);
  const properties = asRecord(root?.properties);
  const meta = asRecord(properties?.meta);
  const issuedAt = isoDate(meta?.updated_at);
  const rawTimeseries = properties?.timeseries;

  if (!Array.isArray(rawTimeseries)) {
    throw new WeatherProviderError(
      "met_norway",
      "MET Norway 응답에 시간별 예보가 없습니다.",
    );
  }

  const age = sourceAgeMinutes(issuedAt, fetchedAt);
  const points: ForecastPoint[] = [];

  for (const rawEntry of rawTimeseries) {
    const entry = asRecord(rawEntry);
    const validAt = isoDate(entry?.time);
    const data = asRecord(entry?.data);
    const instant = asRecord(asRecord(data?.instant)?.details);
    if (!validAt || !instant) continue;

    const nextOneHour = asRecord(data?.next_1_hours);
    const nextSixHours = asRecord(data?.next_6_hours);
    const precipitationWindow = nextOneHour ?? nextSixHours;
    const precipitationDetails = asRecord(precipitationWindow?.details);
    const summary = asRecord(precipitationWindow?.summary);
    const intervalHours = nextOneHour ? 1 : nextSixHours ? 6 : undefined;
    const precipitationAmountMm = finiteNumber(
      precipitationDetails?.precipitation_amount,
    );
    const precipitationProbability = clampProbability(
      precipitationDetails?.probability_of_precipitation,
    );

    const point: ForecastPoint = {
      validAt,
      temperatureC: finiteNumber(instant.air_temperature),
      relativeHumidityPercent: finiteNumber(instant.relative_humidity),
      windSpeedMs: finiteNumber(instant.wind_speed),
      precipitationAmountMm,
      precipitationProbability,
      precipitationRateMmh:
        precipitationAmountMm !== undefined && intervalHours
          ? precipitationAmountMm / intervalHours
          : undefined,
      conditionCode: nonBlankString(summary?.symbol_code),
      sourceAgeMinutes: age,
      resolutionMinutes: intervalHours ? intervalHours * 60 : 60,
    };
    if (intervalHours) {
      point.validTo = new Date(
        Date.parse(validAt) + intervalHours * 3_600_000,
      ).toISOString();
    }
    points.push(point);
  }

  const current = nearestPoint(points, fetchedAt);
  return makeBundle({
    providerId: "met_norway",
    place,
    fetchedAt,
    issuedAt,
    current,
    points,
    attribution: ATTRIBUTION,
    warnings: [
      "MET Norway의 현재 값은 관측값이 아니라 현재 시각에 가장 가까운 모델 예측입니다.",
      "공개 운영 환경에서는 MET Norway 이용약관에 따라 캐싱 프록시 사용을 권장합니다.",
    ],
  });
}

