"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  buildKmaRadarImageUrl,
  KMA_RADAR_FORECAST_MINUTES,
  kmaRadarBaseTimeCandidates,
  kmaRadarValidTime,
} from "@/lib/kmaRadar";

export type RadarLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

export type RadarMapProps = {
  home: RadarLocation;
  work: RadarLocation;
  apiHubKey?: string;
};

type ImageStatus = "loading" | "ready" | "error";

type RadarFrameProps = {
  apiHubKey: string;
  baseTimeCandidates: Date[];
  children: ReactNode;
  forecastMinutes: number;
  frameLabel: string;
  onExhausted: () => void;
  onRetry: () => void;
  routeLabel: string;
};

const kstTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function RadarMap({ home, work, apiHubKey = "" }: RadarMapProps) {
  const [forecastMinutes, setForecastMinutes] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [requestedAt, setRequestedAt] = useState(() => new Date());
  const normalizedKey = apiHubKey.trim();

  const baseTimeCandidates = useMemo(
    () => kmaRadarBaseTimeCandidates(requestedAt),
    [requestedAt],
  );

  useEffect(() => {
    if (!isPlaying || !normalizedKey) return;
    const timer = window.setTimeout(() => {
      if (forecastMinutes >= 60) {
        setIsPlaying(false);
        return;
      }
      setForecastMinutes(forecastMinutes + 10);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [forecastMinutes, isPlaying, normalizedKey]);

  if (!normalizedKey) {
    return (
      <div
        className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        role="status"
      >
        <p className="font-extrabold">기상청 강수예측 인증키가 필요합니다.</p>
        <p className="mt-1 text-xs leading-5 text-amber-900">
          설정에서 KMA API Hub 인증키를 입력하면 기준시각부터 60분 뒤까지의
          강수예측을 볼 수 있습니다.
        </p>
      </div>
    );
  }

  const frameLabel = forecastMinutes === 0 ? "기준" : `+${forecastMinutes}분`;
  const routeLabel = `${home.label} → ${work.label}`;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-extrabold text-slate-800">
            기상청 초단기 강수예측
          </p>
          <p
            className="mt-0.5 max-w-full truncate text-xs text-slate-500"
            title={routeLabel}
          >
            {routeLabel} · 전국 분포도
          </p>
        </div>
        <button
          aria-label={isPlaying ? "강수예측 재생 정지" : "강수예측 자동 재생"}
          className="inline-flex min-h-9 items-center justify-center self-start rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-emerald-800 shadow-sm transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          onClick={() => {
            if (isPlaying) {
              setIsPlaying(false);
              return;
            }
            if (forecastMinutes >= 60) setForecastMinutes(0);
            setIsPlaying(true);
          }}
          type="button"
        >
          <span aria-hidden="true" className="mr-1.5">
            {isPlaying ? "■" : "▶"}
          </span>
          {isPlaying ? "정지" : "재생"}
        </button>
      </div>

      <RadarFrame
        apiHubKey={normalizedKey}
        baseTimeCandidates={baseTimeCandidates}
        forecastMinutes={forecastMinutes}
        frameLabel={frameLabel}
        key={`${normalizedKey}:${forecastMinutes}:${requestedAt.getTime()}`}
        onExhausted={() => setIsPlaying(false)}
        onRetry={() => {
          setIsPlaying(false);
          setRequestedAt(new Date());
        }}
        routeLabel={routeLabel}
      >
        <label className="sr-only" htmlFor="kma-radar-time">
          강수예측 시간
        </label>
        <input
          aria-valuetext={frameLabel}
          className="mt-2 h-6 w-full accent-emerald-700"
          id="kma-radar-time"
          max="60"
          min="0"
          onChange={(event) => {
            setIsPlaying(false);
            setForecastMinutes(Number(event.target.value));
          }}
          step="10"
          type="range"
          value={forecastMinutes}
        />
        <div
          aria-hidden="true"
          className="flex justify-between text-[0.62rem] font-bold text-slate-400"
        >
          {KMA_RADAR_FORECAST_MINUTES.map((minutes) => (
            <span key={minutes}>{minutes === 0 ? "기준" : `+${minutes}`}</span>
          ))}
        </div>
      </RadarFrame>

      <p className="mt-2 text-right text-[0.62rem] text-slate-400">
        출처: 기상청 API Hub
      </p>
    </div>
  );
}

function RadarFrame({
  apiHubKey,
  baseTimeCandidates,
  children,
  forecastMinutes,
  frameLabel,
  onExhausted,
  onRetry,
  routeLabel,
}: RadarFrameProps) {
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [imageStatus, setImageStatus] = useState<ImageStatus>("loading");
  const baseTime = baseTimeCandidates[fallbackIndex] ?? baseTimeCandidates[0];
  const validTime = kmaRadarValidTime(baseTime, forecastMinutes);
  const imageUrl = buildKmaRadarImageUrl({
    apiHubKey,
    baseTime,
    forecastMinutes,
  });

  function handleImageError() {
    if (fallbackIndex < baseTimeCandidates.length - 1) {
      setFallbackIndex((current) => current + 1);
      setImageStatus("loading");
      return;
    }
    setImageStatus("error");
    onExhausted();
  }

  return (
    <>
      <div className="relative mt-3 min-h-64 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 sm:min-h-80">
        {/* The KMA endpoint is already a finished image; direct img loading also enables HTTP/decode error fallback without CORS. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={`${routeLabel} 기상청 강수예측, ${frameLabel}, ${kstTimeFormatter.format(validTime)} 예상`}
          className={`block h-auto max-h-[32rem] min-h-64 w-full object-contain transition-opacity sm:min-h-80 ${imageStatus === "ready" ? "opacity-100" : "opacity-0"}`}
          decoding="async"
          key={imageUrl}
          loading="eager"
          onError={handleImageError}
          onLoad={() => setImageStatus("ready")}
          referrerPolicy="no-referrer"
          src={imageUrl}
        />

        {imageStatus === "loading" && (
          <div
            className="absolute inset-0 grid place-items-center p-6 text-center"
            role="status"
          >
            <p className="text-sm font-bold text-slate-500">
              기상청 강수예측을 불러오는 중…
            </p>
          </div>
        )}

        {imageStatus === "error" && (
          <div
            className="absolute inset-0 grid place-items-center p-6 text-center"
            role="alert"
          >
            <div>
              <p className="text-sm font-extrabold text-slate-700">
                강수예측 이미지를 불러오지 못했습니다.
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                API 활용 신청 상태, 인증키와 네트워크 연결을 확인해 주세요.
              </p>
              <button
                className="mt-3 rounded-xl bg-slate-800 px-3 py-2 text-xs font-extrabold text-white"
                onClick={onRetry}
                type="button"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <output
            className="text-base font-black text-emerald-800"
            htmlFor="kma-radar-time"
            aria-live="polite"
          >
            예상 시각 {kstTimeFormatter.format(validTime)}
          </output>
          <span className="text-right text-[0.68rem] text-slate-500">
            {frameLabel} · 기준 {kstTimeFormatter.format(baseTime)}
            {fallbackIndex > 0 ? " (이전 자료)" : ""}
          </span>
        </div>
        <p className="mt-1 text-[0.68rem] text-slate-500">
          +N분은 표시된 기준시각으로부터 N분 뒤의 예측입니다.
        </p>
        {children}
      </div>
    </>
  );
}
