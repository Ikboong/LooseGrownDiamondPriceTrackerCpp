# LooseGrownDiamondPriceTrackerCpp

[차트 바로 보기](https://ikboong.github.io/LooseGrownDiamondPriceTrackerCpp/loosegrown.html)

[다이아 시세 검색기](https://ikboong.github.io/LooseGrownDiamondPriceTrackerCpp/search.html)

C++로 네 사이트의 지정 검색 조건에 맞는 최저 표시가를 매일 누적합니다.

## 다이아 시세 검색기

- 모양, White/Fancy 색상, 강도, 캐럿, 투명도, 컷, USD 가격과 고급 조건을 선택해 네 사이트의 현재 공개 표시가를 검색합니다.
- 고급 조건은 테이블 비율, 가로세로 비율, 연마, 대칭, 형광, 감정기관, 성장 방식을 지원합니다. 첨부 인터페이스의 컷 네 등급과 연마·대칭 세 등급을 사용합니다.
- 결과에는 판매처, 가격, 캐럿·등급, 조회 시각과 실제 상품 링크를 표시하며 가격순으로 정렬할 수 있습니다. 조건 변경 시 이전 결과는 지웁니다.
- 여러 사이트에 같은 상품 ID가 있으면 가장 싼 판매처 한 곳만 남깁니다. 가격이 같으면 Loose Grown Diamond, Carbon Sparkle, Aurelinne, Altura 순서에서 먼저 나온 판매처를 유지합니다.
- Loose Grown Diamond는 여러 팬시 색상을 색상별로 조회한 뒤 합칩니다. 해당 사이트가 지원하지 않는 조건은 명시적으로 표시합니다.
- 한 사이트당 최대 400개 상품을 조회합니다. 결과가 더 많거나 일부 페이지가 실패하면 **일부 결과**로 표시하므로 완전 조회된 검색과 구분할 수 있습니다.
- 실시간 조회는 공개 재고 API만 사용하는 전용 Cloudflare Worker가 중계합니다. 원사이트의 조회 실패·요청 제한을 정상 가격으로 바꾸지 않습니다. 검색 결과는 일별 차트 기록에 저장되지 않습니다.

검색 페이지의 파일은 `docs/search.html`, `search.css`, `search-ui.mjs`이며, 브라우저와 Worker는 `docs/search-core.mjs`의 검증·필터 매핑을 공유합니다. `docs/search-config.json`은 공개 검색 서버 주소만 포함합니다. 계정 토큰은 포함하지 않습니다.

Worker 소스와 배포 설정은 `worker/`에 있습니다. 공유 코어 또는 Worker를 수정한 경우 다음 명령으로 별도 배포한 뒤 Pages도 배포합니다.

```powershell
npx wrangler deploy --config worker/wrangler.jsonc
```

## 차트와 전체 사이트 토글

- **전체 사이트 최저가 OFF**: 기존 Loose Grown Diamond의 일별 기록을 표시합니다.
- **전체 사이트 최저가 ON**: Loose Grown Diamond, Carbon Sparkle, Aurelinne, Altura Diamonds의 같은 날짜 최저 표시가 중 최솟값을 표시합니다.
- iOS 스타일 스위치는 클릭, Space, Enter로 조작할 수 있습니다.
- 일봉은 TradingView Lightweight Charts 라인차트, 주봉은 일별 최저가를 월요일 시작 주간 OHLC로 집계한 캔들차트입니다. 상승은 빨강, 하락은 파랑입니다.
- 통합 기록은 2026-10-16부터 수집합니다. 기존 단일 사이트의 과거 기록을 전체 사이트 관측값으로 소급 복제하지 않습니다.
- 사이트별 최근 가격, 관측 시각, 검색 결과 링크와 최저가 출처를 함께 표시합니다.
- 일부 사이트가 실패하면 확인된 사이트 수를 표시합니다. 실패한 사이트의 과거 가격은 당일 통합 최저가에 재사용하지 않습니다. 조회 성공 후 조건 일치 상품이 0개인 경우는 `no_matches`로 구분합니다.
- 모든 가격은 **USD 상품 표시가**입니다. 배송비, 세금, 결제 단계 비용은 포함하지 않습니다. 각 사이트는 아래에 명시한 자체 검색 조건을 유지하므로 조건 범위가 완전히 동일하지는 않습니다.

## 수집 대상

대상 URL:

[Loose Grown Diamond 검색 결과 열기](https://www.loosegrowndiamond.com/lab-created-colored-diamonds/?shape=heart&carat=5.00,51.03&certificate=1,2&intensity=4&cut=3.00,4.00&color=pink&clarity=7.00,11.00)

| 사이트 | 지정 검색 조건 | 링크 |
|---|---|---|
| Carbon Sparkle | Heart, Pink/Red, 5–50ct, VVS2–FL, Fancy Deep–Fancy Vivid, ID | [검색 결과](https://www.carbonsparkle.com/pages/diamonds?activeTab=Lab+Grown&queryLabGrown=true&isFancy=true&fancy_color=Red%2CPink&carats_min=5&carats_max=50&clarity_min=VVS2&clarity_max=FL&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid&cut_min=ID&cut_max=ID&shapes=heart) |
| Aurelinne | Heart, Pink/Red, 5–20ct, VVS2–FL, Fancy Deep–Fancy Vivid, ID | [검색 결과](https://aurelinne.com/pages/lab-grown?activeTab=Lab+Grown&queryLabGrown=true&isFancy=true&carats_min=5&carats_max=20&clarity_min=VVS2&clarity_max=FL&fancy_color=Pink%2CRed&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid&cut_min=ID&cut_max=ID&shapes=heart) |
| Altura Diamonds | Heart, Pink/Red, 5–20ct, VVS2–FL, Fancy Deep–Fancy Vivid, ID, Polish EX, Symmetry EX | [검색 결과](https://alturadiamonds.com/collections/lab-diamonds?activeTab=Lab+Grown&queryLabGrown=true&shapes=heart&carats_min=5&carats_max=20&cut_min=ID&cut_max=ID&clarity_min=VVS2&clarity_max=FL&polish=EX&symmetry=EX&isFancy=true&fancy_color=Pink%2CRed&intensity_min=Fancy_Deep&intensity_max=Fancy_Vivid) |

수집 방식:

- `wp-json/ls/v1/inventory-colored` API를 호출합니다.
- 컬러 다이아 검색 결과 API의 `price`를 화면 표시가로 사용합니다.
- 사이트 공통 프로모션 배너는 다른 상품군에 적용될 수 있으므로 가격에 중복 적용하지 않습니다.
- API의 `org_price`는 화면 취소선 원가로 기록합니다.
- 추가 세 사이트는 각 도메인의 Nivoda Connect 공개 API `/apps/diamond-proxy/api/count`와 `/apps/diamond-proxy/api/v2/feed`를 사용합니다.
- Nivoda의 표시 가격은 `discountedPrice`가 유효하게 설정되어 있으면 그 값, 그 외에는 `price`를 사용합니다. 배너 할인을 추가로 곱하지 않습니다.
- API에 오름차순 정렬을 요청해도 최종 표시 가격이 순서대로 오지 않으므로 **전체 페이지를 조회**해 최저가를 계산합니다. 불완전한 페이지 응답이나 중복 ID는 오류로 기록하고 부분 재고의 가격을 확정 최저가로 저장하지 않습니다.
- 링크에 없는 기본 필터도 실제 각 사이트 검색 앱과 맞춥니다. Carbon Sparkle의 감정서는 GIA/IGI/GCAL/NONE/OTHER, Aurelinne은 GIA/IGI/HRD/WISE, Altura는 GIA/IGI이며, Altura의 Polish/Symmetry는 EX입니다. 나머지 두 사이트는 GD/VG/EX를 허용합니다. 공통 기본 비율은 0.8–3이고 형광은 전체 다섯 등급입니다.
- Fancy 다이아의 `cut=null`은 사이트 검색에서도 반환되므로 제거하지 않습니다. 요청의 `cut=["ID"]` 필터는 유지합니다.
- 한 사이트의 조회 실패가 다른 사이트 수집을 막지 않습니다. 기존 정책대로 오류를 CSV에 남기고 워크플로를 계속하므로 당일 수집 성공 여부는 `Status`를 확인해야 합니다.

출력:

- `data/loosegrown_price_history.csv`
- `data/site_price_history.csv`: 네 사이트별 관측 기록. 기존 CSV 필드에 `SourceId`, `Currency`를 추가합니다.
- `data/loosegrown_tradingview_chart.html`
- `docs/loosegrown.html`: GitHub Pages 배포용 차트

알림:

- GitHub Actions 실행 시 기존 Loose Grown Diamond CSV의 최근 두 성공 날짜를 비교합니다.
- 전일 대비 최저 표시가가 20% 이상 상승하거나 하락하면 GitHub Issue를 자동 생성합니다.
- 같은 제목의 open issue가 이미 있으면 중복 생성하지 않습니다.

빌드:

```powershell
.\build.ps1
```

1회 실행:

```powershell
.\run.ps1
```

조회 없이 저장된 CSV로 차트만 다시 생성하거나 특정 사이트만 조회할 수도 있습니다.

```powershell
.\run.ps1 -ChartOnly
.\run.ps1 -Source carbonsparkle
```

테스트:

```powershell
ctest --test-dir build -C Release --output-on-failure
node --test tests/chart_data.test.cjs
node --test tests/search_core.test.mjs tests/search_worker.test.mjs
```

API 어댑터 테스트는 실제 공개 응답을 축약한 fixture를 사용하며 네트워크에 의존하지 않습니다. 차트 테스트는 날짜별 최저가, 마지막 오류 우선, 통화, 주간 OHLC, 토글·테마·오류 화면을 검증합니다. CI에서 수집 전에 두 테스트를 실행합니다.

JSON 파싱에는 MIT 라이선스의 [nlohmann/json 3.11.3](https://github.com/nlohmann/json/tree/v3.11.3)을 사용합니다. 헤더와 라이선스는 `third_party/nlohmann`에 포함되어 있어 빌드 중 추가 다운로드가 필요 없습니다.

로컬 Windows 예약 작업:

```powershell
.\install_task.ps1 -Time "09:00"
```

GitHub Actions:

repo 루트의 `.github/workflows/daily-loosegrown-price-tracker.yml`은 `workflow_dispatch`로 실행됩니다. JobKorea와 동일하게 Cloudflare Worker Cron Trigger에서 매일 09:00 KST에 이 workflow를 호출하도록 둡니다.

Cloudflare cron:

```text
0 0 * * *
```

Cloudflare cron은 UTC 기준이므로 `0 0 * * *`가 한국시간 09:00입니다.

저장소 Actions 권한에서 `Read and write permissions`가 허용되어 있어야 하며, Pages는 `GitHub Actions` 소스로 배포되도록 설정합니다.
