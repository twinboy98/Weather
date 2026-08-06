import { describe, expect, it } from "vitest";

import {
  buildKmaRadarImageUrl,
  formatKmaRadarTime,
  kmaRadarBaseTimeCandidates,
  kmaRadarValidTime,
} from "../lib/kmaRadar";

describe("KMA radar image", () => {
  it("formats API timestamps in KST across a date boundary", () => {
    expect(formatKmaRadarTime(new Date("2026-08-05T15:05:00.000Z"))).toBe(
      "202608060005",
    );
  });

  it("selects a delayed ten-minute base and older fallbacks", () => {
    const candidates = kmaRadarBaseTimeCandidates(
      new Date("2026-08-06T06:37:45.000Z"),
      20,
      4,
    );

    expect(candidates.map((candidate) => candidate.toISOString())).toEqual([
      "2026-08-06T06:10:00.000Z",
      "2026-08-06T06:00:00.000Z",
      "2026-08-06T05:50:00.000Z",
      "2026-08-06T05:40:00.000Z",
    ]);
  });

  it("builds the official image endpoint and URL-encodes the API key", () => {
    const url = new URL(
      buildKmaRadarImageUrl({
        apiHubKey: " key+/=?& ",
        baseTime: new Date("2026-08-06T06:10:00.000Z"),
        forecastMinutes: 60,
      }),
    );

    expect(url.pathname).toBe("/api/typ03/cgi/rdr/nph-qpf_ana_img");
    expect(url.searchParams.get("tm")).toBe("202608061510");
    expect(url.searchParams.get("ef")).toBe("60");
    expect(url.searchParams.get("qpf")).toBe("M");
    expect(url.searchParams.get("authKey")).toBe("key+/=?&");
    expect(url.toString()).toContain("authKey=key%2B%2F%3D%3F%26");
  });

  it("calculates the displayed valid time", () => {
    expect(
      kmaRadarValidTime(new Date("2026-08-06T06:10:00.000Z"), 40).toISOString(),
    ).toBe("2026-08-06T06:50:00.000Z");
  });
});
