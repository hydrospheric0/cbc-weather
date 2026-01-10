const UPSTREAM_ORIGIN = 'https://aviationweather.gov';

function isAllowedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && u.hostname.endsWith('.github.io')) return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return isAllowedOrigin(origin) ? origin : null;
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

    const origin = request.headers.get('Origin');
    if (origin && !getAllowedOrigin(request)) {
      return new Response('Forbidden origin', { status: 403, headers: corsHeaders(request) });
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
        'Accept': request.headers.get('Accept') ?? '*/*',
        'User-Agent': 'cbc-weather-cors-proxy',
      },
      redirect: 'follow',
    });

    const upstreamResponse = await fetch(upstreamRequest);
    return withCors(request, upstreamResponse);
  },
};
