# 날씨길 · Weather Route

집과 회사를 지정하면 두 장소의 현재 날씨와 시간별 예보를 정리하고, 출근·퇴근 허용 시간 안에서 **Best time to go / Best time to leave**를 계산하는 정적 웹 앱입니다.

기존의 공급자 비교·정확도 순위 화면은 제거했습니다. 한 번에 선택한 날씨 공급자 하나만 사용하며, 추천 계산과 사용자 설정은 서버가 아니라 사용자 브라우저에서 처리합니다.

## 주요 기능

- Google Maps Places로 집·회사 검색 및 지정
- 집과 회사의 현재 날씨와 시간별 예보
- 강수·체감온도·바람·예보 불확실성을 반영한 출근/퇴근 추천 시간대
- 집 / 이동 중 / 회사의 12시간 Rain window
- Windy Embed 기반 과거·현재 강수 레이더
- KMA Forecast, MET Norway, Windy, AccuWeather 공급자 선택
- GitHub Pages 정적 export 및 자동 배포
- 설정과 API 구성은 브라우저 `localStorage`에만 저장

## 공급자와 브라우저 제약

| 공급자 | 사용 방식 | 필요한 설정 |
|---|---|---|
| MET Norway | 저트래픽 브라우저 직접 GET | 없음. 공개 운영은 캐시 프록시 권장 |
| 기상청 단기예보 | 개인 키 브라우저 호출 | 공공데이터포털 `ServiceKey`. 공개 운영은 프록시 권장 |
| Windy | Point Forecast 브라우저 호출 | Windy Point Forecast 키. Testing 자료는 추천용이 아님 |
| AccuWeather | 서버리스 프록시 호출만 허용 | 프록시 URL. API 키를 브라우저에 입력하지 않음 |

GitHub Pages는 비밀키를 보관할 수 없습니다. Google Maps 브라우저 키는 `https://<계정>.github.io/*` HTTP referrer와 Maps JavaScript API / Places API (New)로 제한해야 합니다. AccuWeather는 공식 보안 지침에 따라 API 키를 가진 서버 측 프록시가 반드시 필요합니다.

AccuWeather 프록시는 다음 JSON을 반환해야 합니다.

```json
{
  "current": {},
  "hourly": []
}
```

`current`와 `hourly`는 AccuWeather Current Conditions 및 Hourly Forecast 원본 항목입니다. 앱은 프록시에 `lat`, `lon`, `language`, `hours` 쿼리를 전달합니다.

## 로컬 실행

Node.js 22와 pnpm 11이 필요합니다. Docker와 Python API는 새 웹 앱 실행에 필요하지 않습니다.

```powershell
pnpm install --frozen-lockfile
pnpm --dir apps/web dev
```

브라우저에서 <http://localhost:3000>을 연 뒤 설정에서 집·회사와 공급자를 지정합니다. MET Norway는 별도 키 없이 시험할 수 있지만, 공식 정책상 `localhost` 직접 호출은 제한될 수 있습니다.

정적 결과물을 만들려면:

```powershell
pnpm --dir apps/web build
```

결과는 `apps/web/out`에 생성됩니다.

## GitHub Pages 배포

1. 저장소를 GitHub에 push합니다.
2. GitHub 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 지정합니다.
3. `main` 또는 `master` 브랜치에 push하거나 `Actions → Deploy Weather Route to GitHub Pages → Run workflow`를 실행합니다.
4. `.github/workflows/pages.yml`이 테스트·타입 검사·정적 빌드 후 `apps/web/out`을 배포합니다.

일반 프로젝트 Pages의 `/<repository>/` 경로와 `<owner>.github.io` 루트 저장소를 workflow가 자동 구분합니다.

## 검증

```powershell
pnpm --dir apps/web test
pnpm --dir apps/web lint
apps\web\node_modules\.bin\tsc.CMD --noEmit -p apps\web\tsconfig.json
pnpm --dir apps/web build
```

## 추천 계산 원칙

- 출근·퇴근 허용 시간에서 기본 10분 간격 후보를 만듭니다.
- 집 출발 시각과 회사 도착 시각의 예보를 이용해 이동 중 강수 노출을 근사합니다.
- 강수, 체감온도, 풍속, 자료 누락과 예보 신선도를 점수화합니다.
- 최고점과 3점 이내의 연속 후보를 하나의 좋은 시간대로 묶어 과도한 분 단위 정밀도를 피합니다.
- 현재 경로 날씨는 집과 회사 예보의 근사치이며 실제 경로별 관측이 아닙니다.

이 추천은 생활 편의를 위한 참고 정보입니다. 기상특보·재난 상황에서는 기상청과 관계기관의 공식 안내를 우선해야 합니다.

## 기존 서버 코드

`apps/api`, Docker Compose, 예보 비교·검증 코드는 이전 구현 보존용으로 남아 있지만 새 GitHub Pages 앱의 빌드·실행·배포에는 사용되지 않습니다.

