/**
 * Minimal CORS proxy for AviationWeather.gov Data API.
 *
 * Purpose: allow browser clients (e.g. GitHub Pages) to access
 * https://aviationweather.gov/api/data/* without CORS issues.
 *
 * Security posture (minimal, but not an open proxy):
 * - Only allows GET/HEAD/OPTIONS
 * - Only allows paths under /api/data/
 */

const UPSTREAM_ORIGIN = 'https://aviationweather.gov';

// Tight CORS allowlist.
// Note: CORS origins do NOT include paths, only scheme + host (+ optional port).
const ALLOWED_ORIGINS = new Set([
  'https://hydrospheric0.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(request) {
  const allowedOrigin = getAllowedOrigin(request);
  return {
    'Access-Control-Allow-Origin': allowedOrigin ?? 'null',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') ?? 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  // Avoid caching surprises.
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Reject unknown browser origins early (including preflight).
    const origin = request.headers.get('Origin');
    if (origin && !getAllowedOrigin(request)) {
      return new Response('Forbidden origin', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(request) });
    }

    if (!url.pathname.startsWith('/api/data/')) {
      return new Response('Not found', { status: 404, headers: corsHeaders(request) });
    }

    const upstreamUrl = new URL(UPSTREAM_ORIGIN);
    upstreamUrl.pathname = url.pathname;
    upstreamUrl.search = url.search;

    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: {
        // Keep it minimal; upstream returns JSON/GeoJSON.
        'Accept': request.headers.get('Accept') ?? '*/*',
        'User-Agent': 'cbc-weather-cors-proxy',
      },
      redirect: 'follow',
    });

    const upstreamResponse = await fetch(upstreamRequest);

    // Pass through status/body/content-type, and add CORS.
    return withCors(request, upstreamResponse);
  },
};
