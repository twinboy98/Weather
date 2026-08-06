"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import type {
  CommuteDirection,
  PlaceKey,
  PlaceRef,
  ProviderId,
  TravelMode,
} from "@/lib/domain";
import type { ClientState } from "@/lib/storage";

import { PlacePicker, type PickedPlace } from "@/components/PlacePicker";
import { ProviderSetupGuide } from "@/components/ProviderSetupGuide";
import { SettingsTransfer } from "@/components/SettingsTransfer";

type SettingsPanelProps = {
  value: ClientState;
  onChange: Dispatch<SetStateAction<ClientState>>;
  onClose: () => void;
  onReset: () => void;
  onSave: () => void;
};

const providerOptions: Array<{ id: ProviderId; label: string; note: string }> =
  [
    {
      id: "met_norway",
      label: "MET Norway",
      note: "키 없이 시작 · 저트래픽 개인용",
    },
    {
      id: "kma_forecast",
      label: "기상청 단기예보",
      note: "공공데이터포털 서비스 키 필요",
    },
    { id: "windy", label: "Windy", note: "Point Forecast 키 필요" },
    { id: "accuweather", label: "AccuWeather", note: "보안 프록시 URL 필요" },
  ];

export function SettingsPanel({
  value,
  onChange,
  onClose,
  onReset,
  onSave,
}: SettingsPanelProps) {
  const [placePickerRevision, setPlacePickerRevision] = useState(0);

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
    onChange((current) => ({
      ...current,
      settings: {
        ...current.settings,
        places: { ...current.settings.places, [key]: place },
      },
    }));
  }

  function updateWindow(
    direction: CommuteDirection,
    field: "startLocalTime" | "endLocalTime" | "travelMinutes",
    rawValue: string,
  ) {
    onChange({
      ...value,
      settings: {
        ...value.settings,
        schedule: {
          ...value.settings.schedule,
          [direction]: {
            ...value.settings.schedule[direction],
            [field]:
              field === "travelMinutes"
                ? Math.max(5, Number(rawValue))
                : rawValue,
          },
        },
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="mx-auto max-w-3xl overflow-hidden rounded-[1.8rem] bg-white shadow-2xl"
        role="dialog"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <div>
            <p className="eyebrow">My commute</p>
            <h2 className="mt-1 text-2xl font-black" id="settings-title">
              집·회사와 출퇴근 설정
            </h2>
          </div>
          <button
            aria-label="설정 닫기"
            className="secondary-button h-10 min-h-0 w-10 p-0 text-xl"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="space-y-7 px-5 py-6 sm:px-7">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">카카오맵 장소 검색</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  카카오디벨로퍼스의 JavaScript 키를 사용합니다. REST API 키가
                  아닙니다.
                </p>
              </div>
              <a
                className="text-xs font-extrabold text-emerald-800 underline underline-offset-4"
                href="https://apis.map.kakao.com/web/guide/"
                rel="noreferrer"
                target="_blank"
              >
                공식 가이드 ↗
              </a>
            </div>
            <input
              aria-label="카카오맵 JavaScript 키"
              className="control"
              onChange={(event) =>
                onChange({
                  ...value,
                  api: {
                    ...value.api,
                    kakaoMapsAppKey: event.target.value.trim(),
                  },
                })
              }
              placeholder="카카오 JavaScript 키"
              type="password"
              value={value.api.kakaoMapsAppKey}
            />
            <p className="mt-2 text-[0.68rem] leading-5 text-slate-500">
              키는 이 브라우저의 localStorage에 저장됩니다. 카카오에 등록한
              도메인에서만 동작하도록 제한하세요.
            </p>
            <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
              <summary className="cursor-pointer font-black text-slate-900">
                처음부터 따라 하는 카카오맵 키 발급 방법
              </summary>
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                <li>
                  <a
                    className="font-extrabold text-emerald-800 underline underline-offset-4"
                    href="https://developers.kakao.com/console/app"
                    rel="noreferrer"
                    target="_blank"
                  >
                    카카오디벨로퍼스 앱 관리 ↗
                  </a>
                  에 로그인하고 <strong>앱 추가하기</strong>로 이 웹앱용 앱을
                  만듭니다.
                </li>
                <li>
                  앱 관리에서 <strong>카카오맵 → 사용 설정</strong>을 열고
                  상태를 ON으로 바꿉니다.
                </li>
                <li>
                  <strong>앱 → 플랫폼 키 → JavaScript 키</strong>를 열어 키 값을
                  복사합니다. REST API 키나 Admin 키를 복사하면 안 됩니다.
                </li>
                <li>
                  같은 JavaScript 키 설정의{" "}
                  <strong>JavaScript SDK 도메인</strong>에 배포용{" "}
                  <code>https://twinboy98.github.io</code>를 등록합니다.{" "}
                  <code>/Weather/</code>는 경로이므로 붙이지 않습니다.
                </li>
                <li>
                  로컬 개발도 하려면 <code>http://localhost:3000</code>도
                  등록합니다. 다른 포트에서 시험하면 그 origin도 추가하세요.
                </li>
                <li>
                  저장 후 위 입력란에 JavaScript 키를 붙여 넣고 장소를
                  검색합니다. 키를 교체했다면 이 창 아래의{" "}
                  <strong>저장하고 새로고침</strong>을 누릅니다.
                </li>
              </ol>
              <div className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-950">
                <strong>비용 확인:</strong> 2026년 7월 21일 이후 정책상 계정에서
                카카오맵 API를 처음 활성화한 앱에 무료 쿼터가 적용되며, 추가
                앱이나 쿼터 초과는 비즈월렛·유료 설정이 필요할 수 있습니다. 사용
                전에 최신 쿼터를 확인하세요.
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                <a
                  className="font-extrabold text-emerald-800 underline underline-offset-4"
                  href="https://developers.kakao.com/docs/ko/app-setting/app"
                  rel="noreferrer"
                  target="_blank"
                >
                  키·도메인 공식 문서 ↗
                </a>
                <a
                  className="font-extrabold text-emerald-800 underline underline-offset-4"
                  href="https://developers.kakao.com/docs/ko/getting-started/quota"
                  rel="noreferrer"
                  target="_blank"
                >
                  쿼터·가격 확인 ↗
                </a>
              </div>
            </details>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            {(["home", "work"] as const).map((key) => {
              const fallback =
                key === "home"
                  ? {
                      label: "집",
                      address: "",
                      latitude: 37.5133,
                      longitude: 127.1001,
                    }
                  : {
                      label: "회사",
                      address: "",
                      latitude: 37.5716,
                      longitude: 126.9769,
                    };
              const place = value.settings.places[key];
              return (
                <PlacePicker
                  appKey={value.api.kakaoMapsAppKey}
                  key={`${key}:${placePickerRevision}`}
                  kind={key}
                  onChange={(picked) => updatePlace(key, picked)}
                  value={
                    place
                      ? {
                          label: place.name,
                          address: place.address ?? place.name,
                          latitude: place.latitude,
                          longitude: place.longitude,
                          placeId: place.placeId,
                        }
                      : fallback
                  }
                />
              );
            })}
          </section>

          <section>
            <h3 className="text-lg font-black">날씨 공급자</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              비교하지 않고 선택한 한 곳의 예보만 추천 계산에 사용합니다.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {providerOptions.map((provider) => (
                <button
                  aria-pressed={value.settings.providerId === provider.id}
                  className={`rounded-2xl border p-4 text-left transition ${value.settings.providerId === provider.id ? "border-emerald-700 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  key={provider.id}
                  onClick={() =>
                    onChange({
                      ...value,
                      settings: { ...value.settings, providerId: provider.id },
                    })
                  }
                  type="button"
                >
                  <span className="block text-sm font-black">
                    {provider.label}
                  </span>
                  <span className="mt-1 block text-[0.68rem] text-slate-500">
                    {provider.note}
                  </span>
                </button>
              ))}
            </div>

            {value.settings.providerId === "kma_forecast" && (
              <label className="mt-3 block text-xs font-bold text-slate-600">
                KMA 공공데이터포털 서비스 키
                <input
                  className="control mt-1"
                  onChange={(event) =>
                    onChange({
                      ...value,
                      api: {
                        ...value.api,
                        kmaServiceKey: event.target.value.trim(),
                      },
                    })
                  }
                  placeholder="ServiceKey"
                  type="password"
                  value={value.api.kmaServiceKey}
                />
              </label>
            )}
            {value.settings.providerId === "windy" && (
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_9rem]">
                <label className="text-xs font-bold text-slate-600">
                  Windy Point Forecast 키
                  <input
                    className="control mt-1"
                    onChange={(event) =>
                      onChange({
                        ...value,
                        api: {
                          ...value.api,
                          windyApiKey: event.target.value.trim(),
                        },
                      })
                    }
                    placeholder="Point Forecast API key"
                    type="password"
                    value={value.api.windyApiKey}
                  />
                </label>
                <label className="text-xs font-bold text-slate-600">
                  모델
                  <select
                    className="control mt-1"
                    onChange={(event) =>
                      onChange({
                        ...value,
                        api: {
                          ...value.api,
                          windyModel: event.target.value as "gfs" | "icon",
                        },
                      })
                    }
                    value={value.api.windyModel}
                  >
                    <option value="gfs">GFS</option>
                    <option value="icon">ICON</option>
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">
                  키 종류
                  <select
                    className="control mt-1"
                    onChange={(event) =>
                      onChange({
                        ...value,
                        api: {
                          ...value.api,
                          windyApiMode: event.target.value as
                            | "testing"
                            | "professional",
                        },
                      })
                    }
                    value={value.api.windyApiMode}
                  >
                    <option value="testing">Testing</option>
                    <option value="professional">Professional</option>
                  </select>
                </label>
              </div>
            )}
            {value.settings.providerId === "accuweather" && (
              <label className="mt-3 block text-xs font-bold text-slate-600">
                AccuWeather 보안 프록시 URL
                <input
                  className="control mt-1"
                  onChange={(event) =>
                    onChange({
                      ...value,
                      api: {
                        ...value.api,
                        accuweatherProxyUrl: event.target.value.trim(),
                      },
                    })
                  }
                  placeholder="https://your-worker.example.com/weather"
                  type="url"
                  value={value.api.accuweatherProxyUrl}
                />
                <span className="mt-2 block font-normal leading-5 text-slate-500">
                  AccuWeather 공식 지침에 따라 API 키는 정적 페이지에 입력하지
                  않습니다.
                </span>
              </label>
            )}
            <div className="mt-3">
              <ProviderSetupGuide providerId={value.settings.providerId} />
            </div>
          </section>

          <section>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">기상청 강수예측</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  강수예측 패널은 선택한 날씨 공급자와 별개로 KMA API Hub 자료를
                  사용합니다.
                </p>
              </div>
              <a
                className="shrink-0 text-xs font-extrabold text-emerald-800 underline underline-offset-4"
                href="https://apihub.kma.go.kr/apiInfo.do"
                rel="noreferrer"
                target="_blank"
              >
                API Hub 안내 ↗
              </a>
            </div>
            <label className="mt-3 block text-xs font-bold text-slate-600">
              KMA API Hub 인증키 (authKey)
              <input
                aria-label="KMA API Hub 인증키"
                className="control mt-1"
                onChange={(event) =>
                  onChange({
                    ...value,
                    api: {
                      ...value.api,
                      kmaApiHubKey: event.target.value.trim(),
                    },
                  })
                }
                placeholder="KMA API Hub authKey"
                type="password"
                value={value.api.kmaApiHubKey}
              />
            </label>
            <p className="mt-2 text-[0.68rem] leading-5 text-slate-500">
              공공데이터포털의 단기예보 서비스 키와는 별도로 발급되는 키입니다.
              서버 데이터베이스 없이 이 브라우저의 localStorage에 저장되지만,
              이미지를 받을 때 API Hub 요청에 포함되므로 개발자 도구의 네트워크
              화면에서 보일 수 있습니다. 본인의 키만 사용하세요.
            </p>
            <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
              <summary className="cursor-pointer font-black text-slate-900">
                KMA API Hub 인증키 발급 방법
              </summary>
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                <li>
                  <a
                    className="font-extrabold text-emerald-800 underline underline-offset-4"
                    href="https://apihub.kma.go.kr/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    기상청 API Hub ↗
                  </a>
                  에 회원가입하고 로그인합니다.
                </li>
                <li>
                  일반회원 가입은 포털에서 자동 승인됩니다. 로그인 후
                  마이페이지에 표시되는 <strong>인증키(authKey)</strong>를
                  복사합니다.
                </li>
                <li>
                  API 목록에서 레이더·초단기예측 자료의 이용 조건을 확인합니다.
                  공공데이터포털의 Decoding 서비스 키는 API Hub에서 동작하지
                  않습니다.
                </li>
                <li>
                  위 입력란에 붙여 넣은 뒤 <strong>저장하고 새로고침</strong>을
                  누릅니다.
                </li>
              </ol>
              <div className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-950">
                <strong>기본 이용 한도:</strong> 일반회원은 현재 안내 기준
                무료로 하루 20,000건·5GB까지 이용할 수 있습니다. 운영 정책은
                바뀔 수 있으므로 API Hub의 최신 안내를 함께 확인하세요.
              </div>
            </details>
          </section>

          <section>
            <h3 className="text-lg font-black">출퇴근 시간</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(["outbound", "inbound"] as const).map((direction) => (
                <fieldset
                  className="rounded-2xl border border-slate-200 p-4"
                  key={direction}
                >
                  <legend className="px-1 text-sm font-black">
                    {direction === "outbound"
                      ? "출근 · Best time to go"
                      : "퇴근 · Best time to leave"}
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-600">
                      시작
                      <input
                        className="control mt-1"
                        onChange={(event) =>
                          updateWindow(
                            direction,
                            "startLocalTime",
                            event.target.value,
                          )
                        }
                        type="time"
                        value={
                          value.settings.schedule[direction].startLocalTime
                        }
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-600">
                      종료
                      <input
                        className="control mt-1"
                        onChange={(event) =>
                          updateWindow(
                            direction,
                            "endLocalTime",
                            event.target.value,
                          )
                        }
                        type="time"
                        value={value.settings.schedule[direction].endLocalTime}
                      />
                    </label>
                  </div>
                  <label className="mt-2 block text-xs font-bold text-slate-600">
                    예상 이동시간 (분)
                    <input
                      className="control mt-1"
                      max="240"
                      min="5"
                      onChange={(event) =>
                        updateWindow(
                          direction,
                          "travelMinutes",
                          event.target.value,
                        )
                      }
                      type="number"
                      value={value.settings.schedule[direction].travelMinutes}
                    />
                  </label>
                </fieldset>
              ))}
            </div>
            <label className="mt-3 block text-xs font-bold text-slate-600">
              이동수단
              <select
                className="control mt-1"
                onChange={(event) =>
                  onChange({
                    ...value,
                    settings: {
                      ...value.settings,
                      travelMode: event.target.value as TravelMode,
                    },
                  })
                }
                value={value.settings.travelMode}
              >
                <option value="transit">대중교통</option>
                <option value="driving">자동차</option>
                <option value="walking">도보</option>
                <option value="bicycling">자전거</option>
              </select>
            </label>
          </section>

          <SettingsTransfer
            onImport={(state) => {
              onChange(state);
              setPlacePickerRevision((revision) => revision + 1);
            }}
            value={value}
          />

          <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">
            집·회사·키·시간 설정은 이 브라우저의 localStorage에 저장되며
            저장소나 GitHub로 전송되지 않습니다. 장소·날씨·강수예측을 조회할
            때는 필요한 키, 좌표와 네트워크 정보가 해당 공급자에 전달될 수
            있습니다.
          </div>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-100 bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
          <button
            className="text-xs font-bold text-slate-500 underline underline-offset-4"
            onClick={() => {
              onReset();
              setPlacePickerRevision((revision) => revision + 1);
            }}
            type="button"
          >
            샘플 설정으로 초기화
          </button>
          <div className="flex gap-2">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              취소
            </button>
            <button className="primary-button" onClick={onSave} type="button">
              저장하고 새로고침
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
