import type { ForecastPoint, PlaceRef, ProviderId, WeatherBundle } from "../domain";
import type { FetchWeatherOptions } from "./types";

export class WeatherProviderError extends Error {
  readonly providerId: ProviderId;
  readonly status?: number;

  constructor(providerId: ProviderId, message: string, status?: number) {
    super(message);
    this.name = "WeatherProviderError";
    this.providerId = providerId;
    this.status = status;
  }
}

export class WeatherProviderConfigurationError extends WeatherProviderError {
  constructor(providerId: ProviderId, message: string) {
    super(providerId, message);
    this.name = "WeatherProviderConfigurationError";
  }
}

export function getFetch(options?: FetchWeatherOptions): typeof fetch {
  return options?.fetchImpl ?? globalThis.fetch;
}

export function getNow(options?: FetchWeatherOptions): Date {
  const now = options?.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("유효하지 않은 현재 시각입니다.");
  }
  return now;
}

export function requireNonBlank(
  value: string | undefined,
  providerId: ProviderId,
  message: string,
): string {
  if (!value?.trim()) {
    throw new WeatherProviderConfigurationError(providerId, message);
  }
  return value.trim();
}

export async function fetchJson(
  providerId: ProviderId,
  input: RequestInfo | URL,
  init: RequestInit,
  options?: FetchWeatherOptions,
): Promise<unknown> {
  let response: Response;
  try {
    response = await getFetch(options)(input, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new WeatherProviderError(
      providerId,
      `${providerLabel(providerId)} 요청에 실패했습니다. 네트워크와 CORS 설정을 확인해 주세요.`,
    );
  }

  if (!response.ok) {
    throw new WeatherProviderError(
      providerId,
      `${providerLabel(providerId)} 요청에 실패했습니다. (HTTP ${response.status})`,
      response.status,
    );
  }

  if (response.status === 204) {
    throw new WeatherProviderError(
      providerId,
      `${providerLabel(providerId)}가 선택한 위치와 모델에 대한 예보를 제공하지 않았습니다.`,
      204,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new WeatherProviderError(
      providerId,
      `${providerLabel(providerId)} 응답을 JSON으로 해석할 수 없습니다.`,
      response.status,
    );
  }
}

export function providerLabel(providerId: ProviderId): string {
  switch (providerId) {
    case "kma_forecast":
      return "기상청";
    case "met_norway":
      return "MET Norway";
    case "windy":
      return "Windy";
    case "accuweather":
      return "AccuWeather";
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function nonBlankString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function clampProbability(value: unknown): number | undefined {
  const numeric = finiteNumber(value);
  if (numeric === undefined || numeric < 0) {
    return undefined;
  }
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return ratio <= 1 ? ratio : undefined;
}

export function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function nearestPoint(points: ForecastPoint[], now: Date): ForecastPoint | undefined {
  let nearest: ForecastPoint | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const timestamp = Date.parse(point.validAt);
    if (!Number.isFinite(timestamp)) continue;
    const candidateDistance = Math.abs(timestamp - now.getTime());
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = point;
    }
  }
  return nearest ? { ...nearest } : undefined;
}

export function makeBundle(input: {
  providerId: ProviderId;
  place: PlaceRef;
  fetchedAt: Date;
  issuedAt?: string;
  current?: ForecastPoint;
  points: ForecastPoint[];
  attribution: string;
  warnings?: string[];
  isDemo?: boolean;
}): WeatherBundle {
  if (input.points.length === 0 && !input.current) {
    throw new WeatherProviderError(
      input.providerId,
      `${providerLabel(input.providerId)} 응답에 사용할 수 있는 날씨 자료가 없습니다.`,
    );
  }
  return {
    providerId: input.providerId,
    place: input.place,
    fetchedAt: input.fetchedAt.toISOString(),
    issuedAt: input.issuedAt,
    current: input.current,
    points: [...input.points].sort(
      (left, right) => Date.parse(left.validAt) - Date.parse(right.validAt),
    ),
    attribution: input.attribution,
    isDemo: input.isDemo,
    warnings: input.warnings?.length ? input.warnings : undefined,
  };
}

export function sourceAgeMinutes(issuedAt: string | undefined, fetchedAt: Date): number | undefined {
  if (!issuedAt) return undefined;
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) return undefined;
  return Math.max(0, Math.round((fetchedAt.getTime() - issued) / 60_000));
}

