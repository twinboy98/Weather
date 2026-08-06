import type { ProviderId } from "@/lib/domain";

type ProviderSetupGuideProps = {
  providerId: ProviderId;
};

const guideLinkClass =
  "font-extrabold text-emerald-800 underline decoration-emerald-300 underline-offset-4";

export function ProviderSetupGuide({ providerId }: ProviderSetupGuideProps) {
  if (providerId === "met_norway") {
    return (
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs leading-6 text-slate-700">
        <h4 className="text-sm font-black text-slate-900">
          MET Norway 연결 방법 · 키 없음
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            별도 가입이나 API 키 발급 없이 이 공급자를 선택하고 저장하면 됩니다.
          </li>
          <li>
            개인용·낮은 트래픽에서 먼저 시험해 보세요. 화면 하단의 데이터 출처
            표시는 유지됩니다.
          </li>
          <li>
            공개 서비스 트래픽이 커지면 이용약관에 맞는 식별 정보와 캐싱
            프록시를 두는 구성이 권장됩니다.
          </li>
        </ol>
        <p className="mt-2 text-slate-600">
          브라우저 직접 호출은 서버처럼 식별용 User-Agent를 세밀하게 제어할 수
          없습니다. 운영 규모가 커지면 프록시 전환을 검토하세요.
        </p>
        <a
          className={`${guideLinkClass} mt-2 inline-block`}
          href="https://developer.yr.no/doc/TermsOfService/"
          rel="noreferrer"
          target="_blank"
        >
          MET Norway 이용약관 확인 ↗
        </a>
      </div>
    );
  }

  if (providerId === "kma_forecast") {
    return (
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs leading-6 text-slate-700">
        <h4 className="text-sm font-black text-slate-900">
          기상청 단기예보 서비스 키 발급
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            공공데이터포털에 로그인한 뒤{" "}
            <strong>기상청_단기예보 ((구)_동네예보) 조회서비스</strong> 페이지를
            엽니다.
          </li>
          <li>
            <strong>활용신청</strong>을 누르고 활용 목적을 입력합니다. 승인
            상태가 <strong>개발계정 · 승인</strong>인지 확인하세요.
          </li>
          <li>
            <strong>마이페이지 → 데이터 활용 → Open API → 인증키</strong>에서
            일반 인증키(Encoding 또는 Decoding)를 복사합니다.
          </li>
          <li>
            위의 입력란에 붙여 넣고 저장합니다. 이 앱은 Encoding 키도 한 번
            풀어서 요청하므로 둘 중 하나를 사용할 수 있습니다.
          </li>
        </ol>
        <p className="mt-2 text-slate-600">
          신규 키는 포털 반영까지 시간이 걸릴 수 있습니다. 인증 오류가 계속되면
          승인 상태, 일일 호출 한도, 서비스 키 앞뒤 공백을 확인하세요.
        </p>
        <a
          className={`${guideLinkClass} mt-2 inline-block`}
          href="https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15084084"
          rel="noreferrer"
          target="_blank"
        >
          공공데이터포털 신청 페이지 ↗
        </a>
      </div>
    );
  }

  if (providerId === "windy") {
    return (
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs leading-6 text-slate-700">
        <h4 className="text-sm font-black text-slate-900">
          Windy Point Forecast 키 발급
        </h4>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Windy API 포털에 로그인하고 <strong>Point Forecast API</strong>{" "}
            상품과 가격을 확인합니다.
          </li>
          <li>
            키 관리 화면에서 Point Forecast 키를 만듭니다. Map Forecast,
            Webcams, Embed용 키와는 다릅니다.
          </li>
          <li>
            Testing 키면 <strong>Testing</strong>, 유료 실데이터 키면 계약에
            맞춰 <strong>Professional</strong>을 선택합니다.
          </li>
          <li>
            모델은 한국을 포함한 전 지구 예보가 필요하면 GFS부터 시험하고,
            계약에서 지원되는 경우 ICON도 선택할 수 있습니다.
          </li>
        </ol>
        <p className="mt-2 font-bold text-amber-900">
          Testing API 값은 의도적으로 섞이거나 변형된 개발용 데이터입니다. 실제
          출퇴근 판단에는 사용하지 마세요.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <a
            className={guideLinkClass}
            href="https://api.windy.com/point-forecast/docs"
            rel="noreferrer"
            target="_blank"
          >
            Point Forecast 문서 ↗
          </a>
          <a
            className={guideLinkClass}
            href="https://api.windy.com/point-forecast/pricing"
            rel="noreferrer"
            target="_blank"
          >
            가격·플랜 확인 ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs leading-6 text-slate-700">
      <h4 className="text-sm font-black text-slate-900">
        AccuWeather 키 발급과 프록시 연결
      </h4>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          AccuWeather Developer Portal 계정을 만들고{" "}
          <strong>My Apps → Add a new App</strong>에서 앱을 등록해 API 키를
          발급합니다.
        </li>
        <li>
          발급한 키는 GitHub Pages나 이 입력란에 넣지 말고 Cloudflare
          Worker·Vercel Function 같은 서버 측 환경변수에만 저장합니다.
        </li>
        <li>
          프록시는 이 앱에서 받는 <code>lat</code>, <code>lon</code>,{" "}
          <code>language</code>, <code>hours</code>를 사용해 위치 키를 찾고
          현재·시간별 예보를 조회합니다.
        </li>
        <li>
          응답을 <code>{`{ "current": ..., "hourly": [...] }`}</code> 형태로
          반환하고, CORS 허용 출처에 <code>https://twinboy98.github.io</code>를
          등록합니다.
        </li>
        <li>완성된 HTTPS 프록시 주소만 위 입력란에 넣습니다.</li>
      </ol>
      <p className="mt-2 font-bold text-amber-900">
        AccuWeather 공식 API URL이나 비밀 키를 브라우저에 직접 넣으면
        공개됩니다. 별도 프록시가 없다면 다른 공급자를 사용하세요.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <a
          className={guideLinkClass}
          href="https://developer.accuweather.com/documentation/authentication"
          rel="noreferrer"
          target="_blank"
        >
          인증·앱 키 안내 ↗
        </a>
        <a
          className={guideLinkClass}
          href="https://developer.accuweather.com/documentation/terms-of-use"
          rel="noreferrer"
          target="_blank"
        >
          이용 조건 확인 ↗
        </a>
      </div>
    </div>
  );
}
