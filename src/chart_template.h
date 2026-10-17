#pragma once

#include <string>

// Inert JSON script elements still need to escape '<' so a product field cannot
// terminate the element with a literal </script> tag.
inline std::string ChartScriptJson(const std::string& json) {
    std::string safe;
    safe.reserve(json.size());
    for (char ch : json) {
        if (ch == '<') safe += "\\u003c";
        else safe.push_back(ch);
    }
    return safe;
}

inline std::string RenderChartHtml(const std::string& dailyJson,
                                 const std::string& siteJson,
                                 const std::string& sourcesJson) {
    return std::string(R"chart(<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Diamond Lowest Price Charts</title>
  <script defer src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    :root { color-scheme: dark; --bg:#111418; --panel:#1a1f25; --panel-border:#2a3037; --text:#d3dbe4; --muted:#94a1b0; --grid:#242a30; --blue:#4d94eb; --button:#252b32; --button-border:#3b4653; --green:#34c759; --warning:#edc578; }
    :root.light { color-scheme:light; --bg:#f4f6f8; --panel:#fff; --panel-border:#d7dde4; --text:#1d2630; --muted:#5c6978; --grid:#eef1f4; --blue:#2f78d1; --button:#eef2f6; --button-border:#c7d0db; --green:#248a3d; --warning:#8b5c0d; }
    * { box-sizing:border-box; }
    [hidden] { display:none !important; }
    body { margin:0; min-height:100vh; font-family:Arial,Helvetica,sans-serif; color:var(--text); background:var(--bg); }
    main { width:min(100%,1600px); margin:0 auto; padding:24px 48px 34px; }
    header { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; margin-bottom:22px; }
    h1 { margin:0 0 7px; font-size:30px; line-height:1.15; }
    .subtitle { color:var(--muted); font-size:15px; line-height:1.6; overflow-wrap:anywhere; }
    button { border:1px solid var(--button-border); border-radius:8px; background:var(--button); color:var(--text); cursor:pointer; font:inherit; min-height:44px; padding:0 19px; }
    button:focus-visible, a:focus-visible { outline:3px solid var(--blue); outline-offset:4px; }
    button.active { background:var(--blue); border-color:var(--blue); color:#fff; }
    .controls { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:15px; margin-bottom:12px; }
    .tabs { display:flex; gap:9px; }
    .switch { display:inline-flex; align-items:center; gap:12px; min-height:48px; padding:2px 0; background:transparent; border:0; font-size:15px; font-weight:600; }
    .switch-track { position:relative; display:block; flex:none; width:51px; height:31px; border-radius:20px; background:#68727e; transition:background .2s ease; box-shadow:inset 0 0 0 1px rgba(0,0,0,.07); }
    .switch-thumb { position:absolute; top:2px; left:2px; width:27px; height:27px; background:white; border-radius:50%; box-shadow:0 2px 5px rgba(0,0,0,.25); transition:transform .2s ease; }
    .switch[aria-checked="true"] .switch-track { background:var(--green); }
    .switch[aria-checked="true"] .switch-thumb { transform:translateX(20px); }
    .scope-note { margin:0 0 16px; color:var(--muted); font-size:13px; line-height:1.6; }
    .coverage { display:flex; flex-wrap:wrap; gap:7px 16px; align-items:baseline; margin-bottom:14px; font-size:14px; line-height:1.5; }
    .coverage strong { font-size:16px; }
    .coverage[data-partial="true"] strong { color:var(--warning); }
    .coverage span { color:var(--muted); }
    .sites { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; list-style:none; margin:0 0 18px; padding:0; }
    .site { min-width:0; border:1px solid var(--panel-border); border-radius:10px; padding:15px 16px; background:var(--panel); }
    .site.winner { border-color:var(--green); }
    .site-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; line-height:1.5; }
    a { color:var(--blue); text-underline-offset:3px; }
    .badge { font-size:11px; color:var(--green); white-space:nowrap; }
    .site-price { font-size:23px; font-weight:600; margin:10px 0 6px; line-height:1.2; }
    .site-meta { color:var(--muted); font-size:12px; line-height:1.65; overflow-wrap:anywhere; }
    .site-message { color:var(--warning); font-size:12px; line-height:1.5; margin-top:5px; overflow-wrap:anywhere; }
    .chart-shell { position:relative; height:min(70vh,780px); min-height:430px; border:1px solid var(--panel-border); border-radius:8px; background:var(--panel); overflow:hidden; }
    #chart { width:100%; height:100%; }
    .empty { border:1px solid var(--panel-border); border-radius:8px; padding:32px 25px; background:var(--panel); color:var(--muted); line-height:1.7; }
    .observation { min-height:46px; padding:12px 0 0; color:var(--muted); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
    .footer { margin-top:16px; color:var(--muted); font-size:12px; line-height:1.7; }
    @media (max-width:1000px) { .sites { grid-template-columns:repeat(2,minmax(0,1fr)); } }
    @media (max-width:760px) { main { padding:18px 14px 28px; } header { gap:12px; } h1 { font-size:24px; } .subtitle { font-size:13px; } button { padding:0 13px; } .controls { align-items:flex-start; gap:10px; } .switch { font-size:14px; } .chart-shell { height:62vh; min-height:380px; } .site { padding:12px; } .site-price { font-size:21px; } }
    @media (max-width:390px) { .controls { flex-direction:column-reverse; } .site-head { flex-wrap:wrap; } }
    @media (prefers-reduced-motion:reduce) { .switch-track,.switch-thumb { transition:none; } }
  </style>
</head>
<body>
<main>
  <header>
    <div><h1 id="heading">Loose Grown Diamond Charts</h1><div class="subtitle" id="subtitle" aria-live="polite"></div></div>
    <button id="themeButton" type="button" aria-label="밝은 테마로 전환">Light</button>
  </header>
  <div class="controls">
    <div class="tabs" aria-label="차트 종류">
      <button class="active" id="dailyButton" type="button" aria-pressed="true">Daily line</button>
      <button id="weeklyButton" type="button" aria-pressed="false">Weekly candle</button>
    </div>
    <button class="switch" id="allSitesSwitch" type="button" role="switch" aria-checked="false" aria-describedby="scopeNote">
      <span>전체 사이트 최저가 · 10ct 이상</span><span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    </button>
  </div>
  <p class="scope-note" id="scopeNote"></p>
  <div class="coverage" id="coverage" aria-live="polite" hidden><strong id="coverageText"></strong><span id="coverageTime"></span></div>
  <ul class="sites" id="siteCards" aria-label="사이트별 최근 조회 결과" hidden></ul>
  <div id="empty" class="empty" role="status" hidden></div>
  <section class="chart-shell" id="chartShell" aria-label="USD 최저가 차트"><div id="chart"></div></section>
  <div class="observation" id="observation" aria-live="off"></div>
  <p class="footer">Prices in USD · 기록된 최저 표시가이며 현재 구매 가능 여부는 각 사이트에서 확인할 수 있습니다.<br>Weekly candle: 월요일 기준, 일별 최저가의 시가·고가·저가·종가. 상승 빨강 / 하락 파랑.</p>
</main>
<script id="daily-json" type="application/json">)chart") + ChartScriptJson(dailyJson) + R"chart(</script>
<script id="site-json" type="application/json">)chart" + ChartScriptJson(siteJson) + R"chart(</script>
<script id="sources-json" type="application/json">)chart" + ChartScriptJson(sourcesJson) + R"chart(</script>
<script id="chart-data-helpers">
(function (root) {
  'use strict';
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }
  function validPrice(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
  function latestByDate(rows, key) {
    const latest = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !validDate(row.time)) continue;
      const id = key(row);
      const previous = latest.get(id);
      // Equal timestamps use the last stored attempt, including an error.
      if (!previous || String(row.timestamp || '') >= String(previous.timestamp || '')) latest.set(id, row);
    }
    return latest;
  }
  function normalizeSources(sources) {
    const seen = new Set();
    return (Array.isArray(sources) ? sources : []).filter(source => {
      if (!source || typeof source.id !== 'string' || !source.id || seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    });
  }
  function siteState(source, row) {
    if (!row) return { source, status:'missing', checked:false, record:null, message:'이 날짜의 수집 기록 없음' };
    if (row.status === 'error') return { source, status:'error', checked:false, record:row, message:row.message || '조회 실패' };
    if (row.currency !== 'USD') return { source, status:'unsupported', checked:false, record:row, message:'USD가 아닌 통화는 비교에서 제외합니다.' };
    if (row.status === 'no_matches') return { source, status:'no_matches', checked:true, record:row, message:row.message || '지정 조건에 맞는 상품 없음' };
    if (row.status === 'ok' && validPrice(row.value)) return { source, status:'ok', checked:true, record:row, message:'' };
    return { source, status:'error', checked:false, record:row, message:row.message || '유효한 USD 가격 없음' };
  }
  function aggregateSites(rows, inputSources) {
    const sources = normalizeSources(inputSources);
    const sourceIds = new Set(sources.map(source => source.id));
    const knownRows = (Array.isArray(rows) ? rows : []).filter(row => row && sourceIds.has(row.siteId));
    const latest = latestByDate(knownRows, row => row.time + '\n' + row.siteId);
    const dates = Array.from(new Set(Array.from(latest.values(), row => row.time))).sort();
    const days = dates.map(time => {
      const states = sources.map(source => siteState(source, latest.get(time + '\n' + source.id)));
      let winner = null;
      for (const state of states) {
        if (state.status === 'ok' && (!winner || state.record.value < winner.record.value)) winner = state;
      }
      const timestamps = states.filter(state => state.record).map(state => String(state.record.timestamp || '')).sort();
      const checkedCount = states.filter(state => state.checked).length;
      return { time, timestamp:timestamps[timestamps.length - 1] || '', states, winner,
        value:winner ? winner.record.value : null, checkedCount, totalSites:sources.length,
        partial:checkedCount < sources.length,
        siteId:winner ? winner.source.id : '', sourceName:winner ? winner.source.name : '',
        sku:winner ? winner.record.sku : '', carat:winner ? winner.record.carat : '' };
    });
    return { sources, days, points:days.filter(day => day.winner), latest:days.length ? days[days.length - 1] : null };
  }
  function normalizeDaily(rows) {
    return Array.from(latestByDate(rows, row => row.time).values())
      .filter(row => validPrice(row.value)).sort((left, right) => left.time.localeCompare(right.time));
  }
  function weekStartIso(isoDate) {
    const date = new Date(isoDate + 'T00:00:00Z');
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }
  function toWeeklyCandles(rows) {
    const grouped = new Map();
    for (const row of rows.slice().sort((left, right) => left.time.localeCompare(right.time))) {
      if (!validDate(row.time) || !validPrice(row.value)) continue;
      const week = weekStartIso(row.time);
      if (!grouped.has(week)) grouped.set(week, {time:week,open:row.value,high:row.value,low:row.value,close:row.value});
      else { const candle = grouped.get(week); candle.high = Math.max(candle.high,row.value); candle.low = Math.min(candle.low,row.value); candle.close = row.value; }
    }
    return Array.from(grouped.values());
  }
  function safeSourceUrl(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch (error) { return null; }
  }
  root.ChartData = { validDate, validPrice, normalizeDaily, normalizeSources, aggregateSites, weekStartIso, toWeeklyCandles, safeSourceUrl };
})(globalThis);
</script>
<script>
document.addEventListener('DOMContentLoaded', function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const helper = globalThis.ChartData;
  const formatPrice = price => '$' + price.toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:2});
  const formatTime = timestamp => timestamp ? String(timestamp).replace(/\s*KST$/, '') + ' KST' : '조회 시각 없음';
  let dailyData = [], allData = {sources:[],days:[],points:[],latest:null};
  let dataError = '';
  try {
    dailyData = helper.normalizeDaily(JSON.parse(byId('daily-json').textContent));
    allData = helper.aggregateSites(JSON.parse(byId('site-json').textContent), JSON.parse(byId('sources-json').textContent));
  } catch (error) { dataError = '저장된 차트 데이터를 읽을 수 없습니다: ' + error.message; }
  let allSites = false, activeView = 'daily', currentChart = null;
  let isLight = false;
  try { isLight = localStorage.getItem('diamond-chart-theme') === 'light'; } catch (error) { /* Storage may be disabled; the theme still works for this page. */ }
  function setTheme() {
    document.documentElement.classList.toggle('light',isLight);
    byId('themeButton').textContent = isLight ? 'Dark' : 'Light';
    byId('themeButton').setAttribute('aria-label',isLight ? '어두운 테마로 전환' : '밝은 테마로 전환');
  }
  function coverageText(day) {
    if (!day) return '0/' + allData.sources.length + ' 사이트 확인 · 수집 기록 없음';
    return day.checkedCount + '/' + day.totalSites + ' 사이트 확인' + (day.partial ? ' · 일부 사이트 조회 실패 또는 미수집' : '');
  }
  function addText(parent, tag, className, text) {
    const element = document.createElement(tag); element.className = className; element.textContent = text; parent.appendChild(element); return element;
  }
  function renderSiteCards() {
    const list = byId('siteCards'); list.replaceChildren(); list.hidden = !allSites;
    if (!allSites) return;
    const latest = allData.latest;
    const states = latest ? latest.states : allData.sources.map(source => ({source,status:'missing',record:null,message:'수집 기록 없음'}));
    states.forEach(state => {
      const item = document.createElement('li'); item.className = 'site';
      const winner = latest && latest.winner && latest.winner.source.id === state.source.id;
      if (winner) item.classList.add('winner');
      const head = addText(item,'div','site-head','');
      const url = helper.safeSourceUrl(state.source.url);
      const name = addText(head,url ? 'a' : 'span','',state.source.name || state.source.id);
      if (url) { name.href = url; name.target = '_blank'; name.rel = 'noopener noreferrer'; name.setAttribute('aria-label',(state.source.name || state.source.id) + ' 검색 결과 새 창에서 열기'); }
      if (winner) addText(head,'span','badge','관측 최저가');
      const labels = {no_matches:'조건 일치 없음',error:'조회 실패',missing:'미수집',unsupported:'통화 확인 필요'};
      addText(item,'div','site-price',state.status === 'ok' ? formatPrice(state.record.value) : labels[state.status] || '가격 없음');
      if (state.record && state.status === 'ok') {
        addText(item,'div','site-meta',[state.record.carat ? state.record.carat + ' ct' : '',state.record.sku ? 'SKU ' + state.record.sku : ''].filter(Boolean).join(' · '));
      }
      addText(item,'div','site-meta',state.record ? formatTime(state.record.timestamp) : latest ? latest.time + ' · 수집 기록 없음' : '수집 기록 없음');
      if (state.message) addText(item,'div','site-message',state.message);
      list.appendChild(item);
    });
  }
  function observationText(row, weekly) {
    if (!row) return '';
    const details = [row.time,formatPrice(row.value)];
    if (weekly) details.unshift('주간 종가 관측');
    if (allSites) {
      details.push(row.sourceName || row.siteId,coverageText(row));
      if (row.winner) details.push(formatTime(row.winner.record.timestamp));
    } else { details.push('Loose Grown Diamond',formatTime(row.timestamp)); }
    if (row.carat) details.push(row.carat + ' ct');
    if (row.sku) details.push('SKU ' + row.sku);
    return details.join(' · ');
  }
  function chartOptions() {
    const styles = getComputedStyle(document.documentElement);
    const color = name => styles.getPropertyValue(name).trim();
    return { autoSize:true, layout:{background:{color:color('--panel')},textColor:color('--text')},
      grid:{vertLines:{color:color('--grid')},horzLines:{color:color('--grid')}},
      rightPriceScale:{borderColor:color('--panel-border')},timeScale:{borderColor:color('--panel-border'),timeVisible:false},
      localization:{priceFormatter:formatPrice},crosshair:{mode:LightweightCharts.CrosshairMode.Normal} };
  }
  function renderChart() {
    if (currentChart) { currentChart.remove(); currentChart = null; }
    byId('chart').replaceChildren();
    const rows = allSites ? allData.points : dailyData;
    const last = rows.length ? rows[rows.length - 1] : null;
    const latest = allData.latest;
    byId('heading').textContent = allSites ? 'All Sites · Lowest Price Charts' : 'Loose Grown Diamond Charts';
    byId('allSitesSwitch').setAttribute('aria-checked',String(allSites));
    byId('dailyButton').classList.toggle('active',activeView === 'daily');
    byId('weeklyButton').classList.toggle('active',activeView === 'weekly');
    byId('dailyButton').setAttribute('aria-pressed',String(activeView === 'daily'));
    byId('weeklyButton').setAttribute('aria-pressed',String(activeView === 'weekly'));
    byId('scopeNote').textContent = allSites
      ? '대상 ' + allData.sources.length + '개 사이트에서 최소 10ct 조건의 USD 최저가를 비교합니다. 10ct 기준으로 수집한 기록부터 표시하며, 기존 5ct 기록은 포함하지 않습니다. 같은 날짜의 마지막 조회 결과를 사용하며, 사이트별 나머지 검색 조건과 최대 캐럿은 유지합니다.'
      : 'Loose Grown Diamond의 기존 5ct 이상 일별 가격 기록입니다. 전체 사이트 비교를 켜면 별도로 수집한 10ct 이상 최저가를 표시합니다.';
    byId('coverage').hidden = !allSites;
    byId('coverageText').textContent = coverageText(latest);
    byId('coverage').dataset.partial = String(!latest || latest.partial);
    byId('coverageTime').textContent = latest ? '최근 조회: ' + formatTime(latest.timestamp) : '';
    if (allSites) {
      byId('subtitle').textContent = latest && latest.winner
        ? latest.time + ' · ' + formatPrice(latest.value) + ' · ' + (latest.sourceName || latest.siteId) + ' · ' + rows.length + ' daily points'
        : latest ? latest.time + ' · 최신 조회에서 비교 가능한 가격 없음' : '전체 사이트 비교 수집을 기다리고 있습니다.';
    } else {
      byId('subtitle').textContent = last ? 'Latest: ' + formatTime(last.timestamp) + ' / ' + formatPrice(last.value) + ' / ' + rows.length + ' daily points' : '아직 성공한 가격 기록이 없습니다.';
    }
    renderSiteCards();
    byId('observation').textContent = observationText(last,activeView === 'weekly');
    const noCurrentPrice = allSites && latest && !latest.winner;
    let emptyMessage = dataError;
    if (!emptyMessage && !rows.length) emptyMessage = allSites ? '비교 가능한 USD 가격이 아직 없습니다. 위 사이트별 조회 상태를 확인해 주세요. 토글을 끄면 기존 차트를 볼 수 있습니다.' : '아직 성공한 가격 기록이 없습니다.';
    if (!emptyMessage && noCurrentPrice) emptyMessage = '최신 조회에서 비교 가능한 USD 가격이 없습니다. 위 상태는 최신 조회 결과이며, 아래 차트에는 이전에 수집한 기록만 표시합니다.';
    let libraryError = '';
    if (rows.length && !dataError && !globalThis.LightweightCharts) libraryError = '차트 라이브러리를 불러오지 못했습니다. 네트워크 연결 후 페이지를 다시 열어 주세요. 가격과 사이트별 결과는 위에서 확인할 수 있습니다.';
    byId('empty').hidden = !(emptyMessage || libraryError);
    byId('empty').textContent = [emptyMessage,libraryError].filter(Boolean).join(' ');
    byId('chartShell').hidden = !rows.length || !!dataError || !!libraryError;
    if (byId('chartShell').hidden) return;
    try {
      currentChart = LightweightCharts.createChart(byId('chart'),chartOptions());
      if (activeView === 'daily') {
        const line = currentChart.addLineSeries({color:getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(),lineWidth:2,priceLineVisible:true});
        const lineRows = allSites ? allData.days : rows;
        line.setData(lineRows.map(row => helper.validPrice(row.value) ? {time:row.time,value:row.value} : {time:row.time}));
      } else {
        const candles = currentChart.addCandlestickSeries({upColor:'#d44d4d',downColor:'#2f78d1',borderUpColor:'#d44d4d',borderDownColor:'#2f78d1',wickUpColor:'#d44d4d',wickDownColor:'#2f78d1'});
        candles.setData(helper.toWeeklyCandles(rows));
      }
      currentChart.subscribeCrosshairMove(param => {
        const time = typeof param.time === 'string' ? param.time : param.time && typeof param.time === 'object' ? param.time.year + '-' + String(param.time.month).padStart(2,'0') + '-' + String(param.time.day).padStart(2,'0') : '';
        const point = activeView === 'daily' ? rows.find(row => row.time === time) : rows.filter(row => helper.weekStartIso(row.time) === time).pop();
        byId('observation').textContent = observationText(point || last,activeView === 'weekly');
      });
      currentChart.timeScale().fitContent();
    } catch (error) {
      if (currentChart) { currentChart.remove(); currentChart = null; }
      byId('chartShell').hidden = true; byId('empty').hidden = false;
      byId('empty').textContent = '차트를 표시할 수 없습니다: ' + error.message;
    }
  }
  byId('allSitesSwitch').addEventListener('click',() => { allSites = !allSites; renderChart(); });
  byId('dailyButton').addEventListener('click',() => { activeView = 'daily'; renderChart(); });
  byId('weeklyButton').addEventListener('click',() => { activeView = 'weekly'; renderChart(); });
  byId('themeButton').addEventListener('click',() => {
    isLight = !isLight; setTheme();
    try { localStorage.setItem('diamond-chart-theme',isLight ? 'light' : 'dark'); } catch (error) { /* Theme is usable without persistent storage. */ }
    renderChart();
  });
  setTheme(); renderChart();
});
</script>
</body>
</html>
)chart";
}
