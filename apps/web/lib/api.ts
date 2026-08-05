export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type Location = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  is_favorite: boolean;
};

export type CurrentWeather = {
  temperature_c: number;
  apparent_temperature_c: number;
  relative_humidity_pct: number;
  wind_speed_ms: number;
  station: { station_name: string; distance_km: number };
  observed_at_utc: string;
};

export type NowcastPoint = {
  valid_at_utc: string;
  precipitation_rate_mmh: number;
  source_age_minutes: number;
};

export type RainEvent = {
  start_at_utc: string;
  end_at_utc: string | null;
  maximum_rate_mmh: number;
  accumulated_mm: number;
  uncertainty_minutes: number;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  if (!response.ok) {
    throw new Error(`API 요청 실패 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function seoulTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

