"use client";

import { type FormEvent, useRef, useState } from "react";

export type PickedPlace = {
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  placeId?: string;
};

type PlacePickerProps = {
  kind: "home" | "work";
  appKey: string;
  value: PickedPlace;
  onChange: (place: PickedPlace) => void;
};

type KakaoPlaceDocument = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  place_url?: string;
  x: string;
  y: string;
};

type KakaoAddressDocument = {
  address_name: string;
  x: string;
  y: string;
  address?: { address_name?: string };
  road_address?: { address_name?: string } | null;
};

type KakaoCoordAddressDocument = {
  address?: { address_name?: string };
  road_address?: { address_name?: string } | null;
};

type KakaoMapsApi = {
  load(callback: () => void): void;
  services: {
    Status: { OK: string; ZERO_RESULT: string; ERROR: string };
    Places: new () => {
      keywordSearch(
        keyword: string,
        callback: (result: KakaoPlaceDocument[], status: string) => void,
        options?: { size?: number },
      ): void;
    };
    Geocoder: new () => {
      addressSearch(
        address: string,
        callback: (result: KakaoAddressDocument[], status: string) => void,
      ): void;
      coord2Address(
        longitude: number,
        latitude: number,
        callback: (result: KakaoCoordAddressDocument[], status: string) => void,
      ): void;
    };
  };
};

type KakaoWindow = Window & {
  kakao?: { maps?: KakaoMapsApi };
};

type SearchResult = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

let loaderPromise: Promise<KakaoMapsApi> | null = null;
let loaderKey = "";

function loadKakaoMaps(appKey: string): Promise<KakaoMapsApi> {
  const kakaoWindow = window as KakaoWindow;
  if (loaderKey && loaderKey !== appKey) {
    return Promise.reject(
      new Error(
        "카카오 JavaScript 키를 바꿨습니다. 설정을 저장한 뒤 페이지를 새로고침해 주세요.",
      ),
    );
  }
  if (kakaoWindow.kakao?.maps?.services) {
    loaderKey = appKey;
    return Promise.resolve(kakaoWindow.kakao.maps);
  }
  if (loaderPromise && loaderKey === appKey) return loaderPromise;

  loaderKey = appKey;
  loaderPromise = new Promise((resolve, reject) => {
    const fail = (message: string) => {
      loaderPromise = null;
      if (loaderKey === appKey) loaderKey = "";
      reject(new Error(message));
    };
    const script = document.createElement("script");
    const params = new URLSearchParams({
      appkey: appKey,
      libraries: "services",
      autoload: "false",
    });
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?${params.toString()}`;
    script.async = true;
    script.dataset.weatherRouteKakao = "true";
    script.onload = () => {
      const maps = (window as KakaoWindow).kakao?.maps;
      if (!maps) {
        fail(
          "카카오맵 인증에 실패했습니다. JavaScript 키와 허용 도메인을 확인해 주세요.",
        );
        return;
      }
      maps.load(() => {
        if (!maps.services) {
          fail("카카오맵 장소 검색 서비스를 초기화하지 못했습니다.");
          return;
        }
        resolve(maps);
      });
    };
    script.onerror = () =>
      fail(
        "카카오맵 스크립트를 불러오지 못했습니다. 키·도메인·네트워크를 확인해 주세요.",
      );
    document.head.appendChild(script);
  });
  return loaderPromise;
}

function searchKeyword(
  maps: KakaoMapsApi,
  query: string,
): Promise<KakaoPlaceDocument[]> {
  return new Promise((resolve, reject) => {
    const places = new maps.services.Places();
    places.keywordSearch(
      query,
      (result, status) => {
        if (status === maps.services.Status.OK) resolve(result);
        else if (status === maps.services.Status.ZERO_RESULT) resolve([]);
        else
          reject(
            new Error(
              "카카오맵 장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            ),
          );
      },
      { size: 8 },
    );
  });
}

function searchAddress(
  maps: KakaoMapsApi,
  query: string,
): Promise<KakaoAddressDocument[]> {
  return new Promise((resolve, reject) => {
    const geocoder = new maps.services.Geocoder();
    geocoder.addressSearch(query, (result, status) => {
      if (status === maps.services.Status.OK) resolve(result);
      else if (status === maps.services.Status.ZERO_RESULT) resolve([]);
      else
        reject(
          new Error(
            "카카오맵 주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.",
          ),
        );
    });
  });
}

function addressForCoordinate(
  maps: KakaoMapsApi,
  latitude: number,
  longitude: number,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const geocoder = new maps.services.Geocoder();
    geocoder.coord2Address(longitude, latitude, (result, status) => {
      if (status === maps.services.Status.OK) {
        const first = result[0];
        resolve(
          first?.road_address?.address_name ?? first?.address?.address_name,
        );
      } else if (status === maps.services.Status.ZERO_RESULT)
        resolve(undefined);
      else reject(new Error("현재 위치의 주소를 찾지 못했습니다."));
    });
  });
}

export function PlacePicker({
  kind,
  appKey,
  value,
  onChange,
}: PlacePickerProps) {
  const [query, setQuery] = useState(value.address);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState("");
  const locationRequestRef = useRef(0);
  const title = kind === "home" ? "집" : "회사";

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setStatus("검색할 장소명이나 주소를 입력해 주세요.");
      return;
    }
    setSearching(true);
    setResults([]);
    setStatus("카카오맵에서 검색하는 중…");
    try {
      const maps = await loadKakaoMaps(appKey);
      const places = await searchKeyword(maps, trimmed);
      const nextResults: SearchResult[] = places.map((place) => ({
        id: place.id,
        name: place.place_name,
        address:
          place.road_address_name || place.address_name || place.place_name,
        latitude: Number(place.y),
        longitude: Number(place.x),
      }));

      if (nextResults.length === 0) {
        const addresses = await searchAddress(maps, trimmed);
        nextResults.push(
          ...addresses.map((address) => ({
            id: `address:${address.x}:${address.y}`,
            name:
              address.road_address?.address_name ??
              address.address?.address_name ??
              address.address_name,
            address:
              address.road_address?.address_name ??
              address.address?.address_name ??
              address.address_name,
            latitude: Number(address.y),
            longitude: Number(address.x),
          })),
        );
      }

      setResults(nextResults);
      setStatus(
        nextResults.length > 0
          ? `${nextResults.length}곳을 찾았습니다. 알맞은 위치를 선택해 주세요.`
          : "검색 결과가 없습니다. 더 구체적인 주소로 다시 검색해 주세요.",
      );
    } catch (reason: unknown) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "카카오맵 검색을 완료하지 못했습니다.",
      );
    } finally {
      setSearching(false);
    }
  }

  function selectResult(result: SearchResult) {
    onChange({
      label: title,
      address: result.address,
      latitude: result.latitude,
      longitude: result.longitude,
      placeId: result.id,
    });
    setQuery(result.name);
    setResults([]);
    setStatus(`${title} 위치를 선택했습니다.`);
  }

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("이 브라우저는 현재 위치를 지원하지 않습니다.");
      return;
    }
    const requestId = locationRequestRef.current + 1;
    locationRequestRef.current = requestId;
    setStatus("현재 위치를 확인하는 중…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== locationRequestRef.current) return;
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const currentPlace: PickedPlace = {
          ...value,
          address: "현재 위치",
          latitude,
          longitude,
          placeId: undefined,
        };
        setQuery("현재 위치");
        setResults([]);
        onChange(currentPlace);
        setStatus(`${title}을 현재 위치로 지정했습니다.`);

        if (appKey) {
          void loadKakaoMaps(appKey)
            .then((maps) => addressForCoordinate(maps, latitude, longitude))
            .then((address) => {
              if (!address || requestId !== locationRequestRef.current) return;
              onChange({ ...currentPlace, address });
              setQuery(address);
              setStatus(`${title}을 현재 주소로 지정했습니다.`);
            })
            .catch(() => undefined);
        }
      },
      () => {
        if (requestId === locationRequestRef.current) {
          setStatus("위치 권한이 없거나 현재 위치를 확인하지 못했습니다.");
        }
      },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
  }

  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <legend className="sr-only">{title} 위치 설정</legend>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-black text-slate-900">
          {kind === "home" ? "🏠" : "🏢"} {title}
        </p>
        <button
          className="text-xs font-extrabold text-emerald-800 underline decoration-emerald-300 underline-offset-4"
          onClick={useCurrentLocation}
          type="button"
        >
          현재 위치 사용
        </button>
      </div>

      {appKey ? (
        <form className="flex gap-2" onSubmit={search}>
          <label className="sr-only" htmlFor={`${kind}-place-query`}>
            {title} 장소명 또는 주소
          </label>
          <input
            className="control min-w-0"
            id={`${kind}-place-query`}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`${title} 장소명 또는 주소`}
            value={query}
          />
          <button
            className="secondary-button shrink-0"
            disabled={searching}
            type="submit"
          >
            {searching ? "검색 중" : "검색"}
          </button>
        </form>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          카카오 JavaScript 키를 입력하면 장소명과 주소를 검색할 수 있습니다.
          키가 없어도 현재 위치나 좌표를 직접 사용할 수 있습니다.
        </p>
      )}

      {results.length > 0 && (
        <ul
          aria-label={`${title} 검색 결과`}
          className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1"
        >
          {results.map((result) => (
            <li key={result.id}>
              <button
                className="w-full rounded-lg px-3 py-2 text-left hover:bg-emerald-50"
                onClick={() => selectResult(result)}
                type="button"
              >
                <span className="block text-sm font-extrabold text-slate-900">
                  {result.name}
                </span>
                <span className="mt-0.5 block text-[0.68rem] leading-4 text-slate-500">
                  {result.address}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="mt-3 block text-xs font-bold text-slate-600">
        표시 주소
        <input
          className="control mt-1"
          onChange={(event) =>
            onChange({ ...value, address: event.target.value })
          }
          placeholder={`${title} 주소`}
          value={value.address}
        />
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-600">
          위도
          <input
            className="control mt-1"
            inputMode="decimal"
            onChange={(event) =>
              onChange({ ...value, latitude: Number(event.target.value) })
            }
            step="any"
            type="number"
            value={value.latitude}
          />
        </label>
        <label className="text-xs font-bold text-slate-600">
          경도
          <input
            className="control mt-1"
            inputMode="decimal"
            onChange={(event) =>
              onChange({ ...value, longitude: Number(event.target.value) })
            }
            step="any"
            type="number"
            value={value.longitude}
          />
        </label>
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-[0.68rem] leading-5 text-slate-500">
        <p aria-live="polite" role="status">
          {status}
        </p>
        {appKey && (
          <a
            className="shrink-0 font-bold underline underline-offset-4"
            href="https://map.kakao.com"
            rel="noreferrer"
            target="_blank"
          >
            카카오맵 검색 ↗
          </a>
        )}
      </div>
    </fieldset>
  );
}
