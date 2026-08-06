import { describe, expect, it } from "vitest";

import {
  createSettingsBackupFilename,
  exportSettingsBackup,
  importSettingsBackup,
  SETTINGS_BACKUP_VERSION,
  SettingsBackupValidationError,
} from "../lib/settingsBackup";
import type { ClientState } from "../lib/storage";

function completeState(): ClientState {
  return {
    settings: {
      timezone: "Asia/Seoul",
      providerId: "met_norway",
      places: {
        home: {
          key: "home",
          placeId: " home-id ",
          name: " 우리 집 ",
          address: " 서울시 송파구 ",
          latitude: 37.51,
          longitude: 127.1,
        },
        work: {
          key: "work",
          name: " 회사 ",
          latitude: 37.57,
          longitude: 126.97,
        },
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
      comfortableApparentTemperatureC: { minimum: 10, maximum: 26 },
      scoreWeights: {
        precipitation: 0.55,
        apparentTemperature: 0.2,
        wind: 0.15,
        uncertainty: 0.1,
      },
    },
    api: {
      kakaoMapsAppKey: " kakao-secret ",
      kmaServiceKey: " kma-secret ",
      windyApiKey: " windy-secret ",
      windyModel: "icon",
      windyApiMode: "professional",
      accuweatherProxyUrl: " https://weather.example.test/proxy ",
    },
  };
}

function exportedDocument(): Record<string, unknown> {
  return JSON.parse(
    exportSettingsBackup(completeState(), new Date("2026-08-06T01:02:03.456Z"))
      .json,
  ) as Record<string, unknown>;
}

describe("settings backup export", () => {
  it("exports a versioned full state, including sanitized API configuration", () => {
    const result = exportSettingsBackup(
      completeState(),
      new Date("2026-08-06T01:02:03.456Z"),
    );
    const document = JSON.parse(result.json);

    expect(result.filename).toBe(
      "bigeutgi-settings-20260806T010203Z.json",
    );
    expect(document).toMatchObject({
      version: SETTINGS_BACKUP_VERSION,
      exportedAt: "2026-08-06T01:02:03.456Z",
      state: {
        settings: {
          places: {
            home: { name: "우리 집", placeId: "home-id" },
          },
        },
        api: {
          kakaoMapsAppKey: "kakao-secret",
          kmaServiceKey: "kma-secret",
          windyApiKey: "windy-secret",
          accuweatherProxyUrl: "https://weather.example.test/proxy",
        },
      },
    });
  });

  it("generates deterministic filenames and rejects invalid dates", () => {
    expect(
      createSettingsBackupFilename(new Date("2026-12-31T23:59:58.999Z")),
    ).toBe("bigeutgi-settings-20261231T235958Z.json");
    expect(() => createSettingsBackupFilename(new Date(Number.NaN))).toThrow(
      SettingsBackupValidationError,
    );
  });
});

describe("settings backup import", () => {
  it("round-trips the complete sanitized client state", () => {
    const exported = exportSettingsBackup(completeState()).json;
    const imported = importSettingsBackup(exported);

    expect(imported.api).toEqual({
      kakaoMapsAppKey: "kakao-secret",
      kmaServiceKey: "kma-secret",
      windyApiKey: "windy-secret",
      windyModel: "icon",
      windyApiMode: "professional",
      accuweatherProxyUrl: "https://weather.example.test/proxy",
    });
    expect(imported.settings.places.home?.name).toBe("우리 집");
  });

  it("drops unknown properties instead of letting them enter client state", () => {
    const document = exportedDocument();
    document.untrusted = "root";
    const state = document.state as Record<string, unknown>;
    state.untrusted = "state";
    const imported = importSettingsBackup(JSON.stringify(document));

    expect(imported).not.toHaveProperty("untrusted");
    expect(imported.settings).not.toHaveProperty("untrusted");
  });

  it.each([
    ["malformed JSON", "{oops"],
    ["empty input", "   "],
    ["wrong version", JSON.stringify({ ...exportedDocument(), version: 999 })],
  ])("rejects %s", (_label, input) => {
    expect(() => importSettingsBackup(input)).toThrow(
      SettingsBackupValidationError,
    );
  });

  it.each([
    ["invalid hour", "25:00"],
    ["invalid minute", "07:60"],
    ["missing leading zero", "7:00"],
  ])("rejects commute time: %s", (_label, time) => {
    const document = exportedDocument();
    const state = document.state as ClientState;
    state.settings.schedule.outbound.startLocalTime = time;

    expect(() => importSettingsBackup(JSON.stringify(document))).toThrow(
      /startLocalTime/,
    );
  });

  it("rejects unsupported weather providers", () => {
    const document = exportedDocument();
    const state = document.state as ClientState;
    state.settings.providerId =
      "unknown" as ClientState["settings"]["providerId"];

    expect(() => importSettingsBackup(JSON.stringify(document))).toThrow(
      /providerId/,
    );
  });

  it.each([
    ["non-finite latitude", 1e400, 127],
    ["latitude outside range", 91, 127],
    ["longitude outside range", 37, -181],
  ])("rejects %s", (_label, latitude, longitude) => {
    const document = exportedDocument();
    const state = document.state as ClientState;
    const home = state.settings.places.home!;
    home.latitude = latitude;
    home.longitude = longitude;

    expect(() => importSettingsBackup(JSON.stringify(document))).toThrow(
      SettingsBackupValidationError,
    );
  });

  it("rejects invalid nested configuration instead of filling defaults", () => {
    const document = exportedDocument();
    const state = document.state as Record<string, unknown>;
    delete state.api;

    expect(() => importSettingsBackup(JSON.stringify(document))).toThrow(
      /backup.state.api/,
    );
  });
});
