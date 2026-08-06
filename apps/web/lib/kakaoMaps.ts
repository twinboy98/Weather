export type KakaoLatLng = object;

export type KakaoLatLngBounds = {
  extend(position: KakaoLatLng): void;
};

export type KakaoMap = {
  relayout(): void;
  setBounds(
    bounds: KakaoLatLngBounds,
    paddingTop?: number,
    paddingRight?: number,
    paddingBottom?: number,
    paddingLeft?: number,
  ): void;
};

export type KakaoMapOverlay = {
  setMap(map: KakaoMap | null): void;
};

export type KakaoPlaceDocument = {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  place_url?: string;
  x: string;
  y: string;
};

export type KakaoAddressDocument = {
  address_name: string;
  x: string;
  y: string;
  address?: { address_name?: string };
  road_address?: { address_name?: string } | null;
};

export type KakaoCoordAddressDocument = {
  address?: { address_name?: string };
  road_address?: { address_name?: string } | null;
};

export type KakaoMapsApi = {
  load(callback: () => void): void;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level?: number },
  ) => KakaoMap;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Marker: new (options: {
    map?: KakaoMap;
    position: KakaoLatLng;
    title?: string;
  }) => KakaoMapOverlay;
  Polyline: new (options: {
    map?: KakaoMap;
    path: KakaoLatLng[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeStyle?: string;
  }) => KakaoMapOverlay;
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

let loaderPromise: Promise<KakaoMapsApi> | null = null;
let loaderKey = "";

export function loadKakaoMaps(appKey: string): Promise<KakaoMapsApi> {
  const kakaoWindow = window as KakaoWindow;
  if (loaderKey && loaderKey !== appKey) {
    return Promise.reject(
      new Error(
        "카카오 JavaScript 키를 바꿨습니다. 설정을 저장한 뒤 페이지를 새로고침해 주세요.",
      ),
    );
  }
  if (loaderPromise && loaderKey === appKey) return loaderPromise;
  if (kakaoWindow.kakao?.maps?.services) {
    loaderKey = appKey;
    loaderPromise = Promise.resolve(kakaoWindow.kakao.maps);
    return loaderPromise;
  }

  loaderKey = appKey;
  loaderPromise = new Promise((resolve, reject) => {
    const fail = (message: string) => {
      script.onload = null;
      script.onerror = null;
      script.remove();
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
    script.dataset.bigeutgiKakao = "true";
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
        script.onload = null;
        script.onerror = null;
        resolve(maps);
      });
    };
    script.onerror = () =>
      fail(
        "카카오맵을 불러오지 못했습니다. 카카오맵 사용 설정이 ON인지, JavaScript 키와 SDK 도메인이 맞는지 확인해 주세요.",
      );
    document.head.appendChild(script);
  });
  return loaderPromise;
}
