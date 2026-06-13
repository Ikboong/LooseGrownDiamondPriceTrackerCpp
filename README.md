# LooseGrownDiamondPriceTrackerCpp

[차트 바로 보기](https://ikboong.github.io/LooseGrownDiamondPriceTrackerCpp/loosegrown.html)

C++로 Loose Grown Diamond 검색 조건의 최저 표시가를 매일 누적합니다.

대상 URL:

[Loose Grown Diamond 검색 결과 열기](https://www.loosegrowndiamond.com/lab-created-colored-diamonds/?shape=heart&carat=5.00,51.03&certificate=1,2&intensity=4&cut=3.00,4.00&color=pink&clarity=7.00,11.00)

수집 방식:

- `wp-json/ls/v1/inventory-colored` API를 호출합니다.
- 컬러 다이아 검색 결과 API의 `price`를 화면 표시가로 사용합니다.
- 사이트 공통 프로모션 배너는 다른 상품군에 적용될 수 있으므로 가격에 중복 적용하지 않습니다.
- API의 `org_price`는 화면 취소선 원가로 기록합니다.

출력:

- `data/loosegrown_price_history.csv`
- `data/loosegrown_tradingview_chart.html`

알림:

- GitHub Actions 실행 시 CSV의 최근 두 날짜를 비교합니다.
- 전일 대비 최저 표시가가 20% 이상 상승하거나 하락하면 GitHub Issue를 자동 생성합니다.
- 같은 제목의 open issue가 이미 있으면 중복 생성하지 않습니다.

차트:

- 일봉: TradingView Lightweight Charts 라인차트
- 주봉: 일봉 최저가를 주 단위 OHLC로 집계한 TradingView 캔들차트

빌드:

```powershell
.\build.ps1
```

1회 실행:

```powershell
.\run.ps1
```

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
