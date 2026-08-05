import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type PlaceRef,
} from "@/lib/domain";

export type WindyModel = "gfs" | "icon";

export interface ApiConfiguration {
  googleMapsApiKey: string;
  kmaServiceKey: string;
  windyApiKey: string;
  windyModel: WindyModel;
  windyApiMode: "testing" | "professional";
  accuweatherProxyUrl: string;
}

export interface ClientState {
  settings: AppSettings;
  api: ApiConfiguration;
}

const STORAGE_KEY = "weather-route.client.v2";

export const SAMPLE_HOME: PlaceRef = {
  key: "home",
  name: "집",
  address: "서울 송파구 잠실",
  latitude: 37.5133,
  longitude: 127.1001,
};

export const SAMPLE_WORK: PlaceRef = {
  key: "work",
  name: "회사",
  address: "서울 종로구 광화문",
  latitude: 37.5716,
  longitude: 126.9769,
};

export const DEFAULT_API_CONFIGURATION: ApiConfiguration = {
  googleMapsApiKey: "",
  kmaServiceKey: "",
  windyApiKey: "",
  windyModel: "gfs",
  windyApiMode: "testing",
  accuweatherProxyUrl: "",
};

export const DEFAULT_CLIENT_STATE: ClientState = {
  settings: {
    ...DEFAULT_SETTINGS,
    places: { home: SAMPLE_HOME, work: SAMPLE_WORK },
  },
  api: DEFAULT_API_CONFIGURATION,
};

export function hasSavedClientState(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== null;
}

export function loadClientState(): ClientState {
  if (typeof window === "undefined") return DEFAULT_CLIENT_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CLIENT_STATE;

  try {
    const parsed = JSON.parse(raw) as Partial<ClientState>;
    const parsedSettings = parsed.settings ?? DEFAULT_CLIENT_STATE.settings;
    return {
      settings: {
        ...DEFAULT_CLIENT_STATE.settings,
        ...parsedSettings,
        places: {
          ...DEFAULT_CLIENT_STATE.settings.places,
          ...parsedSettings.places,
        },
        schedule: {
          outbound: {
            ...DEFAULT_CLIENT_STATE.settings.schedule.outbound,
            ...parsedSettings.schedule?.outbound,
          },
          inbound: {
            ...DEFAULT_CLIENT_STATE.settings.schedule.inbound,
            ...parsedSettings.schedule?.inbound,
          },
        },
        comfortableApparentTemperatureC: {
          ...DEFAULT_CLIENT_STATE.settings.comfortableApparentTemperatureC,
          ...parsedSettings.comfortableApparentTemperatureC,
        },
        scoreWeights: {
          ...DEFAULT_CLIENT_STATE.settings.scoreWeights,
          ...parsedSettings.scoreWeights,
        },
      },
      api: {
        ...DEFAULT_API_CONFIGURATION,
        ...parsed.api,
      },
    };
  } catch {
    return DEFAULT_CLIENT_STATE;
  }
}

export function saveClientState(state: ClientState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearClientState(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
