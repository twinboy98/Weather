"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommuteAdvice } from "@/components/CommuteAdvice";
import { KakaoCommuteMap } from "@/components/KakaoCommuteMap";
import { LocationWeatherCard } from "@/components/LocationWeatherCard";
import { RainWindowPanel } from "@/components/RainWindowPanel";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SettingsPanel } from "@/components/SettingsPanel";
import { recommendCommute } from "@/lib/commute";
import type { PlaceKey, ProviderId, WeatherBundleByPlace } from "@/lib/domain";
import { fetchWeather, getProviderInfo } from "@/lib/providers";
import {
  DEFAULT_CLIENT_STATE,
  hasSavedClientState,
  loadClientState,
  saveClientState,
  type ClientState,
} from "@/lib/storage";

const providers: Array<{ id: ProviderId; label: string }> = [
  { id: "met_norway", label: "MET Norway" },
  { id: "kma_forecast", label: "기상청" },
  { id: "windy", label: "Windy" },
  { id: "accuweather", label: "AccuWeather" },
];

function cloneClientState(state: ClientState): ClientState {
  return JSON.parse(JSON.stringify(state)) as ClientState;
}

export function Dashboard() {
  const [clientState, setClientState] =
    useState<ClientState>(DEFAULT_CLIENT_STATE);
  const [draftState, setDraftState] =
    useState<ClientState>(DEFAULT_CLIENT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [firstVisit, setFirstVisit] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bundles, setBundles] = useState<WeatherBundleByPlace>({});
  const [errors, setErrors] = useState<Partial<Record<PlaceKey, string>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = hasSavedClientState();
      const loaded = loadClientState();
      setClientState(loaded);
      setDraftState(cloneClientState(loaded));
      setFirstVisit(!saved);
      setSettingsOpen(!saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshWeather = useCallback(async () => {
    const home = clientState.settings.places.home;
    const work = clientState.settings.places.work;
    if (!home || !work) {
      setErrors({
        home: "집 위치를 설정해 주세요.",
        work: "회사 위치를 설정해 주세요.",
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    setErrors({});

    const config = {
      kmaServiceKey: clientState.api.kmaServiceKey,
      windyApiKey: clientState.api.windyApiKey,
      windyModel: clientState.api.windyModel,
      windyApiMode: clientState.api.windyApiMode,
      accuweatherProxyUrl: clientState.api.accuweatherProxyUrl,
    };
    const results = await Promise.allSettled([
      fetchWeather(clientState.settings.providerId, home, {
        config,
        signal: controller.signal,
      }),
      fetchWeather(clientState.settings.providerId, work, {
        config,
        signal: controller.signal,
      }),
    ]);
    if (controller.signal.aborted) return;

    const nextBundles: WeatherBundleByPlace = {};
    const nextErrors: Partial<Record<PlaceKey, string>> = {};
    (["home", "work"] as const).forEach((key, index) => {
      const result = results[index];
      if (result.status === "fulfilled") nextBundles[key] = result.value;
      else
        nextErrors[key] =
          result.reason instanceof Error
            ? result.reason.message
            : "날씨를 불러오지 못했습니다.";
    });
    setBundles(nextBundles);
    setErrors(nextErrors);
    setRefreshing(false);
  }, [clientState]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void refreshWeather(), 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [hydrated, refreshWeather]);

  const outbound = useMemo(
    () => recommendCommute(bundles, clientState.settings, "outbound"),
    [bundles, clientState.settings],
  );
  const inbound = useMemo(
    () => recommendCommute(bundles, clientState.settings, "inbound"),
    [bundles, clientState.settings],
  );
  const providerInfo = getProviderInfo(clientState.settings.providerId);
  const warnings = Array.from(
    new Set([
      ...(bundles.home?.warnings ?? []),
      ...(bundles.work?.warnings ?? []),
    ]),
  );
  const criticalWarnings = warnings.filter((warning) =>
    warning.includes("실제 의사결정에 사용할 수 없습니다"),
  );
  const noticeWarnings = warnings.filter(
    (warning) => !criticalWarnings.includes(warning),
  );

  function openSettings() {
    setDraftState(cloneClientState(clientState));
    setSettingsOpen(true);
  }

  function saveSettings() {
    saveClientState(draftState);
    window.location.reload();
  }

  function selectProvider(providerId: ProviderId) {
    const next = {
      ...clientState,
      settings: { ...clientState.settings, providerId },
    };
    saveClientState(next);
    setClientState(next);
    setBundles({});
  }

  return (
    <main className="mx-auto min-h-screen max-w-[90rem] px-3 pb-8 pt-3 sm:px-5 lg:px-7">
      <ServiceWorkerRegistration />

      <header className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-2.5 shadow-sm backdrop-blur-xl sm:px-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-900 text-sm font-black text-white shadow-sm"
            aria-hidden
          >
            비
          </span>
          <h1 className="text-lg font-black tracking-[-0.045em]">비긋기</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="provider">
            날씨 공급자
          </label>
          <select
            className="h-9 max-w-[9.5rem] rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 sm:max-w-none"
            id="provider"
            onChange={(event) =>
              selectProvider(event.target.value as ProviderId)
            }
            value={clientState.settings.providerId}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
          <button
            aria-label="날씨 새로고침"
            className="secondary-button h-9 min-h-0 px-3"
            disabled={refreshing}
            onClick={() => void refreshWeather()}
            type="button"
          >
            <span className={refreshing ? "animate-spin" : ""}>↻</span>
            <span className="hidden sm:inline">새로고침</span>
          </button>
          <button
            className="primary-button h-9 min-h-0 px-3"
            onClick={openSettings}
            type="button"
          >
            설정
          </button>
        </div>
      </header>

      {firstVisit && !settingsOpen && (
        <button
          className="mb-3 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-950"
          onClick={openSettings}
          type="button"
        >
          <strong>현재는 서울 샘플 위치입니다.</strong> 집과 회사를 지정하면 내
          출퇴근 시간으로 바뀝니다.{" "}
          <span className="font-extrabold underline">설정 열기</span>
        </button>
      )}

      {criticalWarnings.length > 0 && (
        <div
          className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold leading-5 text-rose-950"
          role="alert"
        >
          {criticalWarnings.map((warning) => (
            <p key={warning}>• {warning}</p>
          ))}
        </div>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.12fr)_minmax(22rem,0.88fr)]">
        <div className="min-w-0 space-y-3">
          <section
            className="grid gap-3 md:grid-cols-2"
            aria-label="추천 출퇴근 시간"
          >
            <CommuteAdvice direction="outbound" recommendation={outbound} />
            <CommuteAdvice direction="inbound" recommendation={inbound} />
          </section>

          <section
            className="grid gap-3 md:grid-cols-2"
            aria-label="집과 회사 날씨"
          >
            <LocationWeatherCard
              bundle={bundles.home}
              error={errors.home}
              kind="home"
              loading={refreshing}
            />
            <LocationWeatherCard
              bundle={bundles.work}
              error={errors.work}
              kind="work"
              loading={refreshing}
            />
          </section>
        </div>

        <div className="min-w-0 space-y-3">
          <KakaoCommuteMap
            appKey={clientState.api.kakaoMapsAppKey}
            home={clientState.settings.places.home}
            key={`commute-map:${Boolean(clientState.api.kakaoMapsAppKey)}:${clientState.settings.places.home?.latitude}:${clientState.settings.places.home?.longitude}:${clientState.settings.places.work?.latitude}:${clientState.settings.places.work?.longitude}`}
            travelMode={clientState.settings.travelMode}
            work={clientState.settings.places.work}
          />
          <RainWindowPanel
            home={bundles.home}
            homePlace={clientState.settings.places.home ?? undefined}
            inbound={inbound}
            outbound={outbound}
            radarApiHubKey={clientState.api.kmaApiHubKey}
            work={bundles.work}
            workPlace={clientState.settings.places.work ?? undefined}
          />
        </div>
      </div>

      {noticeWarnings.length > 0 && (
        <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-950">
          <summary className="flex min-h-9 cursor-pointer items-center justify-between gap-3 px-4 py-2 font-extrabold">
            <span>{providerInfo.label} 안내</span>
            <span className="font-bold text-amber-800">
              {noticeWarnings.length}건
            </span>
          </summary>
          <div
            className="space-y-1 border-t border-amber-200 px-4 py-2.5 leading-5"
            role="status"
          >
            {noticeWarnings.map((warning) => (
              <p key={warning}>• {warning}</p>
            ))}
          </div>
        </details>
      )}

      <footer className="mt-4 flex flex-col gap-1 border-t border-slate-200 pt-3 text-[0.65rem] leading-4 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          {bundles.home?.attribution ?? providerInfo.attribution}
          {bundles.work?.attribution &&
          bundles.work.attribution !== bundles.home?.attribution
            ? ` · ${bundles.work.attribution}`
            : ""}
        </p>
        <p className="sm:text-right">
          지도·장소 검색 © Kakao · 레이더·강수예측 © 기상청
        </p>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          onChange={setDraftState}
          onClose={() => setSettingsOpen(false)}
          onReset={() => setDraftState(cloneClientState(DEFAULT_CLIENT_STATE))}
          onSave={saveSettings}
          value={draftState}
        />
      )}
    </main>
  );
}
