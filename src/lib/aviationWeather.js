function baseUrl() {
  const env = (import.meta?.env?.VITE_AWC_BASE_URL || '').trim();
  if (env) return env.replace(/\/$/, '');
  // Prefer local proxy to avoid CORS issues (dev + preview).
  try {
    const host = String(window?.location?.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return '/awc';

    // Default production hosting for this repo is GitHub Pages.
    // If the build-time env var wasn't set, fall back to the deployed Worker.
    if (host === 'hydrospheric0.github.io') {
      return 'https://cbc-weather-awc-proxy.cbc-weather.workers.dev';
    }
  } catch {
    // ignore
  }
  return 'https://aviationweather.gov';
}

function buildUrl(path, params) {
  const u = new URL(baseUrl() + path, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    u.searchParams.set(k, s);
  });
  return u.toString();
}

export async function fetchStationInfoGeoJSON({ bbox, signal }) {
  const url = buildUrl('/api/data/stationinfo', { bbox, format: 'geojson' });
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`Station info failed (${res.status})`);
  return res.json();
}

export async function fetchMetarsJSON({ ids, hours, date, signal }) {
  const url = buildUrl('/api/data/metar', { ids, format: 'json', hours, date });
  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`METAR request failed (${res.status})`);
  return res.json();
}

export function approxUtcOffsetHoursFromLon(lon) {
  const x = Number(lon);
  if (!Number.isFinite(x)) return 0;
  // Rough timezone proxy: 15° longitude per hour.
  return Math.round(x / 15);
}

function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return (n * 9) / 5 + 32;
}

function ktToMph(kt) {
  const n = Number(kt);
  if (!Number.isFinite(n)) return null;
  return n * 1.15078;
}

function clampToDayLocal(obsTimeSec, countDateISO, utcOffsetHours) {
  if (!Number.isFinite(obsTimeSec)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(countDateISO || ''))) return null;

  const [y, m, d] = countDateISO.split('-').map((v) => Number(v));
  const dayStartLocalMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const obsLocalMs = obsTimeSec * 1000 + utcOffsetHours * 3600 * 1000;
  const localDayMs = obsLocalMs - dayStartLocalMs;
  if (localDayMs < 0 || localDayMs >= 24 * 3600 * 1000) return null;
  const hourLocal = Math.floor(localDayMs / (3600 * 1000));
  return { hourLocal };
}

function intensityFromWx(wxString, code) {
  const wx = String(wxString || '').toUpperCase();
  if (!wx) return 'None';
  const has = (s) => wx.includes(s);

  const plus = has('+');
  const minus = has('-');

  if (code === 'rain') {
    if (has('RA') || has('DZ') || has('SHRA') || has('TSRA') || has('FZRA')) {
      if (plus) return 'Heavy';
      if (minus) return 'Light';
      return 'Light';
    }
    return 'None';
  }

  if (code === 'snow') {
    if (has('SN') || has('SG') || has('SHSN')) {
      if (plus) return 'Heavy';
      if (minus) return 'Light';
      return 'Light';
    }
    return 'None';
  }

  return 'Unknown';
}

function cloudCategoryFromMetar(metar) {
  const wx = String(metar?.wxString || '').toUpperCase();
  if (wx.includes('BCFG')) return 'Local Fog';
  if (wx.includes('FG')) return 'Foggy';

  const clouds = Array.isArray(metar?.clouds) ? metar.clouds : [];
  const covers = clouds.map((c) => String(c?.cover || '').toUpperCase()).filter(Boolean);

  // Pick the "worst" cover.
  const rank = (c) => {
    if (c === 'OVC' || c === 'OVX') return 5;
    if (c === 'BKN') return 4;
    if (c === 'SCT') return 3;
    if (c === 'FEW') return 2;
    if (c === 'CLR' || c === 'CAVOK') return 1;
    return 0;
  };

  const maxCover = covers.sort((a, b) => rank(b) - rank(a))[0] || '';
  if (!maxCover) return 'Clear';

  if (maxCover === 'CLR' || maxCover === 'CAVOK') return 'Clear';
  if (maxCover === 'FEW') return 'Partly Clear';
  if (maxCover === 'SCT') return 'Partly Cloudy';
  if (maxCover === 'BKN' || maxCover === 'OVC' || maxCover === 'OVX') return 'Cloudy';

  return 'Unknown';
}

function worstCloud(a, b) {
  const rank = {
    'Clear': 1,
    'Partly Clear': 2,
    'Partly Cloudy': 3,
    'Cloudy': 4,
    'Local Fog': 5,
    'Foggy': 6,
    'Unknown': 0
  };
  const ra = rank[String(a || '')] ?? 0;
  const rb = rank[String(b || '')] ?? 0;
  return ra >= rb ? a : b;
}

export function deriveCountDayPrefillFromMetars({ metars, stationLon, countDateISO }) {
  const list = Array.isArray(metars) ? metars : [];
  if (!list.length) return { patch: null, used: 0 };

  const utcOffsetHours = approxUtcOffsetHoursFromLon(stationLon);

  const tempsF = [];
  const windMph = [];
  const windDirs = [];
  const snowIn = [];

  const am = { cloud: 'Unknown', rain: 'None', snow: 'None' };
  const pm = { cloud: 'Unknown', rain: 'None', snow: 'None' };

  let used = 0;

  for (const m of list) {
    const t = clampToDayLocal(m?.obsTime, countDateISO, utcOffsetHours);
    if (!t) continue;
    used += 1;

    const tf = cToF(m?.temp);
    if (tf !== null) tempsF.push(tf);

    const snow = Number(m?.snow);
    if (Number.isFinite(snow)) snowIn.push(snow);

    const mph = ktToMph(m?.wspd);
    if (mph !== null) windMph.push(mph);

    const wdir = m?.wdir;
    if (typeof wdir === 'string' && wdir.toUpperCase() === 'VRB') {
      windDirs.push('VRB');
    } else if (Number.isFinite(Number(wdir))) {
      windDirs.push(Number(wdir));
    }

    const part = t.hourLocal < 12 ? am : pm;
    part.cloud = worstCloud(part.cloud, cloudCategoryFromMetar(m));

    // Intensities: keep the max.
    const rankI = { 'None': 0, 'Light': 1, 'Heavy': 2, 'Unknown': 0 };
    const rRain = intensityFromWx(m?.wxString, 'rain');
    if ((rankI[rRain] ?? 0) > (rankI[part.rain] ?? 0)) part.rain = rRain;
    const rSnow = intensityFromWx(m?.wxString, 'snow');
    if ((rankI[rSnow] ?? 0) > (rankI[part.snow] ?? 0)) part.snow = rSnow;
  }

  if (!used) return { patch: null, used: 0 };

  const patch = {};

  if (tempsF.length) {
    patch.tempMinF = String(Math.round(Math.min(...tempsF) * 10) / 10);
    patch.tempMaxF = String(Math.round(Math.max(...tempsF) * 10) / 10);
  }

  if (windMph.length) {
    patch.windMinMph = String(Math.round(Math.min(...windMph) * 10) / 10);
    patch.windMaxMph = String(Math.round(Math.max(...windMph) * 10) / 10);
  }

  if (snowIn.length) {
    patch.snowMinIn = String(Math.round(Math.min(...snowIn) * 10) / 10);
    patch.snowMaxIn = String(Math.round(Math.max(...snowIn) * 10) / 10);
  }

  // Wind direction: prefer explicit VRB, else circular mean.
  if (windDirs.includes('VRB')) {
    patch.windDir = 'Variable';
  } else {
    const nums = windDirs.filter((x) => Number.isFinite(x));
    if (nums.length) {
      const rad = nums.map((deg) => (deg * Math.PI) / 180);
      const sin = rad.reduce((a, r) => a + Math.sin(r), 0) / rad.length;
      const cos = rad.reduce((a, r) => a + Math.cos(r), 0) / rad.length;
      const mean = (Math.atan2(sin, cos) * 180) / Math.PI;
      const deg = (mean + 360) % 360;
      patch.windDirDegrees = deg;
    }
  }

  patch.cloudCoverAM = am.cloud;
  patch.cloudCoverPM = pm.cloud;
  patch.amRain = am.rain;
  patch.pmRain = pm.rain;
  patch.amSnow = am.snow;
  patch.pmSnow = pm.snow;

  return { patch, used };
}
