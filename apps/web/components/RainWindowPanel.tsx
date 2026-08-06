"use client";

import { useMemo, useState } from "react";

import type { PlaceRef, Recommendation, WeatherBundle } from "@/lib/domain";

import { RadarMap } from "@/components/RadarMap";

type RainWindowPanelProps = {
  home?: WeatherBundle;
  homePlace?: PlaceRef;
  work?: WeatherBundle;
  workPlace?: PlaceRef;
  outbound: Recommendation;
  inbound: Recommendation;
  radarApiHubKey: string;
};

type RainCell = {
  time: string;
  probability: number | null;
  amount: number | null;
};

function kstHour(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function cells(bundle: WeatherBundle | undefined): RainCell[] {
  if (!bundle) return [];
  const now = Date.parse(bundle.fetchedAt) - 30 * 60 * 1000;
  return bundle.points
    .filter((point) => new Date(point.validAt).getTime() >= now)
    .slice(0, 12)
    .map((point) => ({
      time: point.validAt,
      probability: point.precipitationProbability ?? null,
      amount:
        point.precipitationAmountMm ??
        (point.precipitationRateMmh !== undefined
          ? point.precipitationRateMmh
          : null),
    }));
}

function rainRisk(cell: RainCell | undefined): number {
  if (!cell) return 0;
  const probability =
    cell.probability ?? (cell.amount && cell.amount > 0 ? 0.55 : 0);
  const amountRisk = cell.amount === null ? 0 : Math.min(1, cell.amount / 3);
  return Math.min(1, probability * 0.7 + amountRisk * 0.3);
}

function color(risk: number): string {
  if (risk < 0.08) return "#edf4f1";
  if (risk < 0.25) return "#cde9f7";
  if (risk < 0.5) return "#83bce9";
  if (risk < 0.75) return "#3f7bd4";
  return "#24458f";
}

function nextRainMessage(home: RainCell[], work: RainCell[]): string {
  const candidates = [...home, ...work]
    .filter((cell) => rainRisk(cell) >= 0.2)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  if (!candidates[0]) return "향후 12시간, 뚜렷한 비 신호가 없습니다.";
  const candidate = candidates[0];
  const probability =
    candidate.probability === null
      ? "강수 신호"
      : `강수확률 ${Math.round(candidate.probability * 100)}%`;
  return `${kstHour(candidate.time)}부터 ${probability}가 있습니다.`;
}

export function RainWindowPanel({
  home,
  homePlace,
  work,
  workPlace,
  outbound,
  inbound,
  radarApiHubKey,
}: RainWindowPanelProps) {
  const [view, setView] = useState<"timeline" | "radar">("timeline");
  const homeCells = useMemo(() => cells(home), [home]);
  const workCells = useMemo(() => cells(work), [work]);
  const timeline = homeCells.length >= workCells.length ? homeCells : workCells;
  const routeCells = timeline.map((item, index) => ({
    time: item.time,
    probability: average(
      homeCells[index]?.probability,
      workCells[index]?.probability,
    ),
    amount: average(homeCells[index]?.amount, workCells[index]?.amount),
  }));
  const recommendedTimes = [
    outbound.best?.departureAt,
    inbound.best?.departureAt,
  ].filter(Boolean) as string[];

  return (
    <section className="card p-4" aria-labelledby="rain-window-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="eyebrow">Rain window</p>
          <h2
            className="mt-1 text-xl font-black tracking-tight"
            id="rain-window-title"
          >
            비가 비켜가는 시간
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {nextRainMessage(homeCells, workCells)}
          </p>
        </div>
        <div
          className="inline-flex self-start rounded-xl bg-slate-100 p-1"
          aria-label="Rain window 보기 전환"
        >
          <button
            aria-pressed={view === "timeline"}
            className={`rounded-lg px-3 py-1.5 text-xs font-extrabold ${view === "timeline" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500"}`}
            onClick={() => setView("timeline")}
            type="button"
          >
            예보 타임라인
          </button>
          <button
            aria-pressed={view === "radar"}
            className={`rounded-lg px-3 py-1.5 text-xs font-extrabold ${view === "radar" ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500"}`}
            onClick={() => setView("radar")}
            type="button"
          >
            기상청 강수예측
          </button>
        </div>
      </div>

      {view === "timeline" ? (
        timeline.length ? (
          <div className="mt-3 overflow-x-auto pb-1">
            <div className="min-w-[31rem] sm:min-w-0">
              <div className="grid grid-cols-[3.75rem_repeat(12,minmax(0,1fr))] items-end gap-1 text-center text-[0.6rem] font-bold text-slate-500">
                <span className="text-left">KST</span>
                {timeline.map((cell) => (
                  <span key={cell.time}>{kstHour(cell.time)}</span>
                ))}
              </div>
              {(
                [
                  ["집", homeCells],
                  ["이동 중", routeCells],
                  ["회사", workCells],
                ] as const
              ).map(([label, row]) => (
                <div
                  className="mt-1.5 grid grid-cols-[3.75rem_repeat(12,minmax(0,1fr))] gap-1"
                  key={label}
                >
                  <span className="flex items-center text-[0.68rem] font-extrabold text-slate-700">
                    {label}
                  </span>
                  {timeline.map((timelineCell, index) => {
                    const cell = row[index];
                    const isRecommended = recommendedTimes.some(
                      (candidate) =>
                        Math.abs(
                          new Date(candidate).getTime() -
                            new Date(timelineCell.time).getTime(),
                        ) <
                        45 * 60 * 1000,
                    );
                    return (
                      <div
                        aria-label={`${label} ${kstHour(timelineCell.time)}, 강수확률 ${cell?.probability === null || cell?.probability === undefined ? "정보 없음" : `${Math.round(cell.probability * 100)}%`}`}
                        className="relative h-7 rounded-md border border-white/80"
                        key={timelineCell.time}
                        role="img"
                        style={{ backgroundColor: color(rainRisk(cell)) }}
                        title={`${label} ${kstHour(timelineCell.time)} · ${cell?.probability === null || cell?.probability === undefined ? "강수확률 정보 없음" : `${Math.round(cell.probability * 100)}%`}`}
                      >
                        {isRecommended && (
                          <span
                            className="absolute inset-x-0 top-1 text-center text-xs"
                            aria-label="추천 출발 시간"
                          >
                            ✦
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div className="mt-3 flex items-center justify-end gap-1.5 text-[0.6rem] text-slate-500">
                <span>건조</span>
                {[0, 0.2, 0.4, 0.65, 0.9].map((risk) => (
                  <span
                    className="h-3 w-7 rounded"
                    key={risk}
                    style={{ backgroundColor: color(risk) }}
                  />
                ))}
                <span>강한 비 신호</span>
                <span className="ml-3">✦ 추천 출발</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            날씨를 불러오면 집·이동 경로·회사의 강수 창을 표시합니다.
          </div>
        )
      ) : homePlace && workPlace ? (
        <div className="mt-4">
          <RadarMap
            apiHubKey={radarApiHubKey}
            home={{
              label: homePlace.address ?? homePlace.name,
              latitude: homePlace.latitude,
              longitude: homePlace.longitude,
            }}
            work={{
              label: workPlace.address ?? workPlace.name,
              latitude: workPlace.latitude,
              longitude: workPlace.longitude,
            }}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
          집과 회사 위치를 설정하면 기상청 강수예측을 볼 수 있습니다.
        </div>
      )}
    </section>
  );
}

function average(
  first: number | null | undefined,
  second: number | null | undefined,
): number | null {
  const values = [first, second].filter(
    (value): value is number =>
      value !== null && value !== undefined && Number.isFinite(value),
  );
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
