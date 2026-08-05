import type { PlaceRef, ProviderId, WeatherBundle } from "../domain";
import { fetchAccuWeather } from "./accuweather";
import { WeatherProviderConfigurationError } from "./common";
import { fetchKmaWeather } from "./kma";
import { fetchMetNorwayWeather } from "./metNorway";
import type {
  FetchWeatherOptions,
  ProviderInfo,
  WeatherProviderAdapter,
} from "./types";
import { fetchWindyWeather } from "./windy";

export const PROVIDER_INFO = [
  {
    id: "kma_forecast",
    label: "기상청",
    description: "대한민국 초단기실황과 단기예보",
    attribution: "기상청 · 공공누리 제1유형",
    configuration: "api-key",
    browserMode: "direct",
  },
  {
    id: "met_norway",
    label: "MET Norway",
    description: "Locationforecast 전 세계 수치예보",
    attribution: "MET Norway · CC BY 4.0",
    configuration: "none",
    browserMode: "direct",
  },
  {
    id: "windy",
    label: "Windy",
    description: "GFS 또는 ICON Point Forecast",
    attribution: "Contains data from the Windy database",
    configuration: "api-key",
    browserMode: "direct",
  },
  {
    id: "accuweather",
    label: "AccuWeather",
    description: "프록시를 통한 현재 상태와 시간별 예보",
    attribution: "Weather data provided by AccuWeather",
    configuration: "proxy-url",
    browserMode: "proxy",
  },
] as const satisfies readonly ProviderInfo[];

const PROVIDER_ADAPTERS: Record<ProviderId, WeatherProviderAdapter> = {
  kma_forecast: fetchKmaWeather,
  met_norway: fetchMetNorwayWeather,
  windy: fetchWindyWeather,
  accuweather: fetchAccuWeather,
};

/**
 * Fetch exactly the provider selected by the user.
 *
 * Deliberately do not catch and retry through another provider: doing so would
 * hide configuration, CORS, quota and licensing failures and could mix data
 * under the wrong attribution.
 */
export function fetchWeather(
  providerId: ProviderId,
  place: PlaceRef,
  options?: FetchWeatherOptions,
): Promise<WeatherBundle> {
  const adapter = PROVIDER_ADAPTERS[providerId];
  if (!adapter) {
    throw new WeatherProviderConfigurationError(
      providerId,
      `지원하지 않는 날씨 공급자입니다: ${String(providerId)}`,
    );
  }
  return adapter(place, options);
}

export function getProviderInfo(providerId: ProviderId): ProviderInfo {
  const info = PROVIDER_INFO.find((candidate) => candidate.id === providerId);
  if (!info) {
    throw new WeatherProviderConfigurationError(
      providerId,
      `지원하지 않는 날씨 공급자입니다: ${String(providerId)}`,
    );
  }
  return info;
}

export * from "./accuweather";
export * from "./common";
export * from "./kma";
export * from "./metNorway";
export * from "./types";
export * from "./windy";

