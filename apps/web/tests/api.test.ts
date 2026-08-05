import { describe, expect, it } from "vitest";

import { seoulTime } from "../lib/api";

describe("seoulTime", () => {
  it("renders UTC timestamps in Asia/Seoul", () => {
    expect(seoulTime("2026-08-03T00:00:00Z")).toBe("09:00");
  });
});

