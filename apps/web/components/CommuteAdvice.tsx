import type { CommuteDirection, Recommendation } from "@/lib/domain";

type CommuteAdviceProps = {
  direction: CommuteDirection;
  recommendation: Recommendation;
};

function time(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function date(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(value));
}

function metric(value: number | null, suffix: string, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "정보 없음" : `${value.toFixed(digits)}${suffix}`;
}

export function CommuteAdvice({ direction, recommendation }: CommuteAdviceProps) {
  const outbound = direction === "outbound";
  const best = recommendation.best;
  const label = outbound ? "Best time to go" : "Best time to leave";
  const koreanLabel = outbound ? "출근" : "퇴근";
  const accent = outbound ? "bg-emerald-950" : "bg-blue-950";

  if (!best) {
    return (
      <article className={`relative overflow-hidden rounded-2xl p-4 text-white ${accent}`}>
        <p className="text-[0.7rem] font-black uppercase tracking-[0.14em] text-white/60">{label}</p>
        <h2 className="mt-2 text-xl font-black">{koreanLabel} 추천 준비 중</h2>
        <p className="mt-2 max-w-md text-xs leading-5 text-white/70">{recommendation.summary}</p>
      </article>
    );
  }

  const window = recommendation.goodWindow;
  const scoreTone = best.score >= 80 ? "bg-emerald-300 text-emerald-950" : best.score >= 60 ? "bg-amber-300 text-amber-950" : "bg-rose-300 text-rose-950";

  return (
    <article className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-lg ${accent}`}>
      <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/5" aria-hidden />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.7rem] font-black uppercase tracking-[0.14em] text-white/60">{label}</p>
            <p className="mt-1 text-xs font-bold text-white/60">{date(best.departureAt)} · {koreanLabel}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${scoreTone}`}>{best.score}점</span>
        </div>

        <div className="mt-3">
          <p className="text-3xl font-black tracking-[-0.06em] sm:text-4xl">
            {window ? `${time(window.startAt)}–${time(window.endAt)}` : time(best.departureAt)}
          </p>
          <p className="mt-2 text-sm font-bold text-white/70">
            {time(best.departureAt)} 출발 · {time(best.arrivalAt)} 도착 · 약 {best.durationMinutes}분
          </p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-[0.62rem] font-bold text-white/50">예상 비 노출</p>
            <p className="mt-1 text-sm font-black">{metric(best.metrics.expectedWetnessMm, " mm", 2)}</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-[0.62rem] font-bold text-white/50">최대 강수확률</p>
            <p className="mt-1 text-sm font-black">{best.metrics.maximumPrecipitationProbability === null ? "정보 없음" : `${Math.round(best.metrics.maximumPrecipitationProbability * 100)}%`}</p>
          </div>
          <div className="rounded-xl bg-white/10 p-2">
            <p className="text-[0.62rem] font-bold text-white/50">신뢰도</p>
            <p className="mt-1 text-sm font-black">{Math.round(best.confidence * 100)}%</p>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 border-t border-white/10 pt-3 text-[0.68rem] leading-4 text-white/65">
          {best.reasons[0] ?? recommendation.reasons[0] ?? recommendation.summary}
        </p>
      </div>
    </article>
  );
}
