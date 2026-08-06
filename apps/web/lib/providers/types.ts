import type { PlaceRef, ProviderId, WeatherBundle } from "../domain";

export type WindyModel = "gfs" | "icon";
export type WindyApiMode = "testing" | "professional";

/**
 * Runtime configuration supplied by the user.
 *
 * Kakao Maps credentials live outside this weather-provider layer. AccuWeather
 * deliberately has no client API-key option: its official security guidance
 * requires browser applications to call a server-side proxy.
 */
export type WeatherProviderConfig = {
  kmaServiceKey?: string;
  windyApiKey?: string;
  windyModel?: WindyModel;
  windyApiMode?: WindyApiMode;
  accuweatherProxyUrl?: string;
};

export type FetchWeatherOptions = {
  config?: WeatherProviderConfig;
  signal?: AbortSignal;
  /** Dependency injection hook for deterministic tests. */
  fetchImpl?: typeof fetch;
  /** Used only for deterministic issue-time selection and normalization. */
  now?: Date;
};

export type WeatherProviderAdapter = (
  place: PlaceRef,
  options?: FetchWeatherOptions,
) => Promise<WeatherBundle>;

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  description: string;
  attribution: string;
  configuration: "none" | "api-key" | "proxy-url";
  browserMode: "direct" | "proxy";
};
