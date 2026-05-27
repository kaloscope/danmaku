// Global runtime settings for upstream proxying, caching and risk control.
const CFG = {
  baseURL: 'https://api.dandanplay.net',
  env: {
    appId: 'APP_ID',
    appSecret: 'APP_SECRET'
  },
  cacheTTL: 3600,
  bucket: 'STORAGE',
  prefix: {
    comment: 'comment/',
    risk: 'risk/'
  },
  risk: {
    windowSec: 60,
    maxHits: 60,
    banSec: 600,
    maxBodyBytes: 65536,
    maxQueryBytes: 4096
  }
};

// Comment responses get an extra R2-backed cache layer.
const COMMENT = /^\/api\/v2\/comment\/[^/]+$/;

// Only these upstream routes are allowed to be proxied.
const ALLOW = [
  { method: 'POST', re: /^\/api\/v2\/match$/ },
  { method: 'GET', re: /^\/api\/v2\/search\/episodes$/ },
  { method: 'GET', re: /^\/api\/v2\/bangumi\/[^/]+$/ },
  { method: 'GET', re: COMMENT }
];

export default {
  /**
   * Handle all matched worker requests.
   * The flow is: validate route, run risk checks, try L1 cache, try L2 R2 cache,
   * fetch upstream, then write back caches.
   */
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (!isAllowed(request.method, path.toLowerCase())) {
        return fail(403, 'route_not_allowed');
      }

      const body = request.method === 'POST' ? await request.text() : '';
      const bad = isMalicious(url, body);
      const risk = await checkRisk(env, request, path, body, url.search, bad);
      if (risk.blocked) {
        return fail(risk.status, risk.code, { retryAfter: risk.retryAfter || 0 });
      }

      const cache = caches.default;
      const cacheKey = await makeCacheKey(request.method, url.origin, path, url.search, body);
      const cacheReq = new Request(cacheKey, { method: 'GET' });
      const commentKey = COMMENT.test(path.toLowerCase()) ? await getCommentKey(path, url.search) : '';

      const l1 = await readCache(cache, cacheReq);
      if (l1) {
        return withCacheTag(l1, 'hit', 'l1');
      }

      if (commentKey) {
        const l2 = await readR2CommentCache(env, commentKey);
        if (l2) {
          ctx.waitUntil(writeCache(cache, cacheReq, l2.clone()));
          return withCacheTag(l2, 'hit', 'l2');
        }
      }

      const upstream = await proxy(request, path, url.search, body, env);
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
        ctx.waitUntil(writeR2Text(env, commentKey, text));
      }

      return withCacheTag(res, 'miss', 'origin');
    } catch (err) {
      return fail(500, 'internal_error', { message: err.message || 'unknown_error' });
    }
  }
};

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
async function makeCacheKey(method, origin, path, search, body) {
  const qs = new URLSearchParams(search);
  qs.set('_m', method);
  if (method === 'POST') {
    qs.set('_bh', await shaHex(body));
  }
  const query = qs.toString();
  return `${origin}${path}${query ? `?${query}` : ''}`;
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
 * Read the second-level R2 cache for comment payloads.
 */
async function readR2CommentCache(env, commentKey) {
  const text = await readR2Text(env, commentKey);
  if (!text) {
    return null;
  }
  return createJSONResponse(text, 200, CFG.cacheTTL);
}

/**
 * Read a risk state object from R2.
 */
async function readRiskState(env, key) {
  const obj = await getR2Bucket(env).get(key);
  if (!obj) {
    return { h: [], b: 0 };
  }
  try {
    return await obj.json();
  } catch {
    return { h: [], b: 0 };
  }
}

/**
 * Write a risk state object to R2 (expired states are auto-deleted by R2 lifecycle).
 */
function writeRiskState(env, key, state) {
  return getR2Bucket(env).put(key, JSON.stringify(state), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-store'
    }
  });
}

/**
 * Apply request size checks and per-fingerprint rate limiting.
 */
async function checkRisk(env, req, path, body, search, bad) {
  if (body.length > CFG.risk.maxBodyBytes || search.length > CFG.risk.maxQueryBytes) {
    return { blocked: true, status: 400, code: 'request_too_large', retryAfter: 0 };
  }

  // build the R2 key for a per-fingerprint risk state file
  const key = `${CFG.prefix.risk}${await shaHex(finger(req, path))}.json`;
  const nowTS = now();
  const state = await readRiskState(env, key);

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
    await writeRiskState(env, key, { h: [], b: nowTS + CFG.risk.banSec });
    return {
      blocked: true,
      status: 403,
      code: 'malicious_request',
      retryAfter: CFG.risk.banSec
    };
  }

  hits.push(nowTS);

  if (hits.length > CFG.risk.maxHits) {
    await writeRiskState(env, key, { h: [], b: nowTS + CFG.risk.banSec });
    return {
      blocked: true,
      status: 429,
      code: 'rate_limited',
      retryAfter: CFG.risk.banSec
    };
  }

  await writeRiskState(env, key, { h: hits, b: 0 });
  return { blocked: false };
}

/**
 * Build a lightweight client fingerprint for R2-based rate limiting.
 */
function finger(req, path) {
  const ip = pickIp(req);
  const ua = req.headers.get('user-agent') || '';
  const lang = req.headers.get('accept-language') || '';
  return `${ip}|${ua}|${lang}|${path}`;
}

/**
 * Pick the client IP from Cloudflare's request header, then fall back to proxy headers.
 */
function pickIp(req) {
  const raw =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for') ||
    req.headers.get('true-client-ip') ||
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
 * Build a stable comment cache key from the episode id and query string.
 */
async function getCommentKey(path, search) {
  // extract the episode id from /api/v2/comment/{episodeId}
  const episodeId = path.slice(path.lastIndexOf('/') + 1);
  const key = search ? `${episodeId}-${await shaHex(search)}` : episodeId;
  return `${CFG.prefix.comment}${key}.json`;
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
 * Return the configured R2 bucket binding.
 */
function getR2Bucket(env) {
  const bucket = env[CFG.bucket];
  if (!bucket) {
    throw new Error(`Missing binding: ${CFG.bucket}`);
  }
  return bucket;
}

/**
 * Read a text object from R2.
 */
async function readR2Text(env, key) {
  const obj = await getR2Bucket(env).get(key);
  return obj ? obj.text() : null;
}

/**
 * Write a text object to R2.
 */
function writeR2Text(env, key, text) {
  return getR2Bucket(env).put(key, text, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=86400'
    }
  });
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
