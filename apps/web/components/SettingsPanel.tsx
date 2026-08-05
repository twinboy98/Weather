"use client";

import { useEffect } from "react";

import type { CommuteDirection, PlaceKey, PlaceRef, ProviderId, TravelMode } from "@/lib/domain";
import type { ClientState } from "@/lib/storage";

import { PlacePicker, type PickedPlace } from "@/components/PlacePicker";

type SettingsPanelProps = {
  value: ClientState;
  onChange: (state: ClientState) => void;
  onClose: () => void;
  onReset: () => void;
  onSave: () => void;
};

const providerOptions: Array<{ id: ProviderId; label: string; note: string }> = [
  { id: "met_norway", label: "MET Norway", note: "키 없이 시작 · 저트래픽 개인용" },
  { id: "kma_forecast", label: "기상청 단기예보", note: "공공데이터포털 서비스 키 필요" },
  { id: "windy", label: "Windy", note: "Point Forecast 키 필요" },
  { id: "accuweather", label: "AccuWeather", note: "보안 프록시 URL 필요" },
];

export function SettingsPanel({ value, onChange, onClose, onReset, onSave }: SettingsPanelProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function updatePlace(key: PlaceKey, picked: PickedPlace) {
    const place: PlaceRef = {
      key,
      name: key === "home" ? "집" : "회사",
      address: picked.address,
      latitude: picked.latitude,
      longitude: picked.longitude,
      placeId: picked.placeId,
    };
    onChange({
      ...value,
      settings: {
        ...value.settings,
        places: { ...value.settings.places, [key]: place },
      },
    });
  }

  function updateWindow(direction: CommuteDirection, field: "startLocalTime" | "endLocalTime" | "travelMinutes", rawValue: string) {
    onChange({
      ...value,
      settings: {
        ...value.settings,
        schedule: {
          ...value.settings.schedule,
          [direction]: {
            ...value.settings.schedule[direction],
            [field]: field === "travelMinutes" ? Math.max(5, Number(rawValue)) : rawValue,
          },
        },
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="settings-title" aria-modal="true" className="mx-auto max-w-3xl overflow-hidden rounded-[1.8rem] bg-white shadow-2xl" role="dialog">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div>
            <p className="eyebrow">My commute</p>
            <h2 className="mt-1 text-2xl font-black" id="settings-title">집·회사와 출퇴근 설정</h2>
          </div>
          <button aria-label="설정 닫기" className="secondary-button h-10 min-h-0 w-10 p-0 text-xl" onClick={onClose} type="button">×</button>
        </header>

        <div className="space-y-7 px-5 py-6 sm:px-7">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">Google 지도 연결</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Places API (New)가 허용된 브라우저 키를 입력하세요.</p>
              </div>
              <a className="text-xs font-extrabold text-emerald-800 underline underline-offset-4" href="https://developers.google.com/maps/documentation/javascript/place-autocomplete-new" rel="noreferrer" target="_blank">설정 안내 ↗</a>
            </div>
            <input
              aria-label="Google Maps API 키"
              className="control"
              onChange={(event) => onChange({ ...value, api: { ...value.api, googleMapsApiKey: event.target.value.trim() } })}
              placeholder="Google Maps 브라우저 API 키"
              type="password"
              value={value.api.googleMapsApiKey}
            />
            <p className="mt-2 text-[0.68rem] leading-5 text-slate-500">키는 이 브라우저에만 저장됩니다. github.io 리퍼러와 Maps JavaScript·Places API로 사용 범위를 제한하세요.</p>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            {(["home", "work"] as const).map((key) => {
              const fallback = key === "home"
                ? { label: "집", address: "", latitude: 37.5133, longitude: 127.1001 }
                : { label: "회사", address: "", latitude: 37.5716, longitude: 126.9769 };
              const place = value.settings.places[key];
              return (
                <PlacePicker
                  apiKey={value.api.googleMapsApiKey}
                  key={key}
                  kind={key}
                  onChange={(picked) => updatePlace(key, picked)}
                  value={place ? {
                    label: place.name,
                    address: place.address ?? place.name,
                    latitude: place.latitude,
                    longitude: place.longitude,
                    placeId: place.placeId,
                  } : fallback}
                />
              );
            })}
          </section>

          <section>
            <h3 className="text-lg font-black">날씨 공급자</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">비교하지 않고 선택한 한 곳의 예보만 추천 계산에 사용합니다.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {providerOptions.map((provider) => (
                <button
                  aria-pressed={value.settings.providerId === provider.id}
                  className={`rounded-2xl border p-4 text-left transition ${value.settings.providerId === provider.id ? "border-emerald-700 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  key={provider.id}
                  onClick={() => onChange({ ...value, settings: { ...value.settings, providerId: provider.id } })}
                  type="button"
                >
                  <span className="block text-sm font-black">{provider.label}</span>
                  <span className="mt-1 block text-[0.68rem] text-slate-500">{provider.note}</span>
                </button>
              ))}
            </div>

            {value.settings.providerId === "kma_forecast" && (
              <label className="mt-3 block text-xs font-bold text-slate-600">
                KMA 공공데이터포털 서비스 키
                <input className="control mt-1" onChange={(event) => onChange({ ...value, api: { ...value.api, kmaServiceKey: event.target.value.trim() } })} placeholder="ServiceKey" type="password" value={value.api.kmaServiceKey} />
              </label>
            )}
            {value.settings.providerId === "windy" && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_9rem]">
                <label className="text-xs font-bold text-slate-600">
                  Windy Point Forecast 키
                  <input className="control mt-1" onChange={(event) => onChange({ ...value, api: { ...value.api, windyApiKey: event.target.value.trim() } })} placeholder="Point Forecast API key" type="password" value={value.api.windyApiKey} />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  모델
                  <select className="control mt-1" onChange={(event) => onChange({ ...value, api: { ...value.api, windyModel: event.target.value as "gfs" | "icon" } })} value={value.api.windyModel}>
                    <option value="gfs">GFS</option>
                    <option value="icon">ICON</option>
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">
                  키 종류
                  <select className="control mt-1" onChange={(event) => onChange({ ...value, api: { ...value.api, windyApiMode: event.target.value as "testing" | "professional" } })} value={value.api.windyApiMode}>
                    <option value="testing">Testing</option>
                    <option value="professional">Professional</option>
                  </select>
                </label>
              </div>
            )}
            {value.settings.providerId === "accuweather" && (
              <label className="mt-3 block text-xs font-bold text-slate-600">
                AccuWeather 보안 프록시 URL
                <input className="control mt-1" onChange={(event) => onChange({ ...value, api: { ...value.api, accuweatherProxyUrl: event.target.value.trim() } })} placeholder="https://your-worker.example.com/weather" type="url" value={value.api.accuweatherProxyUrl} />
                <span className="mt-2 block font-normal leading-5 text-slate-500">AccuWeather 공식 지침에 따라 API 키는 정적 페이지에 입력하지 않습니다.</span>
              </label>
            )}
          </section>

          <section>
            <h3 className="text-lg font-black">출퇴근 시간</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["outbound", "inbound"] as const).map((direction) => (
                <fieldset className="rounded-2xl border border-slate-200 p-4" key={direction}>
                  <legend className="px-1 text-sm font-black">{direction === "outbound" ? "출근 · Best time to go" : "퇴근 · Best time to leave"}</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-600">시작<input className="control mt-1" onChange={(event) => updateWindow(direction, "startLocalTime", event.target.value)} type="time" value={value.settings.schedule[direction].startLocalTime} /></label>
                    <label className="text-xs font-bold text-slate-600">종료<input className="control mt-1" onChange={(event) => updateWindow(direction, "endLocalTime", event.target.value)} type="time" value={value.settings.schedule[direction].endLocalTime} /></label>
                  </div>
                  <label className="mt-2 block text-xs font-bold text-slate-600">예상 이동시간 (분)<input className="control mt-1" max="240" min="5" onChange={(event) => updateWindow(direction, "travelMinutes", event.target.value)} type="number" value={value.settings.schedule[direction].travelMinutes} /></label>
                </fieldset>
              ))}
            </div>
            <label className="mt-3 block text-xs font-bold text-slate-600">
              이동수단
              <select className="control mt-1" onChange={(event) => onChange({ ...value, settings: { ...value.settings, travelMode: event.target.value as TravelMode } })} value={value.settings.travelMode}>
                <option value="transit">대중교통</option>
                <option value="driving">자동차</option>
                <option value="walking">도보</option>
                <option value="bicycling">자전거</option>
              </select>
            </label>
          </section>

          <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
            집·회사·키·시간 설정은 이 브라우저의 localStorage에만 저장되며 저장소나 GitHub로 전송되지 않습니다. 날씨를 조회할 때 선택한 좌표와 IP는 해당 공급자에 전달될 수 있습니다.
          </div>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <button className="text-xs font-bold text-slate-500 underline underline-offset-4" onClick={onReset} type="button">샘플 설정으로 초기화</button>
          <div className="flex gap-2">
            <button className="secondary-button" onClick={onClose} type="button">취소</button>
            <button className="primary-button" onClick={onSave} type="button">저장하고 새로고침</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
