"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommuteAdvice } from "@/components/CommuteAdvice";
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

function kakaoRouteUrl(state: ClientState): string | undefined {
  const home = state.settings.places.home;
  const work = state.settings.places.work;
  if (!home || !work) return undefined;
  const travelMode = {
    driving: "car",
    transit: "traffic",
    walking: "walk",
    bicycling: "bicycle",
  }[state.settings.travelMode];
  const origin = `${encodeURIComponent(home.address || home.name)},${home.latitude},${home.longitude}`;
  const destination = `${encodeURIComponent(work.address || work.name)},${work.latitude},${work.longitude}`;
  return `https://map.kakao.com/link/by/${travelMode}/${origin}/${destination}`;
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
  const routeUrl = kakaoRouteUrl(clientState);
  const warnings = Array.from(
    new Set([
      ...(bundles.home?.warnings ?? []),
      ...(bundles.work?.warnings ?? []),
    ]),
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
    <main className="mx-auto min-h-screen max-w-[90rem] px-4 pb-16 pt-4 sm:px-7 lg:px-10">
      <ServiceWorkerRegistration />

      <header className="mb-7 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl sm:px-5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-900 text-lg text-white shadow-sm"
            aria-hidden
          >
            ↗
          </span>
          <div>
            <p className="text-base font-black tracking-[-0.03em]">날씨길</p>
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.14em] text-slate-500">
              Weather Route
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="sr-only" htmlFor="provider">
            날씨 공급자
          </label>
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700"
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
            className="secondary-button h-10 min-h-0 px-3"
            disabled={refreshing}
            onClick={() => void refreshWeather()}
            type="button"
          >
            <span className={refreshing ? "animate-spin" : ""}>↻</span>
            <span className="hidden sm:inline">새로고침</span>
          </button>
          <button
            className="primary-button h-10 min-h-0"
            onClick={openSettings}
            type="button"
          >
            설정
          </button>
        </div>
      </header>

      <section className="mb-6 grid items-end gap-5 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="eyebrow">Commute weather planner</p>
          <h1 className="mt-2 max-w-4xl text-4xl font-black leading-[1.03] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
            집에서 회사까지,
            <br className="hidden sm:block" /> 비를 피하는 시간을 찾습니다.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            현재 날씨와 시간별 예보를 브라우저에서 계산해 출근과 퇴근에
            상대적으로 쾌적한 시간대를 알려드립니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-xs shadow-sm">
            <p className="font-extrabold text-slate-900">
              <span className="status-dot mr-2" />
              {providerInfo.label}
            </p>
            <p className="mt-1 text-slate-500">{providerInfo.description}</p>
          </div>
          {routeUrl && (
            <a
              className="secondary-button bg-white"
              href={routeUrl}
              rel="noreferrer"
              target="_blank"
            >
              카카오맵에서 경로 보기 ↗
            </a>
          )}
        </div>
      </section>

      {firstVisit && !settingsOpen && (
        <button
          className="mb-5 w-full rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-950"
          onClick={openSettings}
          type="button"
        >
          <strong>현재는 서울 샘플 위치입니다.</strong> 집과 회사를 지정하면 내
          출퇴근 시간으로 바뀝니다.{" "}
          <span className="font-extrabold underline">설정 열기</span>
        </button>
      )}

      {warnings.length > 0 && (
        <div
          className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950"
          role="status"
        >
          {warnings.map((warning) => (
            <p key={warning}>• {warning}</p>
          ))}
        </div>
      )}

      <section
        className="grid gap-4 lg:grid-cols-2"
        aria-label="추천 출퇴근 시간"
      >
        <CommuteAdvice direction="outbound" recommendation={outbound} />
        <CommuteAdvice direction="inbound" recommendation={inbound} />
      </section>

      <section
        className="mt-5 grid gap-5 lg:grid-cols-2"
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

      <div className="mt-5">
        <RainWindowPanel
          home={bundles.home}
          inbound={inbound}
          outbound={outbound}
          work={bundles.work}
        />
      </div>

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <article className="card p-5">
          <p className="eyebrow">Local first</p>
          <h2 className="mt-2 font-black">계산은 내 브라우저에서</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            추천 점수와 집·회사 설정은 서버 데이터베이스 없이 이 기기에서
            처리됩니다.
          </p>
        </article>
        <article className="card p-5">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 font-black">비 · 체감온도 · 바람</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            허용 시간대를 10분 후보로 나누고 두 장소의 이동 중 노출과 예보
            불확실성을 함께 점수화합니다.
          </p>
        </article>
        <article className="card p-5">
          <p className="eyebrow">Important</p>
          <h2 className="mt-2 font-black">안전 판단용이 아닙니다</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            기상특보·재난 상황에서는 추천보다 기상청과 관계기관의 공식 안내를
            우선하세요.
          </p>
        </article>
      </section>

      <footer className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-5 text-[0.68rem] leading-5 text-slate-500 sm:flex-row sm:items-start sm:justify-between">
        <p>
          {bundles.home?.attribution ?? providerInfo.attribution}
          {bundles.work?.attribution &&
          bundles.work.attribution !== bundles.home?.attribution
            ? ` · ${bundles.work.attribution}`
            : ""}
        </p>
        <p className="sm:text-right">
          장소 검색 © Kakao · Rain radar © Windy · 정확한 집·회사 주소와 API
          설정은 브라우저에만 저장
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
