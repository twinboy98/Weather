import { describe, expect, it } from "vitest";

import {
  generateCandidateTimes,
  groupGoodWindows,
  recommendCommute,
} from "../lib/commute";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ForecastPoint,
  type PlaceRef,
  type WeatherBundle,
} from "../lib/domain";

const home: PlaceRef = {
  key: "home",
  placeId: "home-place",
  name: "집",
  latitude: 37.55,
  longitude: 126.98,
};

const work: PlaceRef = {
  key: "work",
  placeId: "work-place",
  name: "회사",
  latitude: 37.5,
  longitude: 127.03,
};

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    places: { home, work },
    schedule: {
      ...DEFAULT_SETTINGS.schedule,
      outbound: {
        startLocalTime: "07:00",
        endLocalTime: "07:30",
        travelMinutes: 10,
      },
    },
    scoreWeights: { ...DEFAULT_SETTINGS.scoreWeights },
    comfortableApparentTemperatureC: {
      ...DEFAULT_SETTINGS.comfortableApparentTemperatureC,
    },
    ...overrides,
  };
}

function point(
  validAt: string,
  overrides: Partial<ForecastPoint> = {},
): ForecastPoint {
  return {
    validAt,
    temperatureC: 20,
    apparentTemperatureC: 20,
    precipitationRateMmh: 0,
    precipitationProbability: 0,
    windSpeedMs: 1,
    confidence: 1,
    sourceAgeMinutes: 0,
    resolutionMinutes: 10,
    ...overrides,
  };
}

function bundle(
  placeRef: PlaceRef,
  points: ForecastPoint[],
  overrides: Partial<WeatherBundle> = {},
): WeatherBundle {
  return {
    providerId: "met_norway",
    place: placeRef,
    fetchedAt: "2026-08-04T21:50:00.000Z",
    issuedAt: "2026-08-04T21:50:00.000Z",
    points,
    attribution: "Weather data from MET Norway",
    ...overrides,
  };
}

describe("generateCandidateTimes", () => {
  it("generates an inclusive local-time range in Asia/Seoul", () => {
    const candidates = generateCandidateTimes(
      {
        startLocalTime: "07:00",
        endLocalTime: "07:30",
        travelMinutes: 30,
      },
      new Date("2026-08-04T21:30:00.000Z"), // 06:30 KST
      "Asia/Seoul",
      10,
    );

    expect(candidates.map((candidate) => candidate.toISOString())).toEqual([
      "2026-08-04T22:00:00.000Z",
      "2026-08-04T22:10:00.000Z",
      "2026-08-04T22:20:00.000Z",
      "2026-08-04T22:30:00.000Z",
    ]);
  });

  it("continues an overnight window after midnight instead of skipping a day", () => {
    const candidates = generateCandidateTimes(
      {
        startLocalTime: "22:30",
        endLocalTime: "00:30",
        travelMinutes: 30,
      },
      new Date("2026-08-05T15:05:00.000Z"), // 00:05 KST
      "Asia/Seoul",
      10,
    );

    expect(candidates.map((candidate) => candidate.toISOString())).toEqual([
      "2026-08-05T15:10:00.000Z",
      "2026-08-05T15:20:00.000Z",
      "2026-08-05T15:30:00.000Z",
    ]);
  });

  it("preserves a non-step-aligned end boundary", () => {
    const candidates = generateCandidateTimes(
      {
        startLocalTime: "07:00",
        endLocalTime: "07:25",
        travelMinutes: 30,
      },
      new Date("2026-08-04T21:30:00.000Z"),
      "Asia/Seoul",
      10,
    );

    expect(candidates.at(-1)?.toISOString()).toBe("2026-08-04T22:25:00.000Z");
  });
});

describe("recommendCommute", () => {
  it("selects a dry contiguous good window and explains the score", () => {
    const timestamps = [
      "2026-08-04T22:00:00.000Z",
      "2026-08-04T22:10:00.000Z",
      "2026-08-04T22:20:00.000Z",
      "2026-08-04T22:30:00.000Z",
      "2026-08-04T22:40:00.000Z",
    ];
    const rainy = new Set(timestamps.slice(0, 2));
    const makePoints = () =>
      timestamps.map((timestamp) =>
        point(
          timestamp,
          rainy.has(timestamp)
            ? {
                precipitationRateMmh: 8,
                precipitationProbability: 0.9,
              }
            : {},
        ),
      );
    const result = recommendCommute(
      {
        home: bundle(home, makePoints()),
        work: bundle(work, makePoints()),
      },
      settings(),
      "outbound",
      new Date("2026-08-04T21:50:00.000Z"),
    );

    expect(result.status).toBe("ready");
    expect(result.best?.departureAt).toBe("2026-08-04T22:30:00.000Z");
    expect(result.goodWindow).toMatchObject({
      startAt: "2026-08-04T22:20:00.000Z",
      endAt: "2026-08-04T22:30:00.000Z",
      candidateCount: 2,
    });
    expect(result.headline).toContain("07:20–07:30");
    expect(result.best?.breakdown.precipitation).toMatchObject({
      risk: 0,
      label: "강수",
    });
    expect(result.best?.reasons[0]).toContain("강수 노출이 거의 없습니다");
    expect(result.candidates[0].score).toBeLessThan(result.best!.score);
  });

  it("scores heat, wind and low-confidence forecasts as explicit penalties", () => {
    const hotAndUncertain = point("2026-08-04T22:00:00.000Z", {
      apparentTemperatureC: 40,
      windSpeedMs: 14,
      windGustMs: 20,
      confidence: 0.2,
    });
    const destination = point("2026-08-04T22:10:00.000Z", {
      apparentTemperatureC: 40,
      windSpeedMs: 14,
      windGustMs: 20,
      confidence: 0.2,
    });
    const result = recommendCommute(
      {
        home: bundle(home, [hotAndUncertain]),
        work: bundle(work, [destination]),
      },
      {
        ...settings(),
        schedule: {
          ...settings().schedule,
          outbound: {
            startLocalTime: "07:00",
            endLocalTime: "07:00",
            travelMinutes: 10,
          },
        },
        travelMode: "walking",
      },
      "outbound",
      new Date("2026-08-04T21:50:00.000Z"),
    );

    expect(result.status).toBe("ready");
    expect(result.best?.breakdown.apparentTemperature.risk).toBe(1);
    expect(result.best?.breakdown.wind.risk).toBeGreaterThan(0.9);
    expect(result.best?.breakdown.uncertainty.risk).toBeGreaterThan(0.5);
    expect(result.best?.reasons.join(" ")).toContain("예보 신뢰도가 낮아");
  });

  it("turns interval precipitation amounts into an overlap-compatible rate", () => {
    const accumulation = point("2026-08-04T22:00:00.000Z", {
      validTo: "2026-08-05T01:00:00.000Z",
      precipitationRateMmh: undefined,
      precipitationAmountMm: 3,
      resolutionMinutes: 180,
    });
    const result = recommendCommute(
      {
        home: bundle(home, [accumulation]),
        work: bundle(work, [accumulation]),
      },
      {
        ...settings(),
        schedule: {
          ...settings().schedule,
          outbound: {
            startLocalTime: "07:00",
            endLocalTime: "07:00",
            travelMinutes: 60,
          },
        },
        travelMode: "walking",
      },
      "outbound",
      new Date("2026-08-04T21:50:00.000Z"),
    );

    expect(result.best?.metrics.expectedWetnessMm).toBe(1);
    expect(result.best?.metrics.peakPrecipitationRateMmh).toBe(1);
    expect(result.best?.breakdown.precipitation.risk).toBeGreaterThan(0);
  });

  it("reverses origin and destination for the evening commute", () => {
    const eveningSettings = {
      ...settings(),
      schedule: {
        ...settings().schedule,
        inbound: {
          startLocalTime: "18:00",
          endLocalTime: "18:00",
          travelMinutes: 10,
        },
      },
    };
    const result = recommendCommute(
      {
        home: bundle(home, [point("2026-08-05T09:10:00.000Z")]),
        work: bundle(work, [point("2026-08-05T09:00:00.000Z")]),
      },
      eveningSettings,
      "inbound",
      new Date("2026-08-05T08:50:00.000Z"),
    );

    expect(result.status).toBe("ready");
    expect(result.origin).toBe("work");
    expect(result.destination).toBe("home");
  });

  it("returns an actionable state instead of throwing when weather is missing", () => {
    const result = recommendCommute(
      { home: bundle(home, []) },
      settings(),
      "outbound",
      new Date("2026-08-04T21:50:00.000Z"),
    );

    expect(result.status).toBe("missing_weather");
    expect(result.best).toBeNull();
    expect(result.headline).toContain("날씨 자료");
  });
});

describe("groupGoodWindows", () => {
  it("separates equally good candidates when a poor slot breaks continuity", () => {
    const timestamps = [
      "2026-08-04T22:00:00.000Z",
      "2026-08-04T22:10:00.000Z",
      "2026-08-04T22:20:00.000Z",
    ];
    const makePoints = () => timestamps.map((timestamp) => point(timestamp));
    const recommendation = recommendCommute(
      {
        home: bundle(home, makePoints()),
        work: bundle(work, [
          ...makePoints(),
          point("2026-08-04T22:30:00.000Z"),
        ]),
      },
      {
        ...settings(),
        schedule: {
          ...settings().schedule,
          outbound: {
            startLocalTime: "07:00",
            endLocalTime: "07:20",
            travelMinutes: 10,
          },
        },
      },
      "outbound",
      new Date("2026-08-04T21:50:00.000Z"),
    );
    const candidates = recommendation.candidates.map((candidate, index) => ({
      ...candidate,
      score: index === 1 ? candidate.score - 20 : candidate.score,
    }));

    expect(groupGoodWindows(candidates, 3, 10)).toHaveLength(2);
  });
});
