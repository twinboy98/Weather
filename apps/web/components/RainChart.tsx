"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { type NowcastPoint, seoulTime } from "@/lib/api";

export function RainChart({ points }: { points: NowcastPoint[] }) {
  const data = points.map((point) => ({
    time: seoulTime(point.valid_at_utc),
    rate: point.precipitation_rate_mmh
  }));
  return (
    <div className="h-56 w-full" role="img" aria-label="향후 2시간 예상 강수강도 차트">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.52} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" stroke="#8daac533" vertical={false} />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} interval={2} axisLine={false} tickLine={false} />
          <YAxis unit=" mm/h" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} mm/h`, "강수강도"]} />
          <Area type="stepAfter" dataKey="rate" stroke="#2563eb" strokeWidth={2.5} fill="url(#rainFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

