import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../worker/index.mjs';
import {
  DEFAULT_FILTERS,
  SOURCE_DEFINITIONS,
  buildNivodaQuery,
  buildLgdPayload,
  normalizeNivodaItem,
  normalizeLgdItem,
} from '../docs/search-core.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/nivoda-carbonsparkle.json', import.meta.url), 'utf8'));
const nivoda = SOURCE_DEFINITIONS.find(source => source.id === 'carbonsparkle');
const loosegrown = SOURCE_DEFINITIONS.find(source => source.kind === 'loosegrown');
const allowedOrigin = 'https://ikboong.github.io';
const cloneFilters = changes => ({ ...structuredClone(DEFAULT_FILTERS), ...changes });
const lgdFilters = () => cloneFilters({ colors: ['Pink'], shapes: ['HEART'], growthTypes: [] });
const lgdItem = {
  id: '15936744', sku: '816613887', price: '2013', org_price: '2684',
  carat: '5.12', shape: 'heart', clarity: '8', cut: '4', color: '2', certificate_type: '1',
};

function searchRequest(body = {}, origin = allowedOrigin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;
  return new Request('https://search.example/api/search', {
    method: 'POST', headers,
    body: JSON.stringify({ siteId: nivoda.id, filters: cloneFilters(), offset: 0, ...body }),
  });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function forbidFetch(t) {
  return t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected upstream request'); });
}

test('health is read-only and supports tools without an Origin', async t => {
  const upstream = forbidFetch(t);
  const response = await worker.fetch(new Request('https://search.example/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(upstream.mock.callCount(), 0);
});

test('preflight permits only the configured browser origins and JSON headers', async t => {
  const upstream = forbidFetch(t);
  for (const origin of [allowedOrigin, 'http://127.0.0.1:8765']) {
    const response = await worker.fetch(new Request('https://search.example/api/search', {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.equal(await response.text(), '');
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('unapproved and null browser origins are rejected before upstream access', async t => {
  const upstream = forbidFetch(t);
  for (const origin of ['https://evil.example', 'https://ikboong.github.io.evil.example', 'null', 'http://localhost:8765']) {
    const response = await worker.fetch(searchRequest({}, origin));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await response.json()).code, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('unknown routes and unsupported methods cannot become a generic proxy', async t => {
  const upstream = forbidFetch(t);
  for (const [url, method, expected] of [
    ['https://search.example/proxy?url=https://evil.example', 'GET', 404],
    ['https://search.example/api/search', 'GET', 405],
    ['https://search.example/health', 'DELETE', 405],
  ]) {
    const response = await worker.fetch(new Request(url, { method }));
    assert.equal(response.status, expected);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('unknown sources, invalid offsets and invalid filters are rejected', async t => {
  const upstream = forbidFetch(t);
  const invalidBodies = [
    { siteId: 'https://evil.example' }, { siteId: '__proto__' },
    { offset: -1 }, { offset: 1.5 }, { offset: '20' }, { offset: null }, { offset: false }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    { filters: null }, { filters: [] }, { filters: { caratMin: 30, caratMax: 5 } },
    { filters: { shapes: ['<script>'] } }, { filters: { origin: 'https://evil.example' } },
  ];
  for (const body of invalidBodies) {
    const response = await worker.fetch(searchRequest(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('malformed JSON and non-object request bodies fail at the request boundary', async t => {
  const upstream = forbidFetch(t);
  for (const body of ['{', 'null', '[]', '123', '"text"']) {
    const response = await worker.fetch(new Request('https://search.example/api/search', { method: 'POST', body }));
    assert.equal(response.status, 400);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('body limit applies to declared size and actual streamed bytes', async t => {
  const upstream = forbidFetch(t);
  const declared = new Request('https://search.example/api/search', {
    method: 'POST', headers: { 'Content-Length': '16385' }, body: '{}',
  });
  assert.equal((await worker.fetch(declared)).status, 413);
  const actual = new Request('https://search.example/api/search', { method: 'POST', body: ' '.repeat(16385) });
  assert.equal((await worker.fetch(actual)).status, 413);
  assert.equal(upstream.mock.callCount(), 0);
});

test('first Nivoda page sends the exact count/feed contract and normalizes the results', async t => {
  const rawItems = fixture.items.slice(0, 20);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return url.endsWith('/count') ? json({ data: { diamonds_by_query_count: 73 } }) : json(rawItems);
  });
  const response = await worker.fetch(searchRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.siteId, nivoda.id);
  assert.equal(body.name, nivoda.name);
  assert.equal(body.total, 73);
  assert.equal(body.nextOffset, 20);
  assert.equal(body.hasMore, true);
  assert.equal(body.currency, 'USD');
  assert.equal(Number.isNaN(Date.parse(body.observedAt)), false);
  assert.deepEqual(body.items, rawItems.map(item => normalizeNivodaItem(item, nivoda)));
  assert.equal(calls.length, 2);
  const query = buildNivodaQuery(cloneFilters(), nivoda);
  assert.equal(calls[0].url, nivoda.origin + '/apps/diamond-proxy/api/count');
  assert.deepEqual(calls[0].body, { callFrom: 'feed', query });
  assert.equal(calls[1].url, nivoda.origin + '/apps/diamond-proxy/api/v2/feed');
  assert.deepEqual(calls[1].body, {
    showTarrifFreeFeeds: false, callFrom: 'feed', query, offset: 0,
    order: { type: 'price', direction: 'ASC' },
  });
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.redirect, 'manual');
  assert.equal(calls[1].options.headers.Origin, nivoda.origin);
});

test('subsequent Nivoda pages skip count and preserve native offset pagination', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, nivoda.origin + '/apps/diamond-proxy/api/v2/feed');
    assert.equal(JSON.parse(options.body).offset, 20);
    return json(fixture.items.slice(20, 40));
  });
  const response = await worker.fetch(searchRequest({ offset: 20 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, null);
  assert.equal(body.nextOffset, 40);
  assert.equal(body.hasMore, true);
  assert.equal(calls, 1);
});

test('short and empty subsequent pages stop pagination', async t => {
  let items = fixture.items.slice(0, 3);
  t.mock.method(globalThis, 'fetch', async () => json(items));
  let response = await worker.fetch(searchRequest({ offset: 20 }));
  let body = await response.json();
  assert.equal(body.hasMore, false);
  assert.equal(body.nextOffset, 23);
  items = [];
  response = await worker.fetch(searchRequest({ offset: 40 }));
  body = await response.json();
  assert.equal(body.hasMore, false);
  assert.equal(body.nextOffset, 40);
});

test('zero Nivoda count returns an empty result without a feed request', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    assert.equal(url, nivoda.origin + '/apps/diamond-proxy/api/count');
    return json({ data: { diamonds_by_query_count: 0 } });
  });
  const response = await worker.fetch(searchRequest());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items, []);
  assert.equal(body.total, 0);
  assert.equal(body.hasMore, false);
  assert.equal(calls, 1);
});

test('upstream HTTP, connection and JSON failures are explicit and do not leak raw responses', async t => {
  t.mock.method(console, 'error', () => {});
  let failure = 'http';
  t.mock.method(globalThis, 'fetch', async () => {
    if (failure === 'network') throw new Error('Internal endpoint diagnostic');
    if (failure === 'json') return new Response('<html>challenge private data</html>');
    return new Response('private upstream response', { status: 429 });
  });
  for (const [kind, code] of [
    ['http', 'UPSTREAM_RATE_LIMIT'], ['network', 'UPSTREAM_UNAVAILABLE'], ['json', 'UPSTREAM_INVALID_JSON'],
  ]) {
    failure = kind;
    const response = await worker.fetch(searchRequest());
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private|Internal endpoint/);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  }
});

test('upstream timeout aborts the request and returns a clear 502', async t => {
  let configuredDelay;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    configuredDelay = delay;
    queueMicrotask(callback);
    return 0;
  });
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const response = await worker.fetch(searchRequest());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'UPSTREAM_TIMEOUT');
  assert.equal(configuredDelay, 20_000);
});

test('malformed counts, feed shapes and item prices fail instead of producing incomplete success', async t => {
  let responseBody;
  t.mock.method(globalThis, 'fetch', async () => json(responseBody));
  for (const count of [-1, '12', null, 1.5]) {
    responseBody = { data: { diamonds_by_query_count: count } };
    const response = await worker.fetch(searchRequest());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'UPSTREAM_INVALID_DATA');
  }
  for (const feed of [{ data: fixture.items }, Array(21).fill(fixture.items[0]), [{ ...fixture.items[0], price: 'invalid' }]]) {
    responseBody = feed;
    const response = await worker.fetch(searchRequest({ offset: 20 }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'UPSTREAM_INVALID_DATA');
  }
});

test('Loose Grown Diamond accepts an ordinary HTML page without a challenge cookie', async t => {
  const filters = lgdFilters();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return new Response('<html><title>Diamonds</title><script>document.cookie="theme=dark"</script></html>');
    return json({ total: 1, data: [lgdItem] });
  });
  const response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.total, 1);
  assert.equal(body.nextOffset, 1);
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.items, [normalizeLgdItem(lgdItem, loosegrown)]);
  assert.equal(calls[0].url, loosegrown.pageUrl);
  assert.equal(calls[1].url, loosegrown.origin + loosegrown.inventoryPathFancy);
  assert.deepEqual(JSON.parse(calls[1].options.body), buildLgdPayload(filters, 1));
  assert.equal(calls[1].options.headers.Cookie, undefined);
});

test('Loose Grown Diamond never evaluates an unrecognized challenge', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('<html><title>Sucuri redirect</title><script>document.cookie=fetch("https://evil.example")</script></html>');
  });
  const response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters: lgdFilters() }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'UPSTREAM_CHALLENGE');
  assert.equal(calls, 1);
});

test('Loose Grown Diamond forwards a parsed literal cookie from 200 and 307 challenge pages', async t => {
  const script = 'x=\'safe\'+String.fromCharCode(95)+\'token\';document.cookie=\'sucuri_cloudproxy_uuid_test\'+"="+x+";path=/";';
  const challenge = '<html><title>You are being redirected...</title><script>S=\'' + btoa(script) + '\';</script></html>';
  const calls = [];
  let challengeStatus;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return options.method === 'GET'
      ? new Response(challenge, { status: challengeStatus, headers: { 'Content-Type': 'text/html' } })
      : json({ total: 1, data: [lgdItem] });
  });
  for (const status of [200, 307]) {
    challengeStatus = status;
    calls.length = 0;
    const response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters: lgdFilters() }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers.Cookie, 'sucuri_cloudproxy_uuid_test=safe_token');
  }
});

test('ordinary 307 responses and API redirects are rejected without being followed', async t => {
  const script = 'x=\'safe\';document.cookie=\'sucuri_cloudproxy_uuid_test\'+"="+x+";path=/";';
  const assignment = '<script>S=\'' + btoa(script) + '\';</script>';
  const challenge = '<title>You are being redirected...</title>' + assignment;
  let responseBody;
  let responseHeaders;
  let stage;
  let calls;
  const logs = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    if (stage === 'lgd-api' && options.method === 'GET') return new Response('<html>Storefront</html>');
    return new Response(responseBody, { status: 307, headers: responseHeaders });
  });
  for (const example of [
    { stage: 'html', body: '<html>Unrelated redirect</html>', headers: {} },
    { stage: 'html', body: assignment, headers: {} },
    { stage: 'html', body: challenge, headers: { Location: 'https://evil.example/redirect' } },
    { stage: 'nivoda-api', body: challenge, headers: {} },
    { stage: 'lgd-api', body: challenge, headers: {} },
  ]) {
    stage = example.stage;
    responseBody = example.body;
    responseHeaders = example.headers;
    calls = 0;
    const response = await worker.fetch(searchRequest(stage === 'nivoda-api'
      ? {} : { siteId: loosegrown.id, filters: lgdFilters() }));
    assert.equal(response.status, 502, stage);
    assert.equal((await response.json()).code, 'UPSTREAM_HTTP_ERROR');
    assert.equal(calls, stage === 'lgd-api' ? 2 : 1);
  }
  assert.equal(logs.mock.callCount(), 5);
  assert.equal(logs.mock.calls.some(call => call.arguments.some(value => String(value).includes('Unrelated redirect'))), false);
});

test('upstream 429 preserves valid Retry-After values and never retries', async t => {
  const cases = ['60', '2.0', 'Fri, 16 Oct 2026 12:00:00 GMT', null, 'invalid', '-1', '9'.repeat(310)];
  let retryAfter;
  let calls;
  const logs = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    const headers = { Server: 'upstream.example', 'Content-Type': 'text/html' };
    if (retryAfter !== null) headers['Retry-After'] = retryAfter;
    return new Response('<html>PRIVATE UPSTREAM DIAGNOSTIC</html>', { status: 429, headers });
  });
  for (const value of cases) {
    retryAfter = value;
    calls = 0;
    const before = Date.now();
    const response = await worker.fetch(searchRequest());
    const after = Date.now();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, 'UPSTREAM_RATE_LIMIT');
    assert.match(body.message, /제한/);
    assert.equal(calls, 1);
    if (value === '60' || value === '2.0') {
      const timestamp = Date.parse(body.retryAfter);
      assert.ok(timestamp >= before + Number(value) * 1000);
      assert.ok(timestamp <= after + Number(value) * 1000);
      assert.equal(response.headers.get('Retry-After'), value);
      assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
    } else if (value?.startsWith('Fri,')) {
      assert.equal(body.retryAfter, '2026-10-16T12:00:00.000Z');
      assert.equal(response.headers.get('Retry-After'), value);
    } else {
      assert.equal(Object.hasOwn(body, 'retryAfter'), false);
      assert.equal(response.headers.get('Retry-After'), null);
    }
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE UPSTREAM DIAGNOSTIC/);
  }
  assert.equal(logs.mock.calls.some(call => call.arguments.some(value => String(value).includes('PRIVATE UPSTREAM DIAGNOSTIC'))), false);
});

test('Loose Grown Diamond selects its fixed white inventory endpoint', async t => {
  const filters = lgdFilters();
  filters.fancy = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'GET') return new Response('<html>Storefront</html>');
    assert.equal(url, loosegrown.origin + loosegrown.inventoryPathWhite);
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload, buildLgdPayload(filters, 1));
    assert.equal(Object.hasOwn(payload, 'colored'), false);
    return json({ total: 0, data: [] });
  });
  const response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, []);
});

test('unsupported Loose Grown Diamond filter mappings return 422 before network access', async t => {
  const upstream = forbidFetch(t);
  for (const filters of [cloneFilters(), { ...lgdFilters(), shapes: ['KITE'] }]) {
    const response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters }));
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, 'UNSUPPORTED_FILTERS');
    assert.equal(typeof body.message, 'string');
    assert.ok(body.unsupported.length > 0);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('Loose Grown Diamond preserves page size 50 and rejects invalid inventory data', async t => {
  let inventory = { total: 120, data: Array.from({ length: 50 }, (_, index) => ({ ...lgdItem, id: String(index) })) };
  let requestedPage;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.method === 'GET') return new Response('<html>Storefront</html>');
    requestedPage = JSON.parse(options.body).ls_start;
    return json(inventory);
  });
  let response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters: lgdFilters(), offset: 50 }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(requestedPage, 2);
  assert.equal(body.nextOffset, 100);
  assert.equal(body.hasMore, true);
  for (const invalid of [{ total: -1, data: [] }, { total: 1, data: {} }, { total: 1, data: [] }, { total: 1, data: [{ ...lgdItem, price: 'invalid' }] }]) {
    inventory = invalid;
    response = await worker.fetch(searchRequest({ siteId: loosegrown.id, filters: lgdFilters() }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'UPSTREAM_INVALID_DATA');
  }
});
