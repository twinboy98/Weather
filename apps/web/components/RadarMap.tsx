"use client";

import { useMemo, useState } from "react";

type RadarLocation = {
  label: string;
  latitude: number;
  longitude: number;
};

type RadarMapProps = {
  home: RadarLocation;
  work: RadarLocation;
};

export function RadarMap({ home, work }: RadarMapProps) {
  const [focus, setFocus] = useState<"route" | "home" | "work">("route");
  const center = useMemo(() => {
    if (focus === "home") return home;
    if (focus === "work") return work;
    return {
      label: "이동 경로 중간",
      latitude: (home.latitude + work.latitude) / 2,
      longitude: (home.longitude + work.longitude) / 2
    };
  }, [focus, home, work]);

  const url = useMemo(() => {
    const params = new URLSearchParams({
      lat: center.latitude.toFixed(4),
      lon: center.longitude.toFixed(4),
      detailLat: center.latitude.toFixed(4),
      detailLon: center.longitude.toFixed(4),
      width: "900",
      height: "520",
      zoom: "9",
      level: "surface",
      overlay: "radar",
      product: "radar",
      menu: "",
      message: "true",
      marker: "true",
      calendar: "now",
      pressure: "",
      type: "map",
      location: "coordinates",
      detail: "false",
      metricWind: "m/s",
      metricTemp: "°C",
      metricRain: "mm",
      radarRange: "-1"
    });
    return `https://embed.windy.com/embed2.html?${params.toString()}`;
  }, [center]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-1" aria-label="레이더 중심 위치">
          {([
            ["route", "경로"],
            ["home", "집"],
            ["work", "회사"]
          ] as const).map(([value, label]) => (
            <button
              aria-pressed={focus === value}
              className={`rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${focus === value ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500"}`}
              key={value}
              onClick={() => setFocus(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Windy 레이더 · {center.label}</p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
        <iframe
          allowFullScreen
          className="h-[16rem] w-full border-0 sm:h-[18rem]"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          src={url}
          title={`${center.label}의 Windy 현재 강수 레이더`}
        />
      </div>
    </div>
  );
}
