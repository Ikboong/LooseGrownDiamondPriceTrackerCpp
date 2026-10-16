import {
  SOURCE_DEFINITIONS,
  validateFilters,
  buildNivodaQuery,
  buildLgdPayload,
  normalizeNivodaItem,
  normalizeLgdItem,
  parseLgdCookie,
} from '../docs/search-core.mjs';

const ALLOWED_ORIGINS = new Set([
  'https://ikboong.github.io',
  'http://127.0.0.1:8765',
]);
const MAX_BODY_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;

class HttpError extends Error {
  constructor(status, code, message, retryAfterHeader = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = normalizeRetryAfter(retryAfterHeader);
    this.retryAfterHeader = this.retryAfter ? retryAfterHeader : null;
  }
}

function normalizeRetryAfter(value) {
  if (!value) return null;
  const text = value.trim();
  let timestamp;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    timestamp = Date.now() + Number(text) * 1000;
  } else if (/^(?:[A-Za-z]{3},\s|\d{4}-\d{2}-\d{2}T)/.test(text)) {
    timestamp = Date.parse(text);
  } else {
    return null;
  }
  return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15
    ? new Date(timestamp).toISOString()
    : null;
}

function responseHeaders(origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

async function readRequestBody(request) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', '요청 본문은 16KB 이하여야 합니다.');
  }
  if (!request.body) throw new HttpError(400, 'INVALID_JSON', 'JSON 요청 본문이 필요합니다.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', '요청 본문은 16KB 이하여야 합니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '올바른 JSON 요청 본문이 필요합니다.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_REQUEST', '요청 본문은 JSON 객체여야 합니다.');
  }
  return body;
}

async function upstreamRequest(url, options, parseAs = 'json') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (parseAs === 'text' && options.method === 'GET' && response.status === 307 && !response.headers.has('Location')) {
      const html = await response.text();
      // LGD's Sucuri handshake sometimes uses 307 for a JavaScript cookie page,
      // without an HTTP redirect target. Only the known encoded form is passed
      // to the literal-only cookie parser; no redirect or script is executed.
      if (/(?:sucuri|you are being redirected)/i.test(html) && /\bS\s*=\s*'[A-Za-z0-9+/]{24,}={0,2}'/.test(html)) {
        return html;
      }
    }
    if (!response.ok) {
      console.error('Upstream HTTP failure:', new URL(url).hostname, response.status,
        response.headers.get('server'), response.headers.get('retry-after'));
      if (response.status === 429) {
        throw new HttpError(502, 'UPSTREAM_RATE_LIMIT',
          '판매처가 요청을 일시적으로 제한했습니다. 잠시 후 다시 시도해 주세요.',
          response.headers.get('Retry-After'));
      }
      throw new HttpError(502, 'UPSTREAM_HTTP_ERROR', `판매처가 HTTP ${response.status} 오류를 반환했습니다.`);
    }
    if (parseAs === 'text') return await response.text();
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new HttpError(502, 'UPSTREAM_INVALID_JSON', '판매처가 올바른 JSON을 반환하지 않았습니다.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (controller.signal.aborted) {
      throw new HttpError(502, 'UPSTREAM_TIMEOUT', '판매처 응답이 20초를 초과했습니다.');
    }
    console.error('Upstream request failed:', new URL(url).hostname, error instanceof Error ? error.message : String(error));
    throw new HttpError(502, 'UPSTREAM_UNAVAILABLE', '판매처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamHeaders(source, cookie = '') {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; DiamondPriceSearch/1.0)',
    Origin: source.origin,
    Referer: source.pageUrl,
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function postUpstream(source, path, body, cookie) {
  // Hosts and paths come only from the checked-in source definitions.
  const url = new URL(path, source.origin);
  if (url.origin !== source.origin || url.protocol !== 'https:') {
    throw new Error('Invalid configured inventory endpoint');
  }
  return upstreamRequest(url.href, {
    method: 'POST',
    headers: upstreamHeaders(source, cookie),
    body: JSON.stringify(body),
  });
}

function requireCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(502, 'UPSTREAM_INVALID_DATA', '판매처의 검색 건수 형식이 올바르지 않습니다.');
  }
  return value;
}

function normalizePage(rawItems, source, normalize) {
  try {
    const items = rawItems.map(item => normalize(item, source));
    if (items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('Invalid normalized inventory item');
    }
    return items;
  } catch {
    throw new HttpError(502, 'UPSTREAM_INVALID_DATA', '판매처의 상품 데이터 형식이 올바르지 않습니다.');
  }
}

async function searchNivoda(source, filters, offset) {
  const query = buildNivodaQuery(filters, source);
  let total = null;
  if (offset === 0) {
    const countResponse = await postUpstream(source, '/apps/diamond-proxy/api/count', {
      callFrom: 'feed', query,
    });
    total = requireCount(countResponse?.data?.diamonds_by_query_count);
    if (total === 0) return { items: [], total, nextOffset: offset, hasMore: false };
  }
  const rawItems = await postUpstream(source, '/apps/diamond-proxy/api/v2/feed', {
    showTarrifFreeFeeds: false,
    callFrom: 'feed',
    query,
    offset,
    order: { type: 'price', direction: 'ASC' },
  });
  if (!Array.isArray(rawItems) || rawItems.length > 20 || (offset === 0 && rawItems.length === 0)) {
    throw new HttpError(502, 'UPSTREAM_INVALID_DATA', '판매처의 상품 목록이 올바르지 않습니다.');
  }
  return {
    items: normalizePage(rawItems, source, normalizeNivodaItem),
    total,
    nextOffset: offset + rawItems.length,
    hasMore: rawItems.length === 20 && (total === null || offset + rawItems.length < total),
  };
}

async function searchLoosegrown(source, filters, offset) {
  const path = filters.fancy ? source.inventoryPathFancy : source.inventoryPathWhite;
  if (!path) {
    throw new HttpError(400, 'UNSUPPORTED_FILTER', '이 판매처에서 해당 다이아 종류를 검색할 수 없습니다.');
  }
  const page = Math.floor(offset / 50) + 1;
  // Reject unsupported mappings before issuing any network request.
  const payload = buildLgdPayload(filters, page);
  const pageHtml = await upstreamRequest(source.pageUrl, {
    method: 'GET',
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; DiamondPriceSearch/1.0)' },
  }, 'text');
  let cookie;
  try {
    cookie = parseLgdCookie(pageHtml);
  } catch {
    throw new HttpError(502, 'UPSTREAM_CHALLENGE', '판매처의 접근 확인 응답을 처리할 수 없습니다.');
  }
  if (!cookie && /(?:sucuri_cloudproxy|<title>[^<]*(?:sucuri|you are being redirected)|\bS\s*=\s*['"][A-Za-z0-9+/=]{24,}['"])/i.test(pageHtml)) {
    throw new HttpError(502, 'UPSTREAM_CHALLENGE', '판매처의 접근 확인 응답을 처리할 수 없습니다.');
  }
  const inventory = await postUpstream(source, path, payload, cookie);
  const total = requireCount(inventory?.total);
  const rawItems = inventory?.data;
  if (!Array.isArray(rawItems) || rawItems.length > 50 || (offset === 0 && total > 0 && rawItems.length === 0)) {
    throw new HttpError(502, 'UPSTREAM_INVALID_DATA', '판매처의 상품 목록이 올바르지 않습니다.');
  }
  return {
    items: normalizePage(rawItems, source, normalizeLgdItem),
    total,
    nextOffset: offset + rawItems.length,
    hasMore: rawItems.length === 50 && offset + rawItems.length < total,
  };
}

async function handleRequest(request) {
  const origin = request.headers.get('Origin');
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: '허용되지 않은 요청 출처입니다.', code: 'ORIGIN_NOT_ALLOWED' }, 403, origin);
  }
  try {
    const { pathname } = new URL(request.url);
    if (pathname !== '/health' && pathname !== '/api/search') {
      throw new HttpError(404, 'NOT_FOUND', '존재하지 않는 경로입니다.');
    }
    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Max-Age', '86400');
      headers.delete('Content-Type');
      return new Response(null, { status: 204, headers });
    }
    if (pathname === '/health') {
      if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'GET 요청을 사용해 주세요.');
      return jsonResponse({ status: 'ready' }, 200, origin);
    }
    if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'POST 요청을 사용해 주세요.');
    const body = await readRequestBody(request);
    const source = SOURCE_DEFINITIONS.find(candidate => candidate.id === body.siteId);
    if (!source) throw new HttpError(400, 'UNKNOWN_SOURCE', '지원하지 않는 판매처입니다.');
    const offset = Object.hasOwn(body, 'offset') ? body.offset : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new HttpError(400, 'INVALID_OFFSET', 'offset은 0 이상의 정수여야 합니다.');
    }
    const { filters, errors } = validateFilters(body.filters);
    if (errors.length) throw new HttpError(400, 'INVALID_FILTERS', errors.join(' '));
    const result = source.kind === 'nivoda'
      ? await searchNivoda(source, filters, offset)
      : source.kind === 'loosegrown'
        ? await searchLoosegrown(source, filters, offset)
        : (() => { throw new Error('Unsupported configured source kind'); })();
    return jsonResponse({
      siteId: source.id,
      name: source.name,
      ...result,
      observedAt: new Date().toISOString(),
      currency: 'USD',
    }, 200, origin);
  } catch (error) {
    if (error?.name === 'UnsupportedSearchError') {
      return jsonResponse({
        error: error.message,
        code: 'UNSUPPORTED_FILTERS',
        message: error.message,
        unsupported: Array.isArray(error.unsupported) ? error.unsupported : [],
      }, 422, origin);
    }
    if (error instanceof HttpError) {
      const response = jsonResponse({
        error: error.message,
        code: error.code,
        message: error.message,
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      }, error.status, origin);
      if (error.retryAfterHeader) {
        response.headers.set('Retry-After', error.retryAfterHeader);
        response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
      }
      return response;
    }
    console.error('Diamond search failed:', error instanceof Error ? error.message : 'Unknown failure');
    return jsonResponse({ error: '검색 처리 중 오류가 발생했습니다.', code: 'INTERNAL_ERROR' }, 500, origin);
  }
}

export default { fetch: handleRequest };
