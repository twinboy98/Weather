# 공식 API 등록 안내

- KMA 단기예보: [공공데이터포털 공식 데이터셋](https://www.data.go.kr/data/15084084/openapi.do)에서 활용 신청 후 `KMA_SERVICE_KEY`에 설정합니다.
- KMA 관측/레이더: [기상청 APIHub](https://apihub.kma.go.kr/)의 개별 데이터셋을 신청하고 `KMA_APIHUB_KEY`에 설정합니다.
- MET Norway: 키는 없지만 공식 정책에 맞는 식별 가능한 `MET_NORWAY_USER_AGENT`가 필수입니다.
- Windy: Point Forecast 전용 키가 필요합니다. Testing 키는 평가에 사용할 수 없습니다.
- AccuWeather: 일반 키만 설정해도 활성화되지 않습니다. 별도 계약 확인 환경변수와 계약 범위를 담은 정책 파일이 모두 필요합니다.

키는 `.env`에만 저장하고 로그, 브라우저 번들, GitHub export에 포함하지 않습니다.

