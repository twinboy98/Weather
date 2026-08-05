export type ProviderId =
  | "kma_forecast"
  | "met_norway"
  | "windy"
  | "accuweather";

export type PlaceKey = "home" | "work";

export type CommuteDirection = "outbound" | "inbound";

export type TravelMode = "driving" | "transit" | "walking" | "bicycling";

export interface PlaceRef {
  key: PlaceKey;
  placeId?: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
}

/**
 * A normalized forecast value. Accumulated precipitation must retain validTo;
 * consumers can then integrate only the portion overlapping a commute.
 */
export interface ForecastPoint {
  validAt: string;
  validTo?: string;
  temperatureC?: number;
  apparentTemperatureC?: number;
  relativeHumidityPercent?: number;
  precipitationRateMmh?: number;
  precipitationAmountMm?: number;
  /** Ratio from 0 to 1, never a percentage from 0 to 100. */
  precipitationProbability?: number;
  windSpeedMs?: number;
  windGustMs?: number;
  conditionCode?: string;
  /** Provider/adapter confidence, when available, as a ratio from 0 to 1. */
  confidence?: number;
  sourceAgeMinutes?: number;
  resolutionMinutes?: number;
}

export interface WeatherBundle {
  providerId: ProviderId;
  place: PlaceRef;
  fetchedAt: string;
  issuedAt?: string;
  current?: ForecastPoint;
  points: ForecastPoint[];
  attribution: string;
  isDemo?: boolean;
  warnings?: string[];
}

/** Compatibility name for provider adapters that describe one fetch as a snapshot. */
export type WeatherSnapshot = WeatherBundle;

export type WeatherBundleByPlace = Partial<Record<PlaceKey, WeatherBundle>>;

export interface CommuteWindow {
  /** Local wall-clock time in HH:mm format. */
  startLocalTime: string;
  /** Local wall-clock time in HH:mm format. Earlier values mean the next day. */
  endLocalTime: string;
  travelMinutes: number;
}

export interface ScoreWeights {
  precipitation: number;
  apparentTemperature: number;
  wind: number;
  uncertainty: number;
}

export interface AppSettings {
  timezone: string;
  providerId: ProviderId;
  places: Record<PlaceKey, PlaceRef | null>;
  travelMode: TravelMode;
  schedule: Record<CommuteDirection, CommuteWindow>;
  candidateStepMinutes: number;
  goodWindowScoreDelta: number;
  comfortableApparentTemperatureC: {
    minimum: number;
    maximum: number;
  };
  scoreWeights: ScoreWeights;
}

export type ScoreComponentKey =
  | "precipitation"
  | "apparentTemperature"
  | "wind"
  | "uncertainty";

export interface ScoreComponent {
  /** Normalized risk from 0 (best) to 1 (worst). */
  risk: number;
  /** Normalized weight used for this recommendation. */
  weight: number;
  /** Points deducted from a score of 100. */
  contribution: number;
  label: string;
}

export type ScoreBreakdown = Record<ScoreComponentKey, ScoreComponent>;

export interface CommuteCandidateMetrics {
  expectedWetnessMm: number | null;
  peakPrecipitationRateMmh: number | null;
  maximumPrecipitationProbability: number | null;
  apparentTemperatureC: number | null;
  effectiveWindSpeedMs: number | null;
}

export interface CommuteCandidate {
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  score: number;
  confidence: number;
  breakdown: ScoreBreakdown;
  metrics: CommuteCandidateMetrics;
  reasons: string[];
}

export interface GoodWindow {
  startAt: string;
  endAt: string;
  bestScore: number;
  candidateCount: number;
}

export type RecommendationStatus =
  | "ready"
  | "missing_places"
  | "missing_weather"
  | "no_candidates";

export interface Recommendation {
  status: RecommendationStatus;
  direction: CommuteDirection;
  origin: PlaceKey;
  destination: PlaceKey;
  best: CommuteCandidate | null;
  goodWindow: GoodWindow | null;
  goodWindows: GoodWindow[];
  alternatives: CommuteCandidate[];
  candidates: CommuteCandidate[];
  headline: string;
  summary: string;
  reasons: string[];
  assumptions: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: "Asia/Seoul",
  providerId: "met_norway",
  places: {
    home: null,
    work: null,
  },
  travelMode: "transit",
  schedule: {
    outbound: {
      startLocalTime: "07:00",
      endLocalTime: "09:00",
      travelMinutes: 45,
    },
    inbound: {
      startLocalTime: "17:30",
      endLocalTime: "20:00",
      travelMinutes: 45,
    },
  },
  candidateStepMinutes: 10,
  goodWindowScoreDelta: 3,
  comfortableApparentTemperatureC: {
    minimum: 10,
    maximum: 26,
  },
  scoreWeights: {
    precipitation: 0.55,
    apparentTemperature: 0.2,
    wind: 0.15,
    uncertainty: 0.1,
  },
};
