import type { AppSettings, PlaceKey, PlaceRef, ProviderId } from "@/lib/domain";
import type { ApiConfiguration, ClientState } from "@/lib/storage";

export const SETTINGS_BACKUP_VERSION = 1 as const;

export interface SettingsBackupDocument {
  version: typeof SETTINGS_BACKUP_VERSION;
  exportedAt: string;
  state: ClientState;
}

export interface SettingsBackupExport {
  filename: string;
  json: string;
}

export class SettingsBackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsBackupValidationError";
  }
}

const PROVIDERS = new Set<ProviderId>([
  "kma_forecast",
  "met_norway",
  "windy",
  "accuweather",
]);
const TRAVEL_MODES = new Set(["driving", "transit", "walking", "bicycling"]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function invalid(path: string, reason: string): never {
  throw new SettingsBackupValidationError(`${path}: ${reason}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "객체여야 합니다.");
  }
  return value as Record<string, unknown>;
}

function stringAt(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  if (typeof value !== "string") invalid(path, "문자열이어야 합니다.");
  const sanitized = value.trim();
  if (!options.allowEmpty && sanitized.length === 0) {
    invalid(path, "비어 있을 수 없습니다.");
  }
  if (sanitized.length > (options.maxLength ?? 1_000)) {
    invalid(path, "허용 길이를 초과했습니다.");
  }
  return sanitized;
}

function numberAt(
  value: unknown,
  path: string,
  options: { minimum?: number; maximum?: number; integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "유한한 숫자여야 합니다.");
  }
  if (options.integer && !Number.isInteger(value)) {
    invalid(path, "정수여야 합니다.");
  }
  if (options.minimum !== undefined && value < options.minimum) {
    invalid(path, `${options.minimum} 이상이어야 합니다.`);
  }
  if (options.maximum !== undefined && value > options.maximum) {
    invalid(path, `${options.maximum} 이하여야 합니다.`);
  }
  return value;
}

function timeAt(value: unknown, path: string): string {
  const time = stringAt(value, path, { maxLength: 5 });
  if (!TIME_PATTERN.test(time))
    invalid(path, "HH:mm 형식의 유효한 시간이어야 합니다.");
  return time;
}

function optionalStringAt(
  value: unknown,
  path: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = stringAt(value, path, { allowEmpty: true, maxLength });
  return sanitized || undefined;
}

function placeAt(
  value: unknown,
  expectedKey: PlaceKey,
  path: string,
): PlaceRef | null {
  if (value === null) return null;
  const place = objectAt(value, path);
  if (place.key !== expectedKey) {
    invalid(`${path}.key`, `"${expectedKey}"여야 합니다.`);
  }

  const sanitized: PlaceRef = {
    key: expectedKey,
    name: stringAt(place.name, `${path}.name`, { maxLength: 200 }),
    latitude: numberAt(place.latitude, `${path}.latitude`, {
      minimum: -90,
      maximum: 90,
    }),
    longitude: numberAt(place.longitude, `${path}.longitude`, {
      minimum: -180,
      maximum: 180,
    }),
  };
  const placeId = optionalStringAt(place.placeId, `${path}.placeId`, 500);
  const address = optionalStringAt(place.address, `${path}.address`, 1_000);
  if (placeId) sanitized.placeId = placeId;
  if (address) sanitized.address = address;
  return sanitized;
}

function settingsAt(value: unknown, path: string): AppSettings {
  const settings = objectAt(value, path);
  const providerId = stringAt(settings.providerId, `${path}.providerId`, {
    maxLength: 40,
  });
  if (!PROVIDERS.has(providerId as ProviderId)) {
    invalid(`${path}.providerId`, "지원하지 않는 날씨 공급자입니다.");
  }

  const timezone = stringAt(settings.timezone, `${path}.timezone`, {
    maxLength: 100,
  });
  try {
    new Intl.DateTimeFormat("ko-KR", { timeZone: timezone }).format(0);
  } catch {
    invalid(`${path}.timezone`, "유효한 IANA 시간대가 아닙니다.");
  }

  const places = objectAt(settings.places, `${path}.places`);
  const schedule = objectAt(settings.schedule, `${path}.schedule`);
  const comfortable = objectAt(
    settings.comfortableApparentTemperatureC,
    `${path}.comfortableApparentTemperatureC`,
  );
  const minimumTemperature = numberAt(
    comfortable.minimum,
    `${path}.comfortableApparentTemperatureC.minimum`,
    { minimum: -100, maximum: 100 },
  );
  const maximumTemperature = numberAt(
    comfortable.maximum,
    `${path}.comfortableApparentTemperatureC.maximum`,
    { minimum: -100, maximum: 100 },
  );
  if (minimumTemperature > maximumTemperature) {
    invalid(
      `${path}.comfortableApparentTemperatureC`,
      "최솟값이 최댓값보다 클 수 없습니다.",
    );
  }

  const weights = objectAt(settings.scoreWeights, `${path}.scoreWeights`);
  const scoreWeights = {
    precipitation: numberAt(
      weights.precipitation,
      `${path}.scoreWeights.precipitation`,
      { minimum: 0, maximum: 100 },
    ),
    apparentTemperature: numberAt(
      weights.apparentTemperature,
      `${path}.scoreWeights.apparentTemperature`,
      { minimum: 0, maximum: 100 },
    ),
    wind: numberAt(weights.wind, `${path}.scoreWeights.wind`, {
      minimum: 0,
      maximum: 100,
    }),
    uncertainty: numberAt(
      weights.uncertainty,
      `${path}.scoreWeights.uncertainty`,
      { minimum: 0, maximum: 100 },
    ),
  };
  if (Object.values(scoreWeights).every((weight) => weight === 0)) {
    invalid(`${path}.scoreWeights`, "하나 이상의 가중치가 0보다 커야 합니다.");
  }

  const travelMode = stringAt(settings.travelMode, `${path}.travelMode`, {
    maxLength: 20,
  });
  if (!TRAVEL_MODES.has(travelMode)) {
    invalid(`${path}.travelMode`, "지원하지 않는 이동 수단입니다.");
  }

  const commuteWindow = (direction: "outbound" | "inbound") => {
    const window = objectAt(
      schedule[direction],
      `${path}.schedule.${direction}`,
    );
    return {
      startLocalTime: timeAt(
        window.startLocalTime,
        `${path}.schedule.${direction}.startLocalTime`,
      ),
      endLocalTime: timeAt(
        window.endLocalTime,
        `${path}.schedule.${direction}.endLocalTime`,
      ),
      travelMinutes: numberAt(
        window.travelMinutes,
        `${path}.schedule.${direction}.travelMinutes`,
        { integer: true, minimum: 1, maximum: 1_440 },
      ),
    };
  };

  return {
    timezone,
    providerId: providerId as ProviderId,
    places: {
      home: placeAt(places.home, "home", `${path}.places.home`),
      work: placeAt(places.work, "work", `${path}.places.work`),
    },
    travelMode: travelMode as AppSettings["travelMode"],
    schedule: {
      outbound: commuteWindow("outbound"),
      inbound: commuteWindow("inbound"),
    },
    candidateStepMinutes: numberAt(
      settings.candidateStepMinutes,
      `${path}.candidateStepMinutes`,
      { integer: true, minimum: 1, maximum: 1_440 },
    ),
    goodWindowScoreDelta: numberAt(
      settings.goodWindowScoreDelta,
      `${path}.goodWindowScoreDelta`,
      { minimum: 0, maximum: 100 },
    ),
    comfortableApparentTemperatureC: {
      minimum: minimumTemperature,
      maximum: maximumTemperature,
    },
    scoreWeights,
  };
}

function apiConfigurationAt(value: unknown, path: string): ApiConfiguration {
  const api = objectAt(value, path);
  const windyModel = stringAt(api.windyModel, `${path}.windyModel`, {
    maxLength: 10,
  });
  if (windyModel !== "gfs" && windyModel !== "icon") {
    invalid(`${path}.windyModel`, "gfs 또는 icon이어야 합니다.");
  }
  const windyApiMode = stringAt(api.windyApiMode, `${path}.windyApiMode`, {
    maxLength: 20,
  });
  if (windyApiMode !== "testing" && windyApiMode !== "professional") {
    invalid(`${path}.windyApiMode`, "testing 또는 professional이어야 합니다.");
  }

  const accuweatherProxyUrl = stringAt(
    api.accuweatherProxyUrl,
    `${path}.accuweatherProxyUrl`,
    { allowEmpty: true, maxLength: 2_048 },
  );
  if (accuweatherProxyUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(accuweatherProxyUrl);
    } catch {
      invalid(`${path}.accuweatherProxyUrl`, "유효한 URL이어야 합니다.");
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      invalid(`${path}.accuweatherProxyUrl`, "HTTP(S) URL이어야 합니다.");
    }
  }

  return {
    kakaoMapsAppKey: stringAt(api.kakaoMapsAppKey, `${path}.kakaoMapsAppKey`, {
      allowEmpty: true,
      maxLength: 4_096,
    }),
    kmaServiceKey: stringAt(api.kmaServiceKey, `${path}.kmaServiceKey`, {
      allowEmpty: true,
      maxLength: 4_096,
    }),
    windyApiKey: stringAt(api.windyApiKey, `${path}.windyApiKey`, {
      allowEmpty: true,
      maxLength: 4_096,
    }),
    windyModel,
    windyApiMode,
    accuweatherProxyUrl,
  };
}

function stateAt(value: unknown, path: string): ClientState {
  const state = objectAt(value, path);
  return {
    settings: settingsAt(state.settings, `${path}.settings`),
    api: apiConfigurationAt(state.api, `${path}.api`),
  };
}

function validDate(date: Date, path: string): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    invalid(path, "유효한 날짜여야 합니다.");
  }
  return date;
}

export function createSettingsBackupFilename(now = new Date()): string {
  const date = validDate(now, "filename date");
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `weather-route-settings-${timestamp}.json`;
}

export function exportSettingsBackup(
  state: ClientState,
  now = new Date(),
): SettingsBackupExport {
  const date = validDate(now, "exportedAt");
  const document: SettingsBackupDocument = {
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: date.toISOString(),
    state: stateAt(state, "state"),
  };
  return {
    filename: createSettingsBackupFilename(date),
    json: `${JSON.stringify(document, null, 2)}\n`,
  };
}

export function importSettingsBackup(json: string): ClientState {
  if (typeof json !== "string" || json.trim().length === 0) {
    invalid("backup", "비어 있지 않은 JSON 문자열이어야 합니다.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("backup", "올바른 JSON 파일이 아닙니다.");
  }

  const document = objectAt(parsed, "backup");
  if (document.version !== SETTINGS_BACKUP_VERSION) {
    invalid(
      "backup.version",
      `지원 버전 ${SETTINGS_BACKUP_VERSION}이어야 합니다.`,
    );
  }
  const exportedAt = stringAt(document.exportedAt, "backup.exportedAt", {
    maxLength: 50,
  });
  if (!Number.isFinite(Date.parse(exportedAt))) {
    invalid("backup.exportedAt", "유효한 날짜여야 합니다.");
  }
  return stateAt(document.state, "backup.state");
}
