"use client";

import { useEffect, useRef, useState } from "react";

export type PickedPlace = {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  placeId?: string;
};

type PlacePickerProps = {
  kind: "home" | "work";
  apiKey: string;
  value: PickedPlace;
  onChange: (place: PickedPlace) => void;
};

type GooglePlace = {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  location?: { lat(): number; lng(): number };
  fetchFields(options: { fields: string[] }): Promise<void>;
};

type PlaceAutocompleteNode = HTMLElement & {
  placeholder: string;
  includedRegionCodes?: string[];
  requestedLanguage?: string;
  requestedRegion?: string;
};

type GoogleMapsApi = {
  importLibrary(name: "places"): Promise<{
    PlaceAutocompleteElement: new () => PlaceAutocompleteNode;
  }>;
};

type GoogleWindow = Window & {
  google?: { maps: GoogleMapsApi };
};

let loaderPromise: Promise<GoogleMapsApi> | null = null;
let loaderKey = "";

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  const googleWindow = window as GoogleWindow;
  if (googleWindow.google?.maps) return Promise.resolve(googleWindow.google.maps);
  if (loaderPromise && loaderKey === apiKey) return loaderPromise;

  loaderKey = apiKey;
  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = "__weatherRouteMapsReady";
    const callbackWindow = window as unknown as Record<string, unknown>;
    callbackWindow[callbackName] = () => {
      const maps = (window as GoogleWindow).google?.maps;
      if (!maps) {
        reject(new Error("Google Maps 초기화에 실패했습니다."));
        return;
      }
      resolve(maps);
    };

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      libraries: "places",
      v: "weekly",
      language: "ko",
      region: "KR",
      loading: "async",
      callback: callbackName
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return loaderPromise;
}

export function PlacePicker({ kind, apiKey, value, onChange }: PlacePickerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const title = kind === "home" ? "집" : "회사";

  useEffect(() => {
    if (!apiKey || !hostRef.current) return;
    let disposed = false;
    const host = hostRef.current;
    host.replaceChildren();
    setStatus("Google 지도 검색을 준비하는 중…");

    void loadGoogleMaps(apiKey)
      .then(async (maps) => {
        const { PlaceAutocompleteElement } = await maps.importLibrary("places");
        if (disposed) return;
        const autocomplete = new PlaceAutocompleteElement();
        autocomplete.placeholder = `${title} 주소 또는 장소 검색`;
        autocomplete.includedRegionCodes = ["kr"];
        autocomplete.requestedLanguage = "ko";
        autocomplete.requestedRegion = "KR";
        autocomplete.addEventListener("gmp-select", (rawEvent: Event) => {
          const event = rawEvent as Event & {
            placePrediction?: { toPlace(): GooglePlace };
          };
          const prediction = event.placePrediction;
          if (!prediction) return;
          const place = prediction.toPlace();
          void place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location"] })
            .then(() => {
              if (!place.location) throw new Error("선택한 장소의 좌표가 없습니다.");
              onChange({
                label: title,
                address: place.formattedAddress ?? place.displayName ?? `${title} 위치`,
                latitude: place.location.lat(),
                longitude: place.location.lng(),
                placeId: place.id
              });
              setStatus(`${title} 위치를 선택했습니다.`);
            })
            .catch((reason: unknown) => setStatus(reason instanceof Error ? reason.message : "장소를 저장하지 못했습니다."));
        });
        host.appendChild(autocomplete);
        setStatus("");
      })
      .catch((reason: unknown) => setStatus(reason instanceof Error ? reason.message : "Google Maps를 불러오지 못했습니다."));

    return () => {
      disposed = true;
      host.replaceChildren();
    };
  }, [apiKey, onChange, title]);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("이 브라우저는 현재 위치를 지원하지 않습니다.");
      return;
    }
    setStatus("현재 위치를 확인하는 중…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          ...value,
          address: "현재 위치",
          latitude: Number(position.coords.latitude.toFixed(5)),
          longitude: Number(position.coords.longitude.toFixed(5)),
          placeId: undefined
        });
        setStatus(`${title}을 현재 위치로 지정했습니다.`);
      },
      () => setStatus("위치 권한이 없거나 현재 위치를 확인하지 못했습니다."),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 }
    );
  }

  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <legend className="font-black text-slate-900">{kind === "home" ? "🏠" : "🏢"} {title}</legend>
        <button className="text-xs font-extrabold text-emerald-800 underline decoration-emerald-300 underline-offset-4" onClick={useCurrentLocation} type="button">
          현재 위치 사용
        </button>
      </div>

      {apiKey ? (
        <div className="min-h-11" ref={hostRef} />
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Google Maps 브라우저 키를 입력하면 주소 자동완성을 사용할 수 있습니다. 지금은 좌표를 직접 입력할 수 있습니다.
        </p>
      )}

      <label className="mt-3 block text-xs font-bold text-slate-600">
        표시 주소
        <input
          className="control mt-1"
          onChange={(event) => onChange({ ...value, address: event.target.value })}
          placeholder={`${title} 주소`}
          value={value.address}
        />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-600">
          위도
          <input className="control mt-1" inputMode="decimal" onChange={(event) => onChange({ ...value, latitude: Number(event.target.value) })} step="any" type="number" value={value.latitude} />
        </label>
        <label className="text-xs font-bold text-slate-600">
          경도
          <input className="control mt-1" inputMode="decimal" onChange={(event) => onChange({ ...value, longitude: Number(event.target.value) })} step="any" type="number" value={value.longitude} />
        </label>
      </div>
      {status && <p className="mt-2 text-xs text-slate-500" role="status">{status}</p>}
    </fieldset>
  );
}
