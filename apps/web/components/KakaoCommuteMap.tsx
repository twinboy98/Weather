"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PlaceRef, TravelMode } from "@/lib/domain";
import {
  loadKakaoMaps,
  type KakaoMap,
  type KakaoMapOverlay,
} from "@/lib/kakaoMaps";
import { kakaoInboundRouteUrl } from "@/lib/kakaoRoute";

type KakaoCommuteMapProps = {
  appKey: string;
  home: PlaceRef | null;
  travelMode: TravelMode;
  work: PlaceRef | null;
};

const modeLabel: Record<TravelMode, string> = {
  driving: "자동차",
  transit: "대중교통",
  walking: "도보",
  bicycling: "자전거",
};

export function KakaoCommuteMap({
  appKey,
  home,
  travelMode,
  work,
}: KakaoCommuteMapProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState("");
  const [retryAttempt, setRetryAttempt] = useState(0);
  const routeUrl = useMemo(
    () => kakaoInboundRouteUrl(home, work, travelMode),
    [home, travelMode, work],
  );

  useEffect(() => {
    if (!appKey || !home || !work) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    let container: HTMLDivElement | undefined;
    let overlays: KakaoMapOverlay[] = [];

    void loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled || !mapElementRef.current) return;
        container = mapElementRef.current;
        container.replaceChildren();

        const workPosition = new maps.LatLng(work.latitude, work.longitude);
        const homePosition = new maps.LatLng(home.latitude, home.longitude);
        const map: KakaoMap = new maps.Map(container, {
          center: new maps.LatLng(
            (work.latitude + home.latitude) / 2,
            (work.longitude + home.longitude) / 2,
          ),
          level: 6,
        });
        const workMarker = new maps.Marker({
          map,
          position: workPosition,
          title: "회사",
        });
        const homeMarker = new maps.Marker({
          map,
          position: homePosition,
          title: "집",
        });
        const routeLine = new maps.Polyline({
          map,
          path: [workPosition, homePosition],
          strokeColor: "#116b5b",
          strokeOpacity: 0.85,
          strokeStyle: "shortdash",
          strokeWeight: 5,
        });
        overlays = [workMarker, homeMarker, routeLine];

        const bounds = new maps.LatLngBounds();
        bounds.extend(workPosition);
        bounds.extend(homePosition);
        const fitMap = () => {
          map.relayout();
          map.setBounds(bounds, 52, 52, 52, 52);
        };
        fitMap();
        if ("ResizeObserver" in window) {
          observer = new ResizeObserver(fitMap);
          observer.observe(container);
        }
        setMapReady(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "카카오맵을 표시하지 못했습니다.",
        );
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      overlays.forEach((overlay) => overlay.setMap(null));
      container?.replaceChildren();
    };
  }, [appKey, home, retryAttempt, work]);

  function retryMap() {
    setError("");
    setMapReady(false);
    setRetryAttempt((attempt) => attempt + 1);
  }

  const canShowMap = Boolean(appKey && home && work);

  return (
    <section className="card overflow-hidden" aria-labelledby="inbound-route-title">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Kakao Map</p>
          <h2
            className="mt-1 text-xl font-black tracking-[-0.035em]"
            id="inbound-route-title"
          >
            퇴근 경로 <span className="text-emerald-700">회사 → 집</span>
          </h2>
          <p className="mt-1 truncate text-xs text-slate-500">
            {work?.address ?? "회사 미설정"} → {home?.address ?? "집 미설정"}
          </p>
        </div>
        {routeUrl && (
          <a
            className="primary-button min-h-0 shrink-0 px-3 py-2 text-xs"
            href={routeUrl}
            rel="noreferrer"
            target="_blank"
          >
            실제 길찾기 ↗
          </a>
        )}
      </div>

      <div className="relative border-y border-slate-100 bg-slate-100">
        {canShowMap ? (
          <>
            <div
              aria-busy={!mapReady && !error}
              aria-label="회사에서 집까지의 카카오 지도"
              className="h-[12rem] w-full"
              ref={mapElementRef}
              role="region"
            />
            {!mapReady && !error && (
              <div className="absolute inset-0 grid place-items-center bg-slate-100 text-xs font-bold text-slate-500" role="status">
                카카오맵을 불러오는 중…
              </div>
            )}
            {error && (
              <div className="absolute inset-0 grid place-items-center bg-amber-50 p-5 text-center text-xs leading-5 text-amber-950">
                <div>
                  <p role="alert">{error}</p>
                  <button
                    className="secondary-button mt-3 min-h-0 px-3 py-1.5 text-xs"
                    onClick={retryMap}
                    type="button"
                  >
                    다시 불러오기
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="grid h-[12rem] place-items-center bg-[radial-gradient(circle_at_top_left,_#dff2eb,_#eef3f1_55%,_#e4ece8)] p-5 text-center">
            <div>
              <p className="text-3xl" aria-hidden>⌖</p>
              <p className="mt-2 text-sm font-black text-slate-800">
                {home && work
                  ? "카카오 JavaScript 키를 설정해 주세요."
                  : "집과 회사를 먼저 설정해 주세요."}
              </p>
              {routeUrl && (
                <p className="mt-1 text-xs text-slate-500">
                  키 없이도 위 버튼으로 길찾기를 열 수 있습니다.
                </p>
              )}
            </div>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[0.65rem] font-black text-emerald-900 shadow-sm backdrop-blur">
          {modeLabel[travelMode]}
        </span>
      </div>

      <p className="px-4 py-2 text-[0.65rem] leading-4 text-slate-500">
        지도 선은 두 위치를 잇는 표시이며, 실제 경로는 카카오맵 길찾기에서 확인합니다.
      </p>
    </section>
  );
}
