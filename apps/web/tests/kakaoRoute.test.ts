import { describe, expect, it } from "vitest";

import type { PlaceRef, TravelMode } from "../lib/domain";
import { kakaoInboundRouteUrl } from "../lib/kakaoRoute";

const home: PlaceRef = {
  key: "home",
  name: "집",
  address: "서울 집 주소",
  latitude: 37.51,
  longitude: 127.1,
};

const work: PlaceRef = {
  key: "work",
  name: "회사",
  address: "서울 회사 주소",
  latitude: 37.57,
  longitude: 126.97,
};

describe("Kakao inbound route URL", () => {
  it("builds the route from work to home", () => {
    const url = kakaoInboundRouteUrl(home, work, "transit");

    expect(url).toBe(
      "https://map.kakao.com/link/by/traffic/%EC%84%9C%EC%9A%B8%20%ED%9A%8C%EC%82%AC%20%EC%A3%BC%EC%86%8C,37.57,126.97/%EC%84%9C%EC%9A%B8%20%EC%A7%91%20%EC%A3%BC%EC%86%8C,37.51,127.1",
    );
  });

  it.each([
    ["driving", "car"],
    ["transit", "traffic"],
    ["walking", "walk"],
    ["bicycling", "bicycle"],
  ] as Array<[TravelMode, string]>)("maps %s to %s", (mode, kakaoMode) => {
    expect(kakaoInboundRouteUrl(home, work, mode)).toContain(
      `/link/by/${kakaoMode}/`,
    );
  });

  it("requires both places", () => {
    expect(kakaoInboundRouteUrl(home, null, "walking")).toBeUndefined();
    expect(kakaoInboundRouteUrl(null, work, "walking")).toBeUndefined();
  });
});
