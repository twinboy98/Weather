import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type CommuteCandidate,
  type CommuteDirection,
  type CommuteWindow,
  type ForecastPoint,
  type GoodWindow,
  type PlaceKey,
  type Recommendation,
  type ScoreBreakdown,
  type ScoreComponentKey,
  type ScoreWeights,
  type TravelMode,
  type WeatherBundle,
  type WeatherBundleByPlace,
} from "./domain";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

type CalendarDate = { year: number; month: number; day: number };
type ZonedParts = CalendarDate & {
  hour: number;
  minute: number;
  second: number;
};

const COMPONENT_LABELS: Record<ScoreComponentKey, string> = {
  precipitation: "강수",
  apparentTemperature: "체감온도",
  wind: "바람",
  uncertainty: "예보 불확실성",
};

const OUTDOOR_EXPOSURE: Record<TravelMode, number> = {
  driving: 0.08,
  transit: 0.35,
  walking: 1,
  bicycling: 1,
};

const WIND_LIMITS: Record<TravelMode, readonly [number, number]> = {
  driving: [10, 25],
  transit: [5, 15],
  walking: [5, 15],
  bicycling: [3, 12],
};

/**
 * Generate future candidate departures for the current or next occurrence of a
 * local-time window. An end time before the start time crosses midnight.
 */
export function generateCandidateTimes(
  window: CommuteWindow,
  now: Date = new Date(),
  timezone = "Asia/Seoul",
  stepMinutes = 10,
): Date[] {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("now must be a valid Date");
  }
  const startMinute = parseLocalTime(window.startLocalTime);
  const endMinute = parseLocalTime(window.endLocalTime);
  const step = Math.max(1, Math.floor(stepMinutes));
  const today = zonedParts(now, timezone);
  const todayDate: CalendarDate = {
    year: today.year,
    month: today.month,
    day: today.day,
  };
  const crossesMidnight = endMinute < startMinute;

  const todayWindow = resolveWindow(
    todayDate,
    startMinute,
    endMinute,
    crossesMidnight,
    timezone,
  );
  const previousWindow = resolveWindow(
    addCalendarDays(todayDate, -1),
    startMinute,
    endMinute,
    crossesMidnight,
    timezone,
  );

  let selected = todayWindow;
  if (
    crossesMidnight &&
    now.getTime() >= previousWindow.start.getTime() &&
    now.getTime() <= previousWindow.end.getTime()
  ) {
    selected = previousWindow;
  } else if (now.getTime() > todayWindow.end.getTime()) {
    selected = resolveWindow(
      addCalendarDays(todayDate, 1),
      startMinute,
      endMinute,
      crossesMidnight,
      timezone,
    );
  }

  const candidates: Date[] = [];
  for (
    let timestamp = selected.start.getTime();
    timestamp <= selected.end.getTime();
    timestamp += step * MINUTE_MS
  ) {
    if (timestamp >= now.getTime()) {
      candidates.push(new Date(timestamp));
    }
  }

  // Preserve a user-entered end boundary even when it is not step-aligned.
  const finalTimestamp = selected.end.getTime();
  if (
    finalTimestamp >= now.getTime() &&
    candidates.at(-1)?.getTime() !== finalTimestamp
  ) {
    candidates.push(new Date(finalTimestamp));
  }
  return candidates;
}

/** Group all candidates close to the best score into contiguous departure windows. */
export function groupGoodWindows(
  candidates: CommuteCandidate[],
  scoreDelta = 3,
  expectedStepMinutes?: number,
): GoodWindow[] {
  if (candidates.length === 0) return [];
  const ordered = [...candidates].sort(
    (left, right) =>
      Date.parse(left.departureAt) - Date.parse(right.departureAt),
  );
  const bestScore = Math.max(...ordered.map((candidate) => candidate.score));
  const eligible = ordered.filter(
    (candidate) => candidate.score >= bestScore - Math.max(0, scoreDelta),
  );
  if (eligible.length === 0) return [];

  const inferredStep = inferStepMinutes(ordered);
  const allowedGap = Math.max(1, expectedStepMinutes ?? inferredStep) * 1.5;
  const groups: CommuteCandidate[][] = [];
  for (const candidate of eligible) {
    const current = groups.at(-1);
    if (!current) {
      groups.push([candidate]);
      continue;
    }
    const gapMinutes =
      (Date.parse(candidate.departureAt) -
        Date.parse(current.at(-1)!.departureAt)) /
      MINUTE_MS;
    if (gapMinutes <= allowedGap) current.push(candidate);
    else groups.push([candidate]);
  }

  return groups.map((group) => ({
    startAt: group[0].departureAt,
    endAt: group.at(-1)!.departureAt,
    bestScore: Math.max(...group.map((candidate) => candidate.score)),
    candidateCount: group.length,
  }));
}

/**
 * Compute an explainable browser-only recommendation from normalized weather.
 * The calculation does not perform network or storage operations.
 */
export function recommendCommute(
  bundleByPlace: WeatherBundleByPlace,
  settings: AppSettings,
  direction: CommuteDirection,
  now: Date = new Date(),
): Recommendation {
  const [origin, destination] = directionPlaces(direction);
  const base = emptyRecommendation(direction, origin, destination);
  if (!settings.places[origin] || !settings.places[destination]) {
    return {
      ...base,
      status: "missing_places",
      headline: "집과 회사를 먼저 지정해 주세요",
      summary: "두 장소가 모두 있어야 통근 시간을 계산할 수 있습니다.",
    };
  }

  const originBundle = bundleByPlace[origin];
  const destinationBundle = bundleByPlace[destination];
  if (!originBundle || !destinationBundle) {
    return {
      ...base,
      status: "missing_weather",
      headline: "날씨 자료가 더 필요합니다",
      summary: "집과 회사의 예보를 모두 불러온 뒤 다시 계산합니다.",
    };
  }

  const schedule = settings.schedule[direction];
  if (!Number.isFinite(schedule.travelMinutes) || schedule.travelMinutes <= 0) {
    return {
      ...base,
      status: "no_candidates",
      headline: "이동시간을 확인해 주세요",
      summary: "이동시간은 1분 이상이어야 합니다.",
    };
  }

  let departures: Date[];
  try {
    departures = generateCandidateTimes(
      schedule,
      now,
      settings.timezone,
      settings.candidateStepMinutes,
    );
  } catch {
    return {
      ...base,
      status: "no_candidates",
      headline: "허용 시간대를 확인해 주세요",
      summary: "시간은 HH:mm 형식으로 입력해야 합니다.",
    };
  }
  if (departures.length === 0) {
    return {
      ...base,
      status: "no_candidates",
      headline: "계산할 출발 시각이 없습니다",
      summary: "허용 시간대나 후보 간격을 조정해 주세요.",
    };
  }

  const candidates = departures
    .map((departure) => {
      const arrival = new Date(
        departure.getTime() + schedule.travelMinutes * MINUTE_MS,
      );
      const originPoint = forecastAt(originBundle, departure);
      const destinationPoint = forecastAt(destinationBundle, arrival);
      if (!originPoint || !destinationPoint) return null;
      return scoreCandidate(
        departure,
        arrival,
        schedule.travelMinutes,
        originPoint,
        destinationPoint,
        originBundle,
        destinationBundle,
        settings,
        now,
      );
    })
    .filter((candidate): candidate is CommuteCandidate => candidate !== null)
    .sort(
      (left, right) =>
        Date.parse(left.departureAt) - Date.parse(right.departureAt),
    );

  if (candidates.length === 0) {
    return {
      ...base,
      status: "missing_weather",
      headline: "허용 시간대의 예보가 없습니다",
      summary: "예보 범위를 확인하거나 다른 제공자를 선택해 주세요.",
    };
  }

  const ranked = [...candidates].sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const timeDifference =
      Date.parse(left.departureAt) - Date.parse(right.departureAt);
    // With equivalent conditions, leave home later and leave work earlier.
    return direction === "outbound" ? -timeDifference : timeDifference;
  });
  const best = ranked[0];
  const goodWindows = groupGoodWindows(
    candidates,
    settings.goodWindowScoreDelta,
    settings.candidateStepMinutes,
  );
  const goodWindow =
    goodWindows.find((window) => isWithin(best.departureAt, window)) ??
    goodWindows[0] ??
    null;
  const alternatives = ranked
    .filter(
      (candidate) =>
        candidate.departureAt !== best.departureAt &&
        (!goodWindow || !isWithin(candidate.departureAt, goodWindow)),
    )
    .slice(0, 2);

  const windowLabel = goodWindow
    ? formatGoodWindow(goodWindow, settings.timezone)
    : formatLocalTime(best.departureAt, settings.timezone);
  return {
    status: "ready",
    direction,
    origin,
    destination,
    best,
    goodWindow,
    goodWindows,
    alternatives,
    candidates,
    headline: `${windowLabel} 출발 권장`,
    summary: `통근 점수 ${best.score.toFixed(1)}점 · 신뢰도 ${confidenceLabel(best.confidence)} · 예상 ${best.durationMinutes}분`,
    reasons: best.reasons,
    assumptions: [
      "집과 회사의 예보를 이동 경로 전체 기상의 근사값으로 사용했습니다.",
      "누적 강수량은 공급자가 밝힌 유효 구간 안에 균등하게 분포한다고 가정했습니다.",
    ],
  };
}

function scoreCandidate(
  departure: Date,
  arrival: Date,
  durationMinutes: number,
  originPoint: ForecastPoint,
  destinationPoint: ForecastPoint,
  originBundle: WeatherBundle,
  destinationBundle: WeatherBundle,
  settings: AppSettings,
  now: Date,
): CommuteCandidate {
  const exposure = OUTDOOR_EXPOSURE[settings.travelMode];
  const originRate = precipitationRate(originPoint);
  const destinationRate = precipitationRate(destinationPoint);
  const rates = definedNumbers(originRate, destinationRate);
  const averageRate = average(rates);
  const peakRate = maximum(rates);
  const probability = maximum(
    definedNumbers(
      probabilityRatio(originPoint.precipitationProbability),
      probabilityRatio(destinationPoint.precipitationProbability),
    ),
  );
  const expectedWetness =
    averageRate === null
      ? null
      : averageRate * (durationMinutes / 60) * exposure;
  const precipitationRisk = calculatePrecipitationRisk(
    expectedWetness,
    peakRate,
    probability,
    exposure,
  );

  const apparentValues = definedNumbers(
    apparentTemperature(originPoint),
    apparentTemperature(destinationPoint),
  );
  const apparent = average(apparentValues);
  const apparentRisk =
    apparentValues.length === 0
      ? 0.5
      : Math.max(
          ...apparentValues.map((value) =>
            apparentTemperatureRisk(
              value,
              settings.comfortableApparentTemperatureC.minimum,
              settings.comfortableApparentTemperatureC.maximum,
            ),
          ),
        ) * exposure;

  const windValues = definedNumbers(
    effectiveWind(originPoint),
    effectiveWind(destinationPoint),
  );
  const effectiveWindSpeed = maximum(windValues);
  const [windLow, windHigh] = WIND_LIMITS[settings.travelMode];
  const windRisk =
    effectiveWindSpeed === null
      ? 0.5
      : smoothstep(windLow, windHigh, effectiveWindSpeed);

  const confidenceValues = [
    calculateConfidence(originPoint, originBundle, departure, now),
    calculateConfidence(destinationPoint, destinationBundle, arrival, now),
  ];
  const confidence = clamp01(Math.min(...confidenceValues));
  const risks: Record<ScoreComponentKey, number> = {
    precipitation: precipitationRisk,
    apparentTemperature: clamp01(apparentRisk),
    wind: clamp01(windRisk),
    uncertainty: 1 - confidence,
  };
  const breakdown = createBreakdown(risks, settings.scoreWeights);
  const totalPenalty = Object.values(breakdown).reduce(
    (sum, component) => sum + component.contribution,
    0,
  );
  const score = round(Math.max(0, 100 - totalPenalty), 1);
  const metrics = {
    expectedWetnessMm: nullableRound(expectedWetness, 3),
    peakPrecipitationRateMmh: nullableRound(peakRate, 2),
    maximumPrecipitationProbability: nullableRound(probability, 2),
    apparentTemperatureC: nullableRound(apparent, 1),
    effectiveWindSpeedMs: nullableRound(effectiveWindSpeed, 1),
  };

  return {
    departureAt: departure.toISOString(),
    arrivalAt: arrival.toISOString(),
    durationMinutes,
    score,
    confidence: round(confidence, 2),
    breakdown,
    metrics,
    reasons: explainCandidate(metrics, breakdown, confidence),
  };
}

function calculatePrecipitationRisk(
  expectedWetness: number | null,
  peakRate: number | null,
  probability: number | null,
  exposure: number,
): number {
  const parts: Array<{ value: number; weight: number }> = [];
  if (expectedWetness !== null) {
    parts.push({ value: 1 - Math.exp(-expectedWetness / 0.7), weight: 0.55 });
  }
  if (peakRate !== null) {
    parts.push({
      value:
        clamp01(Math.log1p(Math.max(0, peakRate)) / Math.log1p(10)) * exposure,
      weight: 0.3,
    });
  }
  if (probability !== null) {
    parts.push({
      value: clamp01((probability - 0.2) / 0.6) * exposure,
      weight: 0.15,
    });
  }
  if (parts.length === 0) return 0.5;
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  return clamp01(
    parts.reduce((sum, part) => sum + part.value * part.weight, 0) /
      totalWeight,
  );
}

function apparentTemperatureRisk(
  temperature: number,
  comfortableMinimum: number,
  comfortableMaximum: number,
): number {
  if (temperature < comfortableMinimum) {
    return clamp01((comfortableMinimum - temperature) / 20);
  }
  if (temperature > comfortableMaximum) {
    return clamp01((temperature - comfortableMaximum) / 12);
  }
  return 0;
}

function createBreakdown(
  risks: Record<ScoreComponentKey, number>,
  weights: ScoreWeights,
): ScoreBreakdown {
  const normalized = normalizeWeights(weights);
  return {
    precipitation: component(
      risks.precipitation,
      normalized.precipitation,
      "precipitation",
    ),
    apparentTemperature: component(
      risks.apparentTemperature,
      normalized.apparentTemperature,
      "apparentTemperature",
    ),
    wind: component(risks.wind, normalized.wind, "wind"),
    uncertainty: component(
      risks.uncertainty,
      normalized.uncertainty,
      "uncertainty",
    ),
  };
}

function component(risk: number, weight: number, key: ScoreComponentKey) {
  const boundedRisk = clamp01(risk);
  return {
    risk: round(boundedRisk, 3),
    weight: round(weight, 3),
    contribution: round(boundedRisk * weight * 100, 2),
    label: COMPONENT_LABELS[key],
  };
}

function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const safe: ScoreWeights = {
    precipitation: positive(weights.precipitation),
    apparentTemperature: positive(weights.apparentTemperature),
    wind: positive(weights.wind),
    uncertainty: positive(weights.uncertainty),
  };
  const total = Object.values(safe).reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { ...DEFAULT_SETTINGS.scoreWeights };
  return {
    precipitation: safe.precipitation / total,
    apparentTemperature: safe.apparentTemperature / total,
    wind: safe.wind / total,
    uncertainty: safe.uncertainty / total,
  };
}

function calculateConfidence(
  point: ForecastPoint,
  bundle: WeatherBundle,
  validAt: Date,
  now: Date,
): number {
  const fetchedAt = Date.parse(bundle.fetchedAt);
  const calculatedAge = Number.isFinite(fetchedAt)
    ? Math.max(0, (now.getTime() - fetchedAt) / MINUTE_MS)
    : 360;
  const ageMinutes =
    point.sourceAgeMinutes === undefined
      ? calculatedAge
      : Math.max(0, point.sourceAgeMinutes);
  const freshness = Math.exp(-ageMinutes / 360);

  const issuedAt = Date.parse(bundle.issuedAt ?? bundle.fetchedAt);
  const leadHours = Number.isFinite(issuedAt)
    ? Math.max(0, (validAt.getTime() - issuedAt) / HOUR_MS)
    : 72;
  const horizonFit =
    leadHours <= 2
      ? 1
      : leadHours <= 6
        ? 0.95
        : leadHours <= 24
          ? 0.85
          : leadHours <= 72
            ? 0.7
            : 0.5;

  const resolution = point.resolutionMinutes ?? inferredResolution(point) ?? 60;
  const resolutionFit =
    resolution <= 10
      ? 1
      : resolution <= 60
        ? 0.8
        : resolution <= 180
          ? 0.55
          : 0.35;
  const completeness =
    [
      hasPrecipitation(point),
      apparentTemperature(point) !== undefined,
      effectiveWind(point) !== undefined,
    ].filter(Boolean).length / 3;
  const metadataConfidence =
    0.35 * freshness +
    0.25 * horizonFit +
    0.2 * resolutionFit +
    0.2 * completeness;
  const explicit = finiteNumber(point.confidence);
  const result =
    explicit === undefined
      ? metadataConfidence
      : 0.8 * clamp01(explicit) + 0.2 * metadataConfidence;
  return bundle.isDemo ? Math.min(0.2, result) : clamp01(result);
}

function forecastAt(bundle: WeatherBundle, target: Date): ForecastPoint | null {
  const points = [bundle.current, ...bundle.points]
    .filter((point): point is ForecastPoint => point !== undefined)
    .filter((point) => Number.isFinite(Date.parse(point.validAt)));
  if (points.length === 0) return null;
  const timestamp = target.getTime();
  const covering = points.find((point) => {
    const start = Date.parse(point.validAt);
    const end = Date.parse(point.validTo ?? point.validAt);
    return end > start && timestamp >= start && timestamp < end;
  });
  if (covering) return covering;

  let nearest: ForecastPoint | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(Date.parse(point.validAt) - timestamp);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  if (!nearest) return null;
  const resolution =
    nearest.resolutionMinutes ?? inferredResolution(nearest) ?? 60;
  const maximumGapMinutes = Math.max(90, resolution * 1.5);
  return nearestDistance <= maximumGapMinutes * MINUTE_MS ? nearest : null;
}

function precipitationRate(point: ForecastPoint): number | undefined {
  const direct = finiteNumber(point.precipitationRateMmh);
  if (direct !== undefined) return Math.max(0, direct);
  const amount = finiteNumber(point.precipitationAmountMm);
  if (amount === undefined) return undefined;
  const intervalMinutes =
    inferredResolution(point) ?? point.resolutionMinutes ?? 60;
  return Math.max(0, amount) / Math.max(intervalMinutes / 60, 1 / 60);
}

function inferredResolution(point: ForecastPoint): number | undefined {
  if (!point.validTo) return undefined;
  const start = Date.parse(point.validAt);
  const end = Date.parse(point.validTo);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return undefined;
  }
  return (end - start) / MINUTE_MS;
}

function hasPrecipitation(point: ForecastPoint): boolean {
  return (
    finiteNumber(point.precipitationRateMmh) !== undefined ||
    finiteNumber(point.precipitationAmountMm) !== undefined ||
    probabilityRatio(point.precipitationProbability) !== undefined
  );
}

function apparentTemperature(point: ForecastPoint): number | undefined {
  return (
    finiteNumber(point.apparentTemperatureC) ?? finiteNumber(point.temperatureC)
  );
}

function effectiveWind(point: ForecastPoint): number | undefined {
  const sustained = finiteNumber(point.windSpeedMs);
  const gust = finiteNumber(point.windGustMs);
  if (sustained === undefined && gust === undefined) return undefined;
  return Math.max(sustained ?? 0, (gust ?? 0) * 0.7);
}

function probabilityRatio(value: number | undefined): number | undefined {
  const finite = finiteNumber(value);
  return finite === undefined ? undefined : clamp01(finite);
}

function explainCandidate(
  metrics: CommuteCandidate["metrics"],
  breakdown: ScoreBreakdown,
  confidence: number,
): string[] {
  const reasons: string[] = [];
  if (metrics.expectedWetnessMm !== null && metrics.expectedWetnessMm <= 0.05) {
    reasons.push("이동 중 예상 강수 노출이 거의 없습니다.");
  } else if (metrics.expectedWetnessMm !== null) {
    reasons.push(
      `이동 중 예상 강수 노출은 약 ${metrics.expectedWetnessMm.toFixed(2)} mm입니다.`,
    );
  } else {
    reasons.push("강수량 자료가 없어 보수적인 중립 위험을 적용했습니다.");
  }
  if (breakdown.apparentTemperature.risk >= 0.35) {
    reasons.push(
      `체감온도 ${metrics.apparentTemperatureC?.toFixed(1) ?? "--"}°C가 쾌적 범위를 벗어납니다.`,
    );
  }
  if (breakdown.wind.risk >= 0.35) {
    reasons.push(
      `이동 시간대 유효 풍속은 최대 ${metrics.effectiveWindSpeedMs?.toFixed(1) ?? "--"} m/s입니다.`,
    );
  }
  if (confidence < 0.45) {
    reasons.push("예보 신뢰도가 낮아 이 시각은 참고용으로 보아야 합니다.");
  } else {
    const primary = Object.values(breakdown).sort(
      (left, right) => right.contribution - left.contribution,
    )[0];
    reasons.push(`가장 큰 감점 요인은 ${primary.label}입니다.`);
  }
  return reasons;
}

function emptyRecommendation(
  direction: CommuteDirection,
  origin: PlaceKey,
  destination: PlaceKey,
): Recommendation {
  return {
    status: "no_candidates",
    direction,
    origin,
    destination,
    best: null,
    goodWindow: null,
    goodWindows: [],
    alternatives: [],
    candidates: [],
    headline: "추천을 계산할 수 없습니다",
    summary: "설정과 날씨 자료를 확인해 주세요.",
    reasons: [],
    assumptions: [],
  };
}

function directionPlaces(
  direction: CommuteDirection,
): readonly [PlaceKey, PlaceKey] {
  return direction === "outbound" ? ["home", "work"] : ["work", "home"];
}

function parseLocalTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError("local time must use HH:mm");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError("local time is invalid");
  return hour * 60 + minute;
}

function resolveWindow(
  date: CalendarDate,
  startMinute: number,
  endMinute: number,
  crossesMidnight: boolean,
  timezone: string,
) {
  const start = zonedDateTimeToUtc(
    date,
    Math.floor(startMinute / 60),
    startMinute % 60,
    timezone,
  );
  const endDate = crossesMidnight ? addCalendarDays(date, 1) : date;
  const end = zonedDateTimeToUtc(
    endDate,
    Math.floor(endMinute / 60),
    endMinute % 60,
    timezone,
  );
  return { start, end };
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function timeZoneOffsetMilliseconds(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function zonedDateTimeToUtc(
  date: CalendarDate,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const wallClockAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
  );
  let result = new Date(
    wallClockAsUtc -
      timeZoneOffsetMilliseconds(new Date(wallClockAsUtc), timezone),
  );
  result = new Date(
    wallClockAsUtc - timeZoneOffsetMilliseconds(result, timezone),
  );
  return result;
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + amount),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatLocalTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatGoodWindow(window: GoodWindow, timezone: string): string {
  const start = formatLocalTime(window.startAt, timezone);
  const end = formatLocalTime(window.endAt, timezone);
  return start === end ? start : `${start}–${end}`;
}

function isWithin(value: string, window: GoodWindow): boolean {
  const timestamp = Date.parse(value);
  return (
    timestamp >= Date.parse(window.startAt) &&
    timestamp <= Date.parse(window.endAt)
  );
}

function inferStepMinutes(candidates: CommuteCandidate[]): number {
  const differences = candidates
    .slice(1)
    .map(
      (candidate, index) =>
        (Date.parse(candidate.departureAt) -
          Date.parse(candidates[index].departureAt)) /
        MINUTE_MS,
    )
    .filter((difference) => difference > 0);
  return differences.length > 0 ? Math.min(...differences) : 10;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "높음";
  if (confidence >= 0.45) return "보통";
  return "낮음";
}

function definedNumbers(...values: Array<number | undefined>): number[] {
  return values.filter((value): value is number => value !== undefined);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp01((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function nullableRound(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}
