import type { ForecastPoint, PlaceRef, WeatherBundle } from "../domain";
import {
  asRecord,
  clampProbability,
  fetchJson,
  finiteNumber,
  getNow,
  makeBundle,
  nonBlankString,
  requireNonBlank,
  WeatherProviderError,
} from "./common";
import type { FetchWeatherOptions } from "./types";

export const KMA_CURRENT_ENDPOINT =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
export const KMA_FORECAST_ENDPOINT =
  "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";

const ATTRIBUTION = "기상청 단기예보 · 공공누리 제1유형(출처표시)";
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000;
const SHORT_FORECAST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23] as const;

export type KmaGridCoordinate = { nx: number; ny: number };
export type KmaBaseTimeSelection = {
  baseDate: string;
  baseTime: string;
  issuedAt: string;
  usedFallback: boolean;
};

type KmaItem = Record<string, unknown>;

export async function fetchKmaWeather(
  place: PlaceRef,
  options?: FetchWeatherOptions,
): Promise<WeatherBundle> {
  const key = requireNonBlank(
    options?.config?.kmaServiceKey,
    "kma_forecast",
    "기상청 API 서비스 키를 입력해 주세요.",
  );
  const fetchedAt = getNow(options);
  const grid = latitudeLongitudeToKmaGrid(place.latitude, place.longitude);
  const currentBase = selectKmaUltraShortBaseTime(fetchedAt);
  const forecastBase = selectKmaShortForecastBaseTime(fetchedAt);

  const currentUrl = kmaUrl(KMA_CURRENT_ENDPOINT, key, currentBase, grid, 1_000);
  const forecastUrl = kmaUrl(KMA_FORECAST_ENDPOINT, key, forecastBase, grid, 2_000);

  const [currentPayload, forecastPayload] = await Promise.all([
    fetchJson(
      "kma_forecast",
      currentUrl,
      { method: "GET", signal: options?.signal },
      options,
    ),
    fetchJson(
      "kma_forecast",
      forecastUrl,
      { method: "GET", signal: options?.signal },
      options,
    ),
  ]);

  return normalizeKmaWeather(
    currentPayload,
    forecastPayload,
    place,
    fetchedAt,
    currentBase,
    forecastBase,
  );
}

export function normalizeKmaWeather(
  currentPayload: unknown,
  forecastPayload: unknown,
  place: PlaceRef,
  fetchedAt: Date,
  currentBase: KmaBaseTimeSelection,
  forecastBase: KmaBaseTimeSelection,
): WeatherBundle {
  const currentItems = unwrapKmaItems(currentPayload);
  const forecastItems = unwrapKmaItems(forecastPayload);
  const currentValues = new Map<string, string>();

  for (const item of currentItems) {
    const category = nonBlankString(item.category);
    const value = nonBlankString(item.obsrValue);
    if (category && value !== undefined) currentValues.set(category, value);
  }

  const current = normalizeKmaPoint(
    currentValues,
    currentBase.issuedAt,
    fetchedAt,
    true,
  );

  const grouped = new Map<string, Map<string, string>>();
  for (const item of forecastItems) {
    const category = nonBlankString(item.category);
    const forecastDate = nonBlankString(item.fcstDate);
    const forecastTime = nonBlankString(item.fcstTime);
    const value = nonBlankString(item.fcstValue);
    if (!category || !forecastDate || !forecastTime || value === undefined) continue;
    const key = `${forecastDate}${forecastTime.padStart(4, "0")}`;
    const values = grouped.get(key) ?? new Map<string, string>();
    values.set(category, value);
    grouped.set(key, values);
  }

  const points: ForecastPoint[] = [];
  for (const [dateTime, values] of grouped) {
    const validAt = kmaLocalDateTimeToIso(dateTime.slice(0, 8), dateTime.slice(8));
    if (!validAt) continue;
    points.push(normalizeKmaPoint(values, validAt, fetchedAt, false));
  }

  const warnings: string[] = [];
  if (currentBase.usedFallback || forecastBase.usedFallback) {
    warnings.push("기상청 발표 지연을 고려해 직전 발표 시각의 자료를 사용했습니다.");
  }

  return makeBundle({
    providerId: "kma_forecast",
    place,
    fetchedAt,
    issuedAt: forecastBase.issuedAt,
    current,
    points,
    attribution: ATTRIBUTION,
    warnings,
  });
}

function normalizeKmaPoint(
  values: Map<string, string>,
  validAt: string,
  fetchedAt: Date,
  observation: boolean,
): ForecastPoint {
  const temperatureC = finiteNumber(values.get(observation ? "T1H" : "TMP"));
  const precipitationAmountMm = parseKmaPrecipitation(
    values.get(observation ? "RN1" : "PCP"),
  );
  const issued = Date.parse(validAt);
  return {
    validAt,
    validTo: observation
      ? undefined
      : new Date(Date.parse(validAt) + 60 * 60 * 1_000).toISOString(),
    temperatureC,
    relativeHumidityPercent: finiteNumber(values.get("REH")),
    windSpeedMs: finiteNumber(values.get("WSD")),
    precipitationAmountMm,
    precipitationRateMmh: precipitationAmountMm,
    precipitationProbability: clampProbability(values.get("POP")),
    conditionCode: kmaConditionCode(values.get("PTY"), values.get("SKY")),
    sourceAgeMinutes: Number.isFinite(issued)
      ? Math.max(0, Math.round((fetchedAt.getTime() - issued) / 60_000))
      : undefined,
    resolutionMinutes: observation ? 10 : 60,
  };
}

function unwrapKmaItems(payload: unknown): KmaItem[] {
  const root = asRecord(payload);
  const response = asRecord(root?.response);
  const header = asRecord(response?.header);
  const resultCode = String(header?.resultCode ?? "");
  if (resultCode !== "00" && resultCode !== "0") {
    const resultMessage = nonBlankString(header?.resultMsg) ?? "알 수 없는 오류";
    throw new WeatherProviderError(
      "kma_forecast",
      `기상청 API가 요청을 거부했습니다. (${resultCode || "응답 코드 없음"}: ${resultMessage})`,
    );
  }
  const body = asRecord(response?.body);
  const items = asRecord(body?.items)?.item;
  if (!Array.isArray(items)) return [];
  return items.map(asRecord).filter((item): item is KmaItem => Boolean(item));
}

function kmaUrl(
  endpoint: string,
  serviceKey: string,
  base: KmaBaseTimeSelection,
  grid: KmaGridCoordinate,
  rowCount: number,
): URL {
  const url = new URL(endpoint);
  // URLSearchParams performs the required encoding. Decode a key copied from
  // data.go.kr's "encoded key" field once to avoid encoding '%' a second time.
  let normalizedKey = serviceKey;
  try {
    normalizedKey = decodeURIComponent(serviceKey);
  } catch {
    // A plain (already decoded) service key is valid input.
  }
  url.searchParams.set("serviceKey", normalizedKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", String(rowCount));
  url.searchParams.set("dataType", "JSON");
  url.searchParams.set("base_date", base.baseDate);
  url.searchParams.set("base_time", base.baseTime);
  url.searchParams.set("nx", String(grid.nx));
  url.searchParams.set("ny", String(grid.ny));
  return url;
}

export function latitudeLongitudeToKmaGrid(
  latitude: number,
  longitude: number,
): KmaGridCoordinate {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new WeatherProviderError("kma_forecast", "유효하지 않은 위도입니다.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new WeatherProviderError("kma_forecast", "유효하지 않은 경도입니다.");
  }

  const earthRadiusKm = 6371.00877;
  const gridSpacingKm = 5.0;
  const degree = Math.PI / 180;
  const standardParallel1 = 30 * degree;
  const standardParallel2 = 60 * degree;
  const originLongitude = 126 * degree;
  const originLatitude = 38 * degree;
  const originX = 43;
  const originY = 136;

  const re = earthRadiusKm / gridSpacingKm;
  let sn =
    Math.tan(Math.PI * 0.25 + standardParallel2 * 0.5) /
    Math.tan(Math.PI * 0.25 + standardParallel1 * 0.5);
  sn =
    Math.log(Math.cos(standardParallel1) / Math.cos(standardParallel2)) /
    Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + standardParallel1 * 0.5);
  sf = Math.pow(sf, sn) * (Math.cos(standardParallel1) / sn);
  let ro = Math.tan(Math.PI * 0.25 + originLatitude * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + latitude * degree * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = longitude * degree - originLongitude;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + originX + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + originY + 0.5),
  };
}

export function selectKmaShortForecastBaseTime(
  requestedAt: Date,
  publicationDelayMinutes = 10,
): KmaBaseTimeSelection {
  assertValidDate(requestedAt);
  const local = new Date(requestedAt.getTime() + SEOUL_OFFSET_MS);
  const candidates: Array<{ actual: number; local: Date }> = [];
  for (const dayOffset of [0, -1]) {
    const day = new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset),
    );
    for (const hour of SHORT_FORECAST_HOURS) {
      const localCandidate = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour),
      );
      candidates.push({
        actual: localCandidate.getTime() - SEOUL_OFFSET_MS,
        local: localCandidate,
      });
    }
  }

  const available = candidates
    .filter(
      (candidate) =>
        candidate.actual + publicationDelayMinutes * 60_000 <= requestedAt.getTime(),
    )
    .sort((left, right) => right.actual - left.actual);
  const scheduled = candidates
    .filter((candidate) => candidate.actual <= requestedAt.getTime())
    .sort((left, right) => right.actual - left.actual);
  const selected = available[0];
  if (!selected) {
    throw new WeatherProviderError(
      "kma_forecast",
      "사용 가능한 기상청 단기예보 발표 시각을 찾지 못했습니다.",
    );
  }
  return selectionFromCandidate(
    selected.local,
    selected.actual,
    Boolean(scheduled[0] && scheduled[0].actual > selected.actual),
  );
}

export function selectKmaUltraShortBaseTime(
  requestedAt: Date,
  publicationMinute = 45,
): KmaBaseTimeSelection {
  assertValidDate(requestedAt);
  const local = new Date(requestedAt.getTime() + SEOUL_OFFSET_MS);
  const localIssue = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours()),
  );
  const usedFallback = local.getUTCMinutes() < publicationMinute;
  if (usedFallback) localIssue.setUTCHours(localIssue.getUTCHours() - 1);
  const actual = localIssue.getTime() - SEOUL_OFFSET_MS;
  return selectionFromCandidate(localIssue, actual, usedFallback);
}

function selectionFromCandidate(
  local: Date,
  actual: number,
  usedFallback: boolean,
): KmaBaseTimeSelection {
  return {
    baseDate: `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}`,
    baseTime: `${pad(local.getUTCHours())}00`,
    issuedAt: new Date(actual).toISOString(),
    usedFallback,
  };
}

export function parseKmaPrecipitation(value: unknown): number | undefined {
  const text = nonBlankString(value);
  if (!text) return undefined;
  if (text.includes("강수없음") || text === "없음") return 0;

  const range = text.match(/([0-9.]+)\s*(?:~|～|-)[^0-9]*([0-9.]+)/);
  if (range) {
    const lower = Number(range[1]);
    const upper = Number(range[2]);
    return Number.isFinite(lower) && Number.isFinite(upper)
      ? (lower + upper) / 2
      : undefined;
  }
  const numeric = text.match(/[0-9.]+/);
  if (!numeric) return undefined;
  const amount = Number(numeric[0]);
  if (!Number.isFinite(amount)) return undefined;
  if (text.includes("미만")) return amount / 2;
  return amount;
}

function kmaConditionCode(ptyValue: unknown, skyValue: unknown): string | undefined {
  const pty = finiteNumber(ptyValue);
  const precipitation: Record<number, string> = {
    1: "rain",
    2: "rain-and-snow",
    3: "snow",
    4: "rain-showers",
    5: "drizzle",
    6: "drizzle-and-snow",
    7: "snow-showers",
  };
  if (pty && precipitation[pty]) return precipitation[pty];
  const sky = finiteNumber(skyValue);
  if (sky === 1) return "clear";
  if (sky === 3) return "partly-cloudy";
  if (sky === 4) return "cloudy";
  return undefined;
}

function kmaLocalDateTimeToIso(date: string, time: string): string | undefined {
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return undefined;
  const actual =
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
      Number(time.slice(0, 2)),
      Number(time.slice(2, 4)),
    ) - SEOUL_OFFSET_MS;
  return Number.isFinite(actual) ? new Date(actual).toISOString() : undefined;
}

function assertValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new WeatherProviderError("kma_forecast", "유효하지 않은 기준 시각입니다.");
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

