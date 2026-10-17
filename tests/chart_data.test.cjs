'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const template = fs.readFileSync(path.join(__dirname, '../src/chart_template.h'), 'utf8');
const helperMatch = template.match(/<script id="chart-data-helpers">([\s\S]*?)<\/script>/);
assert.ok(helperMatch, 'The chart must expose its pure data helpers.');
const helperScript = helperMatch[1];
const uiScripts = Array.from(template.matchAll(/<script>([\s\S]*?)<\/script>/g));
assert.equal(uiScripts.length, 1, 'The template must contain one chart UI script.');
const uiScript = uiScripts[0][1];

const sources = ['lgd', 'carbon', 'aurelinne', 'altura'].map(id => ({
  id,
  name: id,
  url: 'https://example.com/' + id,
}));

function row(siteId, value, extra = {}) {
  return {
    time: '2026-10-16',
    timestamp: '2026-10-16 09:00:00 KST',
    siteId,
    status: 'ok',
    currency: 'USD',
    value,
    sku: siteId + '-sku',
    carat: '5.12',
    ...extra,
  };
}

function helpers() {
  const context = vm.createContext({ URL });
  vm.runInContext(helperScript, context, { filename: 'chart-data-helpers.js' });
  return context.ChartData;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('the helper and UI scripts have valid JavaScript syntax', () => {
  assert.doesNotThrow(() => new vm.Script(helperScript));
  assert.doesNotThrow(() => new vm.Script(uiScript));
});

test('full coverage selects the lowest USD price and preserves its source', () => {
  const result = helpers().aggregateSites([
    row('lgd', 2013), row('carbon', 1800), row('aurelinne', 1900), row('altura', 1700),
  ], sources);
  assert.equal(result.latest.value, 1700);
  assert.equal(result.latest.siteId, 'altura');
  assert.equal(result.latest.winner.record.sku, 'altura-sku');
  assert.equal(result.latest.checkedCount, 4);
  assert.equal(result.latest.totalSites, 4);
  assert.equal(result.latest.partial, false);
});

test('the chronologically latest attempt wins even when input order differs', () => {
  const result = helpers().aggregateSites([
    row('lgd', null, { timestamp: '2026-10-16 10:00:00 KST', status: 'error' }),
    row('lgd', 1000),
    row('carbon', 1400),
  ], sources);
  assert.equal(result.latest.value, 1400);
  assert.equal(result.latest.states[0].status, 'error');
  assert.equal(result.latest.checkedCount, 1);
  assert.equal(result.latest.partial, true);
});

test('an equally timed later stored error cannot resurrect an earlier success', () => {
  const result = helpers().aggregateSites([
    row('lgd', 900), row('lgd', null, { status: 'error', message: 'HTTP 403' }),
  ], sources);
  assert.equal(result.latest.winner, null);
  assert.equal(result.latest.value, null);
  assert.equal(result.points.length, 0);
  assert.equal(result.latest.states[0].message, 'HTTP 403');
});

test('missing sources never contribute a prior day price to the latest day', () => {
  const result = helpers().aggregateSites([
    row('lgd', 500, { time: '2026-10-15', timestamp: '2026-10-15 09:00:00 KST' }),
    row('carbon', 1500),
  ], sources);
  assert.equal(result.days.length, 2);
  assert.equal(result.latest.time, '2026-10-16');
  assert.equal(result.latest.value, 1500);
  assert.equal(result.latest.states[0].status, 'missing');
  assert.equal(result.latest.checkedCount, 1);
});

test('no_matches is checked while errors, missing sources, and non-USD are unavailable', () => {
  const result = helpers().aggregateSites([
    row('lgd', 1500),
    row('carbon', null, { status: 'no_matches' }),
    row('aurelinne', null, { status: 'error' }),
    row('altura', 900, { currency: 'EUR' }),
  ], sources);
  assert.equal(result.latest.checkedCount, 2);
  assert.equal(result.latest.value, 1500);
  assert.equal(result.latest.states[1].status, 'no_matches');
  assert.equal(result.latest.states[2].status, 'error');
  assert.equal(result.latest.states[3].status, 'unsupported');
  assert.equal(result.latest.states[3].checked, false);
});

test('unknown, invalid, and empty source records do not invent history', () => {
  const data = helpers();
  assert.equal(data.aggregateSites([], sources).latest, null);
  assert.equal(data.aggregateSites(null, sources).points.length, 0);
  assert.equal(data.aggregateSites([row('unknown', 100)], sources).days.length, 0);
  assert.equal(data.aggregateSites([row('lgd', 100, { time: '2026-02-30' })], sources).days.length, 0);
  assert.equal(data.aggregateSites([null, { siteId: 'lgd', time: 'invalid' }], sources).days.length, 0);
  assert.equal(data.aggregateSites([row('lgd', 100)], []).points.length, 0);
});

test('invalid USD prices and missing currency never enter the minimum', () => {
  const data = helpers();
  for (const value of [null, 0, -1, NaN, Infinity, '1000']) {
    const result = data.aggregateSites([row('lgd', value)], sources);
    assert.equal(result.latest.value, null);
    assert.equal(result.latest.checkedCount, 0);
  }
  const result = data.aggregateSites([row('lgd', 1000, { currency: undefined })], sources);
  assert.equal(result.latest.value, null);
  assert.equal(result.latest.states[0].status, 'unsupported');
});

test('legacy daily dates are sorted and deduplicated without importing them into site history', () => {
  const data = helpers();
  const daily = data.normalizeDaily([
    { time: '2026-10-16', timestamp: '2026-10-16 09:00:00', value: 2000 },
    { time: '2026-10-15', timestamp: '2026-10-15 09:00:00', value: 2100 },
    { time: '2026-10-16', timestamp: '2026-10-16 10:00:00', value: 1900 },
    { time: '2026-10-14', value: -10 },
  ]);
  assert.deepEqual(plain(daily.map(point => [point.time, point.value])), [
    ['2026-10-15', 2100], ['2026-10-16', 1900],
  ]);
  assert.equal(data.aggregateSites([], sources).days.length, 0);
});

test('weekly OHLC uses chronological daily minima and Monday boundaries', () => {
  const data = helpers();
  const candles = data.toWeeklyCandles([
    { time: '2026-10-19', value: 1750 },
    { time: '2026-10-16', value: 1400 },
    { time: '2026-10-12', value: 2000 },
    { time: '2026-10-14', value: 1100 },
    { time: '2026-10-13', value: null },
    { time: 'bad', value: 100 },
  ]);
  assert.deepEqual(plain(candles), [
    { time: '2026-10-12', open: 2000, high: 2000, low: 1100, close: 1400 },
    { time: '2026-10-19', open: 1750, high: 1750, low: 1750, close: 1750 },
  ]);
  assert.equal(data.weekStartIso('2026-10-18'), '2026-10-12');
  assert.equal(data.validDate('2024-02-29'), true);
  assert.equal(data.validDate('2026-02-29'), false);
});

test('source links accept only absolute HTTPS links without credentials', () => {
  const data = helpers();
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', '/local', 'https://user:secret@example.com', null]) {
    assert.equal(data.safeSourceUrl(value), null);
  }
  assert.equal(data.safeSourceUrl('https://example.com/search?color=Pink%2CRed'), 'https://example.com/search?color=Pink%2CRed');
});

// This DOM double tests data/interaction boundaries, rather than canvas layout.
// Native <button> semantics deliver the same click handler for mouse, Enter, and
// Space; browser-level keyboard and visual checks are deliberately separate.
function element() {
  const classes = new Set();
  return {
    textContent: '', className: '', hidden: false, dataset: {}, children: [], listeners: {}, attrs: {},
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      add(name) { classes.add(name); },
      contains(name) { return classes.has(name); },
    },
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this.attrs[name] = value; },
    click() { if (this.listeners.click) this.listeners.click({ type: 'click', currentTarget: this }); },
  };
}

function page({ siteRows = [row('lgd', 1900)], dailyRows, siteSources = sources, library = true, storageThrows = false } = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  get('daily-json').textContent = JSON.stringify(dailyRows === undefined ? [
    { time: '2026-10-15', timestamp: '2026-10-15 09:00:00 KST', value: 2013, sku: 'legacy', carat: '5.12' },
  ] : dailyRows);
  get('site-json').textContent = JSON.stringify(siteRows);
  get('sources-json').textContent = JSON.stringify(siteSources);
  let onLoaded;
  const captures = { series: [], removed: 0, themeValues: [], crosshair: null };
  const document = {
    documentElement: element(), getElementById: get, createElement: element,
    addEventListener(name, callback) { assert.equal(name, 'DOMContentLoaded'); onLoaded = callback; },
  };
  const context = vm.createContext({
    URL, document,
    getComputedStyle: () => ({ getPropertyValue: () => '#111111' }),
    localStorage: {
      getItem() { if (storageThrows) throw new Error('Storage disabled'); return null; },
      setItem(key, value) { if (storageThrows) throw new Error('Storage disabled'); captures.themeValues.push([key, value]); },
    },
    LightweightCharts: library ? {
      CrosshairMode: { Normal: 0 },
      createChart() {
        return {
          remove() { captures.removed++; },
          addLineSeries() { return { setData(data) { captures.series.push({ type: 'daily', data: plain(data) }); } }; },
          addCandlestickSeries(options) { return { setData(data) { captures.series.push({ type: 'weekly', data: plain(data), options: plain(options) }); } }; },
          subscribeCrosshairMove(callback) { captures.crosshair = callback; },
          timeScale() { return { fitContent() {} }; },
        };
      },
    } : undefined,
  });
  vm.runInContext(helperScript, context, { filename: 'chart-data-helpers.js' });
  vm.runInContext(uiScript, context, { filename: 'chart-ui.js' });
  onLoaded();
  return { get, document, context, captures, lastSeries: () => captures.series.at(-1) };
}

test('native switch markup exposes keyboard and accessibility semantics', () => {
  const match = template.match(/<button\b[^>]*\bid="allSitesSwitch"[^>]*>/);
  assert.ok(match);
  assert.match(match[0], /type="button"/);
  assert.match(match[0], /role="switch"/);
  assert.match(match[0], /aria-checked="false"/);
  assert.match(match[0], /aria-describedby="scopeNote"/);
  assert.match(template, /prefers-reduced-motion:reduce/);
});

test('switch click handler changes the series and restores legacy daily data', () => {
  const ui = page({ siteRows: [row('carbon', 1900)] });
  assert.equal(ui.lastSeries().data[0].value, 2013);
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('allSitesSwitch').attrs['aria-checked'], 'true');
  assert.equal(ui.lastSeries().data[0].value, 1900);
  assert.match(ui.get('scopeNote').textContent, /최소 10ct/);
  assert.equal(ui.get('siteCards').children.length, 4);
  assert.match(ui.get('coverageText').textContent, /1\/4/);
  assert.match(ui.get('coverageText').textContent, /조회 실패 또는 미수집/);
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('allSitesSwitch').attrs['aria-checked'], 'false');
  assert.equal(ui.lastSeries().data[0].value, 2013);
  assert.match(ui.get('scopeNote').textContent, /기존 5ct 이상/);
  assert.equal(ui.get('siteCards').hidden, true);
});

test('weekly switch uses the selected source series and Korean candle colors', () => {
  const ui = page({ siteRows: [row('carbon', 1900)] });
  ui.get('allSitesSwitch').click();
  ui.get('weeklyButton').click();
  assert.equal(ui.lastSeries().type, 'weekly');
  assert.equal(ui.lastSeries().data[0].close, 1900);
  assert.equal(ui.lastSeries().options.upColor, '#d44d4d');
  assert.equal(ui.lastSeries().options.downColor, '#2f78d1');
  assert.equal(ui.get('weeklyButton').attrs['aria-pressed'], 'true');
  ui.get('allSitesSwitch').click();
  assert.equal(ui.lastSeries().data[0].close, 2013);
});

test('theme controls work across views and with disabled persistent storage', () => {
  for (const storageThrows of [false, true]) {
    const ui = page({ storageThrows });
    ui.get('themeButton').click();
    assert.equal(ui.get('themeButton').textContent, 'Dark');
    assert.equal(ui.document.documentElement.classList.contains('light'), true);
    ui.get('allSitesSwitch').click();
    assert.equal(ui.get('themeButton').textContent, 'Dark');
    ui.get('themeButton').click();
    assert.equal(ui.document.documentElement.classList.contains('light'), false);
  }
});

test('missing chart library keeps source status, switch, and theme usable', () => {
  const ui = page({ library: false });
  assert.equal(ui.get('chartShell').hidden, true);
  assert.equal(ui.get('empty').hidden, false);
  assert.match(ui.get('empty').textContent, /라이브러리를 불러오지 못했습니다/);
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('siteCards').children.length, 4);
  assert.match(ui.get('subtitle').textContent, /1,900/);
  ui.get('themeButton').click();
  assert.equal(ui.get('themeButton').textContent, 'Dark');
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('allSitesSwitch').attrs['aria-checked'], 'false');
});

test('empty source history has an explicit empty state and still restores legacy data', () => {
  const ui = page({ siteRows: [] });
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('chartShell').hidden, true);
  assert.equal(ui.get('empty').hidden, false);
  assert.match(ui.get('empty').textContent, /비교 가능한 USD 가격이 아직 없습니다/);
  ui.get('allSitesSwitch').click();
  assert.equal(ui.get('chartShell').hidden, false);
  assert.equal(ui.lastSeries().data[0].value, 2013);
});

test('latest failed date shows current failure without presenting an older winner as current', () => {
  const ui = page({ siteRows: [
    row('lgd', 1800, { time: '2026-10-15', timestamp: '2026-10-15 09:00:00 KST' }),
    row('lgd', null, { status: 'error', message: 'HTTP 403' }),
  ] });
  ui.get('allSitesSwitch').click();
  assert.match(ui.get('subtitle').textContent, /최신 조회에서 비교 가능한 가격 없음/);
  assert.doesNotMatch(ui.get('subtitle').textContent, /1,800/);
  assert.match(ui.get('empty').textContent, /이전에 수집한 기록만 표시/);
  assert.equal(ui.lastSeries().data[1].time, '2026-10-16');
  assert.equal(Object.hasOwn(ui.lastSeries().data[1], 'value'), false);
  assert.equal(ui.get('siteCards').children[0].children[1].textContent, '조회 실패');
});

test('untrusted source names and product fields remain text and unsafe links are omitted', () => {
  const maliciousName = '<img src=x onerror=alert(1)>';
  const ui = page({
    siteRows: [row('lgd', 1900, { sku: '</script><script>alert(1)</script>' })],
    siteSources: [{ id: 'lgd', name: maliciousName, url: 'javascript:alert(1)' }],
  });
  ui.get('allSitesSwitch').click();
  const card = ui.get('siteCards').children[0];
  const sourceName = card.children[0].children[0];
  assert.equal(sourceName.textContent, maliciousName);
  assert.equal(sourceName.href, undefined);
  assert.match(ui.get('observation').textContent, /<\/script><script>alert\(1\)<\/script>/);
  assert.doesNotMatch(uiScript, /\.innerHTML\s*=/);
});
