import type { ForecastPoint, PlaceRef, WeatherBundle } from "../domain";
import {
  asRecord,
  fetchJson,
  finiteNumber,
  getNow,
  makeBundle,
  nearestPoint,
  requireNonBlank,
  WeatherProviderConfigurationError,
  WeatherProviderError,
} from "./common";
import type { FetchWeatherOptions, WindyModel } from "./types";

export const WINDY_POINT_FORECAST_ENDPOINT =
  "https://api.windy.com/api/point-forecast/v2";

const ATTRIBUTION = "Contains data from the Windy database";
const SUPPORTED_MODELS: readonly WindyModel[] = ["gfs", "icon"];

export async function fetchWindyWeather(
  place: PlaceRef,
  options?: FetchWeatherOptions,
): Promise<WeatherBundle> {
  const apiKey = requireNonBlank(
    options?.config?.windyApiKey,
    "windy",
    "Windy Point Forecast API 키를 입력해 주세요.",
  );
  const model = options?.config?.windyModel ?? "gfs";
  if (!SUPPORTED_MODELS.includes(model)) {
    throw new WeatherProviderConfigurationError(
      "windy",
      "Windy 모델은 gfs 또는 icon만 선택할 수 있습니다.",
    );
  }
  const fetchedAt = getNow(options);
  const payload = await fetchJson(
    "windy",
    WINDY_POINT_FORECAST_ENDPOINT,
    {
      method: "POST",
      signal: options?.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: place.latitude,
        lon: place.longitude,
        model,
        parameters: ["temp", "rh", "wind", "windGust", "precip", "ptype"],
        levels: ["surface"],
        key: apiKey,
      }),
    },
    options,
  );

  return normalizeWindyPointForecast(
    payload,
    place,
    fetchedAt,
    model,
    options?.config?.windyApiMode ?? "testing",
  );
}

export function normalizeWindyPointForecast(
  payload: unknown,
  place: PlaceRef,
  fetchedAt: Date,
  model: WindyModel,
  apiMode: "testing" | "professional" = "testing",
): WeatherBundle {
  const root = asRecord(payload);
  const timestamps = root?.ts;
  const units = asRecord(root?.units) ?? {};
  if (!Array.isArray(timestamps)) {
    throw new WeatherProviderError("windy", "Windy 응답에 시간별 예보가 없습니다.");
  }

  const points: ForecastPoint[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = finiteNumber(timestamps[index]);
    if (timestamp === undefined) continue;
    const validDate = new Date(timestamp);
    if (!Number.isFinite(validDate.getTime())) continue;

    const temperature = arrayNumber(root?.["temp-surface"], index);
    const relativeHumidity = arrayNumber(root?.["rh-surface"], index);
    const windU = arrayNumber(root?.["wind_u-surface"], index);
    const windV = arrayNumber(root?.["wind_v-surface"], index);
    const windGust = arrayNumber(root?.["gust-surface"], index);
    const precipitation = arrayNumber(root?.["past3hprecip-surface"], index);
    const precipitationAmountMm = convertPrecipitationToMm(
      precipitation,
      units["past3hprecip-surface"],
    );
    const windSpeedMs =
      windU !== undefined && windV !== undefined
        ? convertSpeedToMs(
            Math.hypot(windU, windV),
            units["wind_u-surface"] ?? units["wind_v-surface"],
          )
        : undefined;
    const point: ForecastPoint = {
      validAt: validDate.toISOString(),
      validTo:
        precipitationAmountMm === undefined
          ? undefined
          : new Date(validDate.getTime() + 3 * 3_600_000).toISOString(),
      temperatureC: convertTemperatureToC(temperature, units["temp-surface"]),
      relativeHumidityPercent: relativeHumidity,
      windSpeedMs,
      windGustMs: convertSpeedToMs(windGust, units["gust-surface"]),
      precipitationAmountMm,
      precipitationRateMmh:
        precipitationAmountMm === undefined ? undefined : precipitationAmountMm / 3,
      conditionCode: windyConditionCode(arrayNumber(root?.["ptype-surface"], index)),
      resolutionMinutes: 180,
    };
    points.push(point);
  }

  const warnings = [
    `Windy ${model.toUpperCase()} 값은 관측값이 아니라 모델 예측입니다.`,
    "Windy 강수량은 직전 3시간 누적값을 시간당 평균으로 환산했습니다.",
  ];
  if (apiMode === "testing") {
    warnings.push(
      "Windy Testing API는 임의로 섞이고 변형된 개발용 데이터이므로 실제 의사결정에 사용할 수 없습니다.",
    );
  }

  return makeBundle({
    providerId: "windy",
    place,
    fetchedAt,
    current: nearestPoint(points, fetchedAt),
    points,
    attribution: `${ATTRIBUTION} · ${model.toUpperCase()}`,
    isDemo: apiMode === "testing",
    warnings,
  });
}

function arrayNumber(value: unknown, index: number): number | undefined {
  return Array.isArray(value) ? finiteNumber(value[index]) : undefined;
}

function convertTemperatureToC(
  value: number | undefined,
  rawUnit: unknown,
): number | undefined {
  if (value === undefined) return undefined;
  const unit = String(rawUnit ?? "").toLowerCase();
  if (unit === "k" || unit.includes("kelvin")) return value - 273.15;
  if (unit === "f" || unit.includes("fahrenheit")) return ((value - 32) * 5) / 9;
  return value;
}

function convertPrecipitationToMm(
  value: number | undefined,
  rawUnit: unknown,
): number | undefined {
  if (value === undefined || value < 0) return undefined;
  const unit = String(rawUnit ?? "").toLowerCase().replaceAll(" ", "");
  if (unit === "m" || unit === "meter" || unit === "metre") return value * 1_000;
  if (unit === "cm") return value * 10;
  return value;
}

function convertSpeedToMs(
  value: number | undefined,
  rawUnit: unknown,
): number | undefined {
  if (value === undefined || value < 0) return undefined;
  const unit = String(rawUnit ?? "").toLowerCase().replaceAll(" ", "");
  if (unit.includes("km") && (unit.includes("h-1") || unit.includes("/h"))) {
    return value / 3.6;
  }
  if (unit === "mph") return value * 0.44704;
  return value;
}

function windyConditionCode(value: number | undefined): string | undefined {
  switch (value) {
    case 0:
      return "no-precipitation";
    case 1:
      return "rain";
    case 3:
      return "freezing-rain";
    case 5:
      return "snow";
    case 7:
      return "rain-and-snow";
    case 8:
      return "ice-pellets";
    default:
      return undefined;
  }
}

