export const KMA_RADAR_IMAGE_ENDPOINT =
  "https://apihub.kma.go.kr/api/typ03/cgi/rdr/nph-qpf_ana_img";

export const KMA_RADAR_FORECAST_MINUTES = [0, 10, 20, 30, 40, 50, 60] as const;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

type KmaRadarImageUrlOptions = {
  apiHubKey: string;
  baseTime: Date;
  forecastMinutes: number;
  size?: number;
};

/** Formats an instant as the KST timestamp expected by KMA API Hub. */
export function formatKmaRadarTime(value: Date): string {
  const kst = new Date(value.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear().toString().padStart(4, "0");
  const month = (kst.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = kst.getUTCDate().toString().padStart(2, "0");
  const hour = kst.getUTCHours().toString().padStart(2, "0");
  const minute = kst.getUTCMinutes().toString().padStart(2, "0");
  return `${year}${month}${day}${hour}${minute}`;
}

/**
 * Radar products can arrive a little after their nominal timestamp. Start at a
 * safely delayed ten-minute boundary, then keep older candidates for img error
 * fallback without requiring a CORS-enabled fetch.
 */
export function kmaRadarBaseTimeCandidates(
  now: Date,
  publicationLagMinutes = 20,
  candidateCount = 4,
): Date[] {
  const delayed = now.getTime() - publicationLagMinutes * 60 * 1000;
  const rounded = Math.floor(delayed / TEN_MINUTES_MS) * TEN_MINUTES_MS;
  return Array.from(
    { length: Math.max(1, candidateCount) },
    (_, index) => new Date(rounded - index * TEN_MINUTES_MS),
  );
}

export function buildKmaRadarImageUrl({
  apiHubKey,
  baseTime,
  forecastMinutes,
  size = 700,
}: KmaRadarImageUrlOptions): string {
  const params = new URLSearchParams({
    tm: formatKmaRadarTime(baseTime),
    qpf: "M",
    eva: "1",
    option: "1",
    ef: Math.max(0, Math.min(60, Math.round(forecastMinutes))).toString(),
    map: "HR",
    grid: "2",
    legend: "1",
    size: Math.max(320, Math.min(1200, Math.round(size))).toString(),
    itv: "5",
    zoom_level: "0",
    zoom_x: "0000000",
    zoom_y: "0000000",
    gov: "",
    authKey: apiHubKey.trim(),
  });

  return `${KMA_RADAR_IMAGE_ENDPOINT}?${params.toString()}`;
}

export function kmaRadarValidTime(
  baseTime: Date,
  forecastMinutes: number,
): Date {
  return new Date(baseTime.getTime() + forecastMinutes * 60 * 1000);
}
