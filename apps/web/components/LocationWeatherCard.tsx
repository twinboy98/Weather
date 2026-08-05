import type { PlaceKey, WeatherBundle } from "@/lib/domain";

import { WeatherGlyph } from "@/components/WeatherGlyph";

type LocationWeatherCardProps = {
  kind: PlaceKey;
  bundle?: WeatherBundle;
  error?: string;
  loading?: boolean;
};

function number(value: number | undefined, digits = 0): string {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function providerLabel(bundle: WeatherBundle): string {
  const names = {
    kma_forecast: "기상청 단기예보",
    met_norway: "MET Norway",
    windy: "Windy Point Forecast",
    accuweather: "AccuWeather",
  };
  return names[bundle.providerId];
}

export function LocationWeatherCard({ kind, bundle, error, loading }: LocationWeatherCardProps) {
  const title = kind === "home" ? "집" : "회사";
  const current = bundle?.current ?? bundle?.points[0];
  const referenceTime = bundle ? Date.parse(bundle.fetchedAt) : 0;
  const future = bundle?.points
    .filter((point) => new Date(point.validAt).getTime() >= referenceTime - 30 * 60 * 1000)
    .slice(0, 6) ?? [];

  if (loading && !bundle) {
    return (
      <article className="card min-h-[25rem] p-5" aria-label={`${title} 날씨를 불러오는 중`}>
        <div className="skeleton h-4 w-24 rounded" />
        <div className="mt-8 flex items-center gap-4">
          <div className="skeleton h-20 w-20 rounded-2xl" />
          <div className="skeleton h-16 w-32 rounded-xl" />
        </div>
        <div className="skeleton mt-8 h-32 rounded-2xl" />
      </article>
    );
  }

  return (
    <article className="card overflow-hidden p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{kind === "home" ? "At home" : "At work"}</p>
          <h2 className="mt-1 text-xl font-black tracking-tight">{title}</h2>
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{bundle?.place.address ?? bundle?.place.name ?? "위치를 설정해 주세요"}</p>
        </div>
        {current && <WeatherGlyph condition={current.conditionCode} size="lg" />}
      </div>

      {error && !current ? (
        <div className="mt-8 rounded-2xl bg-red-50 p-4 text-sm leading-6 text-red-800" role="alert">
          <p className="font-extrabold">날씨를 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
      ) : current ? (
        <>
          <div className="mt-6 flex items-end justify-between gap-3">
            <div>
              <p className="text-5xl font-black tracking-[-0.07em]">{number(current.temperatureC, 1)}°</p>
              <p className="mt-2 text-sm font-bold text-slate-600">
                체감 {number(current.apparentTemperatureC ?? current.temperatureC, 1)}° · 습도 {number(current.relativeHumidityPercent)}%
              </p>
            </div>
            <div className="text-right text-xs leading-5 text-slate-500">
              <p>바람 {number(current.windSpeedMs, 1)} m/s</p>
              <p>강수 {number(current.precipitationProbability !== undefined ? current.precipitationProbability * 100 : undefined)}%</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-6 gap-1 rounded-2xl bg-slate-50 p-3">
            {future.map((point) => (
              <div className="min-w-0 text-center" key={point.validAt}>
                <p className="text-[0.65rem] font-bold text-slate-500">{timeLabel(point.validAt)}</p>
                <div className="my-2 flex justify-center"><WeatherGlyph condition={point.conditionCode} size="sm" /></div>
                <p className="text-xs font-black">{number(point.temperatureC)}°</p>
                <p className="mt-1 text-[0.62rem] font-bold text-blue-700">{number(point.precipitationProbability !== undefined ? point.precipitationProbability * 100 : undefined)}%</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-8 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">위치와 날씨 공급자를 설정해 주세요.</div>
      )}

      {bundle && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[0.67rem] text-slate-500">
          <span>{providerLabel(bundle)}{bundle.providerId === "windy" ? " · 현재 시각 모델 예측" : ""}</span>
          <span>{bundle.isDemo ? "데모 자료" : `갱신 ${timeLabel(bundle.fetchedAt)}`}</span>
        </div>
      )}
    </article>
  );
}
