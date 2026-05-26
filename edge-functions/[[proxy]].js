import { getStore } from '@edgeone/pages-blob';

// Global runtime settings for upstream proxying, caching and risk control.
const CFG = {
  baseURL: 'https://api.dandanplay.net',
  cacheName: 'cache',
  cacheTTL: 300,
  blobName: 'blob',
  blobMax: 256,
  blobTTL: 86400,
  env: {
    appId: 'APP_ID',
    appSecret: 'APP_SECRET'
  },
  key: {
    blobIndex: 'blob-index.json',
    riskPrefix: 'risk/',
    commentPrefix: 'comment/'
  },
  risk: {
    windowSec: 60,
    maxHits: 60,
    banSec: 600,
    maxBodyBytes: 65536,
    maxQueryBytes: 4096
  }
};

// Blob store used as the second-level cache for large comment payloads.
const blob = getStore(CFG.blobName);

// Comment responses get an extra Blob-backed cache layer.
const COMMENT = /^\/api\/v2\/comment\/[^/]+$/;

// Only these upstream routes are allowed to be proxied.
const ALLOW = [
  { method: 'POST', re: /^\/api\/v2\/match$/ },
  { method: 'GET', re: /^\/api\/v2\/search\/episodes$/ },
  { method: 'GET', re: /^\/api\/v2\/bangumi\/[^/]+$/ },
  { method: 'GET', re: COMMENT }
];

/**
 * Handle all matched edge requests.
 * The flow is: validate route, run risk checks, try L1 cache, try L2 Blob cache,
 * fetch upstream, then write back caches.
 */
export default async function onRequest(ctx) {
  try {
    const req = ctx.request;
    const url = new URL(req.url);
    const path = url.pathname.toLowerCase();
    if (!isAllowed(req.method, path)) {
      return fail(403, 'route_not_allowed');
    }

    const body = req.method === 'POST' ? await req.text() : '';
    const bad = isMalicious(url, body);
    const risk = await checkRisk(req, path, body, url.search, bad);
    if (risk.blocked) {
      return fail(risk.status, risk.code, { retryAfter: risk.retryAfter || 0 });
    }

    const cache = await caches.open(CFG.cacheName);
    const cacheKey = await makeCacheKey(req.method, path, url.search, body);
    const cacheReq = new Request(cacheKey, { method: 'GET' });
    const commentKey = COMMENT.test(path) ? await getCommentKey(path, url.search) : '';

    const l1 = await readCache(cache, cacheReq);
    if (l1) {
      return withCacheTag(l1, 'hit', 'l1');
    }

    if (commentKey) {
      const l2 = await readBlobCache(commentKey);
      if (l2) {
        ctx.waitUntil(writeCache(cache, cacheReq, l2.clone()));
        return withCacheTag(l2, 'hit', 'l2');
      }
    }

    const upstream = await proxy(req, path, url.search, body, ctx.env || {});
    const text = await upstream.text();

    if (!isJSON(text)) {
      return fail(502, 'invalid_upstream_json');
    }

    const res = createJSONResponse(text, upstream.status);
    if (!upstream.ok) {
      return withCacheTag(res, 'bypass', 'origin');
    }

    ctx.waitUntil(writeCache(cache, cacheReq, res.clone()));

    if (commentKey) {
      ctx.waitUntil(writeBlobCache(commentKey, text));
    }

    return withCacheTag(res, 'miss', 'origin');
  } catch (err) {
    return fail(500, 'internal_error', { message: err.message || 'unknown_error' });
  }
}

/**
 * Check whether the current request matches the allowlist.
 */
function isAllowed(method, path) {
  return ALLOW.some((item) => item.method === method && item.re.test(path));
}

/**
 * Forward the request to the upstream API with the required signed headers.
 */
async function proxy(req, path, search, body, env) {
  const appId = requireEnv(env, CFG.env.appId);
  const appSecret = requireEnv(env, CFG.env.appSecret);
  const ts = String(now());
  const sig = await sign(appId, ts, path, appSecret);
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('X-AppId', appId);
  headers.set('X-Timestamp', ts);
  headers.set('X-Signature', sig);

  const type = req.headers.get('content-type');
  if (type) {
    headers.set('Content-Type', type);
  }

  return fetch(`${CFG.baseURL}${path}${search}`, {
    method: req.method,
    headers,
    body: req.method === 'POST' ? body : undefined
  });
}

/**
 * Build the upstream signature required by the target service.
 */
async function sign(appId, ts, path, appSecret) {
  const data = `${appId}${ts}${path}${appSecret}`;
  const hash = await crypto.subtle.digest('SHA-256', encode(data));
  return toBase64(hash);
}

/**
 * Generate a stable cache key from method, path, query and POST body hash.
 */
async function makeCacheKey(method, path, search, body) {
  const qs = new URLSearchParams(search);
  qs.set('_m', method);
  if (method === 'POST') {
    qs.set('_bh', await shaHex(body));
  }
  const query = qs.toString();
  return `https://danmaku.edgeone.app${path}${query ? `?${query}` : ''}`;
}

/**
 * Read the first-level Cache API entry.
 */
async function readCache(cache, req) {
  try {
    return await cache.match(req);
  } catch {
    return undefined;
  }
}

/**
 * Write the response into the first-level cache.
 */
async function writeCache(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', `s-maxage=${CFG.cacheTTL}`);
  const cached = new Response(await res.text(), {
    status: res.status,
    headers
  });
  await cache.put(req, cached);
}

/**
 * Read the second-level Blob cache for comment payloads.
 */
async function readBlobCache(commentKey) {
  const nowTS = now();
  let list = await readMetaJSON(CFG.key.blobIndex, []);
  const hit = list.find((item) => item.k === commentKey);

  if (!hit) {
    return null;
  }

  if (hit.e <= nowTS) {
    list = list.filter((item) => item.k !== commentKey);
    await Promise.all([blob.delete(blobKey(commentKey)), writeMetaJSON(CFG.key.blobIndex, list)]);
    return null;
  }

  const text = await blob.get(blobKey(commentKey));
  if (!text) {
    list = list.filter((item) => item.k !== commentKey);
    await writeMetaJSON(CFG.key.blobIndex, list);
    return null;
  }

  hit.a = nowTS;
  await writeMetaJSON(CFG.key.blobIndex, list);
  return createJSONResponse(text, 200, CFG.cacheTTL);
}

/**
 * Persist the comment payload in Blob and maintain its Blob-based LRU metadata.
 */
async function writeBlobCache(commentKey, text) {
  const nowTS = now();
  let list = await readMetaJSON(CFG.key.blobIndex, []);

  await blob.set(blobKey(commentKey), text);

  list = list.filter((item) => item.k !== commentKey && item.e > nowTS);
  list.push({ k: commentKey, a: nowTS, e: nowTS + CFG.blobTTL });
  list.sort((a, b) => a.a - b.a);
  const drop = list.splice(0, Math.max(0, list.length - CFG.blobMax));

  await Promise.all(drop.map((item) => blob.delete(blobKey(item.k))));
  await writeMetaJSON(CFG.key.blobIndex, list);
}

/**
 * Read a metadata JSON file from Blob with strong consistency.
 */
async function readMetaJSON(key, fallback) {
  const value = await blob.get(key, { type: 'json', consistency: 'strong' });
  return value || fallback;
}

/**
 * Write a metadata JSON file into Blob.
 */
async function writeMetaJSON(key, value) {
  await blob.setJSON(key, value);
}

/**
 * Apply request size checks and per-fingerprint rate limiting.
 */
async function checkRisk(req, path, body, search, bad) {
  if (body.length > CFG.risk.maxBodyBytes || search.length > CFG.risk.maxQueryBytes) {
    return { blocked: true, status: 400, code: 'request_too_large', retryAfter: 0 };
  }

  const key = riskKey(await shaHex(finger(req, path)));
  const nowTS = now();
  const state = await readMetaJSON(key, { h: [], b: 0 });

  if (state.b > nowTS) {
    return {
      blocked: true,
      status: 429,
      code: 'rate_limited',
      retryAfter: state.b - nowTS
    };
  }

  const hits = Array.isArray(state.h) ? state.h.filter((item) => nowTS - item < CFG.risk.windowSec) : [];

  if (bad) {
    await writeMetaJSON(key, { h: [], b: nowTS + CFG.risk.banSec });
    return {
      blocked: true,
      status: 403,
      code: 'malicious_request',
      retryAfter: CFG.risk.banSec
    };
  }

  hits.push(nowTS);

  if (hits.length > CFG.risk.maxHits) {
    await writeMetaJSON(key, { h: [], b: nowTS + CFG.risk.banSec });
    return {
      blocked: true,
      status: 429,
      code: 'rate_limited',
      retryAfter: CFG.risk.banSec
    };
  }

  await writeMetaJSON(key, { h: hits, b: 0 });
  return { blocked: false };
}

/**
 * Build a lightweight client fingerprint for Blob-based rate limiting.
 */
function finger(req, path) {
  const ip = pickIp(req);
  const ua = req.headers.get('user-agent') || '';
  const lang = req.headers.get('accept-language') || '';
  return `${ip}|${ua}|${lang}|${path}`;
}

/**
 * Pick the client IP from the official EdgeOne request field, then fall back to proxy headers.
 */
function pickIp(req) {
  const raw =
    req.eo?.clientIp ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('eo-client-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown';
  return raw.split(',')[0].trim();
}

/**
 * Detect obviously malicious payload patterns before proxying upstream.
 */
function isMalicious(requestURL, body) {
  const sample = `${requestURL.pathname}${requestURL.search}\n${body}`.toLowerCase();
  return /(\.\.\/|%2e%2e|<script|union\s+select|sleep\(|benchmark\()/.test(sample);
}

/**
 * Validate that the upstream response body is JSON text.
 */
function isJSON(text) {
  if (!text) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a JSON response with cache headers.
 */
function createJSONResponse(text, status, ttl) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8'
  });
  if (ttl) {
    headers.set('Cache-Control', `s-maxage=${ttl}`);
  } else {
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(text, { status, headers });
}

/**
 * Add cache hit information to the outgoing response.
 */
function withCacheTag(res, state, tier) {
  const headers = new Headers(res.headers);
  headers.set('X-Proxy-Cache', state);
  headers.set('X-Proxy-Cache-Tier', tier);
  return new Response(res.body, {
    status: res.status,
    headers
  });
}

/**
 * Create a consistent JSON error response.
 */
function fail(status, code, extra) {
  return new Response(JSON.stringify({ error: code, ...(extra || {}) }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/**
 * Build the Blob object key for a cached comment payload.
 */
function blobKey(commentKey) {
  return `${CFG.key.commentPrefix}${commentKey}.json`;
}

/**
 * Build the Blob key for a per-fingerprint risk state file.
 */
function riskKey(fingerprint) {
  return `${CFG.key.riskPrefix}${fingerprint}.json`;
}

/**
 * Extract the episode id from /api/v2/comment/{id}.
 */
function getCommentId(path) {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Build a stable comment cache key from the episode id and query string.
 */
async function getCommentKey(path, search) {
  const commentId = getCommentId(path);
  if (!search) {
    return commentId;
  }
  return `${commentId}-${await shaHex(search)}`;
}

/**
 * Read a required environment variable.
 */
function requireEnv(env, key) {
  const val = env[key];
  if (!val) {
    throw new Error(`Missing env: ${key}`);
  }
  return val;
}

/**
 * Hash text into a SHA-256 hex string.
 */
async function shaHex(text) {
  const hash = await crypto.subtle.digest('SHA-256', encode(text));
  return toHex(hash);
}

/**
 * Convert a binary hash into a hex string.
 */
function toHex(buf) {
  return Array.from(new Uint8Array(buf), (item) => item.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert a binary hash into a base64 string.
 */
function toBase64(buf) {
  let out = '';
  const arr = new Uint8Array(buf);
  for (const item of arr) {
    out += String.fromCharCode(item);
  }
  return btoa(out);
}

/**
 * Encode text into UTF-8 bytes.
 */
function encode(text) {
  return new TextEncoder().encode(text);
}

/**
 * Return the current Unix timestamp in seconds.
 */
function now() {
  return Math.floor(Date.now() / 1000);
}
