import type { PlaceRef, TravelMode } from "./domain";

export const KAKAO_ROUTE_MODE: Record<TravelMode, string> = {
  driving: "car",
  transit: "traffic",
  walking: "walk",
  bicycling: "bicycle",
};

function routePoint(place: PlaceRef): string {
  const label = encodeURIComponent(place.address || place.name);
  return `${label},${place.latitude},${place.longitude}`;
}

export function kakaoInboundRouteUrl(
  home: PlaceRef | null,
  work: PlaceRef | null,
  travelMode: TravelMode,
): string | undefined {
  if (!home || !work) return undefined;
  return `https://map.kakao.com/link/by/${KAKAO_ROUTE_MODE[travelMode]}/${routePoint(work)}/${routePoint(home)}`;
}
