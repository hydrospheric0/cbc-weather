import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MapPane from './components/MapPane.jsx';
import AboutModal from './components/AboutModal.jsx';

import { geocode, fetchForecast } from './lib/openMeteo.js';
import { parseLatLon } from './lib/geo.js';

function loadSaved() {
  try {
    const raw = localStorage.getItem('cbcweather.saved');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.name === 'string' && Number.isFinite(x.lat) && Number.isFinite(x.lon))
      .map((x) => ({ name: x.name, lat: x.lat, lon: x.lon }));
  } catch {
    return [];
  }
}

function saveSaved(list) {
  localStorage.setItem('cbcweather.saved', JSON.stringify(list));
}

function normalizeDateToIso(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yy = Number(m[3]);
    if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yy)) return '';
    if (yy < 100) yy = 2000 + yy;
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${yy}-${pad2(mm)}-${pad2(dd)}`;
  }
  return '';
}

function formatIsoToMdy(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [yy, mm, dd] = s.split('-');
  return `${mm}/${dd}/${yy}`;
}

function weathercodeToText(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return '';
  if (c === 0) return 'clear sky';
  if (c === 1) return 'mainly clear';
  if (c === 2) return 'partly cloudy';
  if (c === 3) return 'broken clouds';
  if (c === 45 || c === 48) return 'fog';
  if (c === 51 || c === 53 || c === 55) return 'drizzle';
  if (c === 56 || c === 57) return 'freezing drizzle';
  if (c === 61) return 'light precip';
  if (c === 63) return 'moderate precip';
  if (c === 65) return 'heavy precip';
  if (c === 66 || c === 67) return 'freezing precip';
  if (c === 71 || c === 73 || c === 75) return 'snow';
  if (c === 77) return 'snow grains';
  if (c === 80 || c === 81 || c === 82) return 'showers';
  if (c === 85 || c === 86) return 'snow showers';
  if (c === 95 || c === 96 || c === 99) return 'thunderstorm';
  return 'weather';
}

export default function App() {
  const [query, setQuery] = useState('');

  const [aboutOpen, setAboutOpen] = useState(false);

  const forecastCacheRef = React.useRef(new Map());
  const geocodeSeqRef = React.useRef(0);

  const [candidates, setCandidates] = useState([]);
  const [saved, setSaved] = useState(() => loadSaved());

  const [selectedLocation, setSelectedLocation] = useState(null);
  const selectionIdRef = React.useRef(0);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [units, setUnits] = useState('us');
  const [forecastDays, setForecastDays] = useState(8);

  const [highlightDateISO, setHighlightDateISO] = useState('');

  const [cbcIndex, setCbcIndex] = useState(null);
  const [cbcIndexLoading, setCbcIndexLoading] = useState(false);

  const STRIP_PERSON_FIELDS = useMemo(() => new Set([
    'FirstName',
    'LastName',
    'EmailAddress',
    'Email',
    'email',
    'Phone',
    'PhoneNumber',
    'contact_email',
    'contact_phone',
    'compiler',
    'Compiler'
  ]), []);

  const cbcIndexRef = React.useRef(null);
  useEffect(() => {
    cbcIndexRef.current = cbcIndex;
  }, [cbcIndex]);

  const loadCbcIndex = useCallback(async () => {
    const existing = cbcIndexRef.current;
    if (Array.isArray(existing) && existing.length) return existing;
    if (cbcIndexLoading) return null;
    setCbcIndexLoading(true);
    try {
      const url = new URL('../data/cbc_circles_merged.geojson', import.meta.url);
      if (import.meta.env.DEV) url.searchParams.set('v', String(Date.now()));
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load CBC circles (${res.status})`);
      const data = await res.json();

      const items = [];
      for (const f of (data?.features || [])) {
        const p0 = f?.properties || {};
        const p = { ...p0 };
        for (const k of STRIP_PERSON_FIELDS) {
          if (k in p) delete p[k];
        }
        const name = String(p?.Name || p?.Abbrev || '').trim();
        const abbrev = p?.Abbrev ? String(p.Abbrev).trim() : '';
        const lat = Number(p?.Latitude);
        const lon = Number(p?.Longitude);
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const miles = Number.isFinite(Number(p?.BUFF_DIST)) ? Number(p.BUFF_DIST) : 7.5;
        const dateLabel = (p?.date_label ? String(p.date_label) : (p?.Count_Date ? String(p.Count_Date) : '')) || '';

        items.push({
          id: String(p?.Circle_id ?? `${abbrev}:${lat},${lon}`),
          name,
          abbrev,
          latitude: lat,
          longitude: lon,
          miles,
          dateLabel,
          circle: {
            name,
            properties: p,
            centerLat: lat,
            centerLon: lon,
            bounds: null,
          }
        });
      }

      setCbcIndex(items);
      return items;
    } catch (e) {
      return null;
    } finally {
      setCbcIndexLoading(false);
    }
  }, [cbcIndexLoading, STRIP_PERSON_FIELDS]);

  const normalizeForSearch = useCallback((s) => {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }, []);

  const searchCbcCircles = useCallback((q, indexOverride = null) => {
    const rawNeedle = String(q || '').trim();
    const needle = rawNeedle.toLowerCase();
    const index = Array.isArray(indexOverride) ? indexOverride : cbcIndexRef.current;
    if (!needle || needle.length < 2 || !Array.isArray(index)) return [];

    const needleNorm = normalizeForSearch(rawNeedle);
    if (!needleNorm || needleNorm.length < 2) return [];

    const needleWords = needle.split(/[^a-z0-9]+/g).filter(Boolean);

    const scoreMatch = (hayRaw, kind) => {
      const hayNorm = normalizeForSearch(hayRaw);
      if (!hayNorm) return null;

      const hayLower = String(hayRaw || '').toLowerCase();
      const hayWords = hayLower.split(/[^a-z0-9]+/g).filter(Boolean);

      const kindPenalty = kind === 'abbrev' ? 2000 : 0;

      if (hayNorm.startsWith(needleNorm)) {
        return kindPenalty + 0;
      }
      const idx = hayNorm.indexOf(needleNorm);
      if (idx !== -1) {
        return kindPenalty + 50 + idx;
      }

      if (needleWords.length && hayWords.length) {
        const bestPrefixPos = hayWords
          .map((w, i) => (w.startsWith(needle) ? i : -1))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b)[0];
        if (Number.isFinite(bestPrefixPos)) {
          return kindPenalty + 120 + bestPrefixPos;
        }
      }
      return null;
    };

    const scored = [];
    for (const item of index) {
      const nameScore = scoreMatch(item.name, 'name');
      const abbrevScore = scoreMatch(item.abbrev, 'abbrev');

      const best = [nameScore, abbrevScore].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0];
      if (!Number.isFinite(best)) continue;

      const score = best + Math.min(25, (item.name.length / 10));
      scored.push({ score, item });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 10).map(({ item }) => ({
      ...item,
      source: 'cbc',
    }));
  }, [normalizeForSearch]);

  const fetchWithDays = useCallback(async (lat, lon, days) => {
    const key = `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}:days=${Number(days) || 8}:units=${String(units || 'us')}`;
    const now = Date.now();
    const TTL_MS = 15 * 60 * 1000;

    const existing = forecastCacheRef.current.get(key);
    if (existing?.data && (now - Number(existing.ts || 0)) < TTL_MS) {
      setForecast(existing.data);
      return;
    }

    if (existing?.promise) {
      try {
        const cached = await existing.promise;
        setForecast(cached);
        return;
      } catch {}
    }

    const p = fetchForecast({ lat, lon, days, units });
    forecastCacheRef.current.set(key, { ts: now, promise: p, data: null });

    try {
      const fc = await p;
      forecastCacheRef.current.set(key, { ts: Date.now(), promise: null, data: fc });
      setForecast(fc);
    } catch (e) {
      forecastCacheRef.current.delete(key);
      setError(e?.message || 'Failed to fetch forecast');
    }
  }, [units]);

  useEffect(() => {
    if (selectedLocation) {
      fetchWithDays(selectedLocation.lat, selectedLocation.lon, 8);
    }
  }, [selectedLocation, fetchWithDays]);

  const plotForecast = useMemo(() => {
    if (!forecast?.hourly?.time || !Array.isArray(forecast.hourly.time)) return forecast;
    if (forecastDays === 8) return forecast;

    const start = new Date(forecast.hourly.time[0]);
    if (Number.isNaN(start.getTime())) return forecast;
    const end = new Date(start.getTime() + forecastDays * 24 * 60 * 60 * 1000);

    const keepIdx = [];
    for (let i = 0; i < forecast.hourly.time.length; i++) {
      const dt = new Date(forecast.hourly.time[i]);
      if (!Number.isNaN(dt.getTime()) && dt < end) keepIdx.push(i);
    }

    const sliceByIdx = (arr) => {
      if (!Array.isArray(arr)) return arr;
      return keepIdx.map((i) => arr[i]);
    };

    return {
      ...forecast,
      hourly: {
        ...forecast.hourly,
        time: keepIdx.map((i) => forecast.hourly.time[i]),
        temperature_2m: sliceByIdx(forecast.hourly.temperature_2m),
        rain: sliceByIdx(forecast.hourly.rain),
        wind_speed_10m: sliceByIdx(forecast.hourly.wind_speed_10m),
        wind_direction_10m: sliceByIdx(forecast.hourly.wind_direction_10m),
        precipitation_probability: sliceByIdx(forecast.hourly.precipitation_probability),
        cloud_cover: sliceByIdx(forecast.hourly.cloud_cover),
      }
    };
  }, [forecast, forecastDays]);

  const countDateISO = useMemo(() => {
    if (selectedLocation?.source !== 'cbc-circle') return '';
    const p = selectedLocation?.circle?.properties || null;
    const raw = p?.Count_Date ?? p?.date_label ?? p?.date;
    return normalizeDateToIso(raw);
  }, [selectedLocation]);

  useEffect(() => {
    if (countDateISO) {
      setHighlightDateISO(countDateISO);
      return;
    }
    setHighlightDateISO('');
  }, [countDateISO]);

  const countDatePassed = useMemo(() => {
    if (!countDateISO) return false;
    const d0 = new Date(`${countDateISO}T00:00:00`);
    if (Number.isNaN(d0.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d0.getTime() < today.getTime();
  }, [countDateISO]);

  const countDateWeatherSummary = useMemo(() => {
    if (!countDateISO) return '';
    if (!countDatePassed) return '';
    const daily = forecast?.daily;
    const times = daily?.time;
    if (!Array.isArray(times)) return '';
    const idx = times.indexOf(countDateISO);
    if (idx < 0) return '';

    const tmax = daily?.temperature_2m_max?.[idx];
    const tmin = daily?.temperature_2m_min?.[idx];
    const precip = daily?.precipitation_sum?.[idx];
    const desc = weathercodeToText(daily?.weathercode?.[idx]);

    const tempUnit = (forecast?.daily_units?.temperature_2m_max) || (units === 'metric' ? '°C' : '°F');
    const precipUnitRaw = (forecast?.daily_units?.precipitation_sum) || (units === 'metric' ? 'mm' : 'in');
    const pu = String(precipUnitRaw).toLowerCase();
    const precipUnit = (pu === 'in' || pu === 'inch' || pu === 'inches') ? '"' : String(precipUnitRaw);

    const parts = [];
    if (desc) parts.push(desc);
    if (Number.isFinite(tmax) && Number.isFinite(tmin)) parts.push(`${Math.round(tmax)} / ${Math.round(tmin)}${tempUnit}`);
    if (Number.isFinite(precip)) parts.push(precipUnit === '"' ? `Precip: ${Number(precip).toFixed(2)}"` : `Precip: ${Number(precip).toFixed(2)} ${precipUnit}`);
    return parts.join(' • ');
  }, [countDateISO, countDatePassed, forecast, units]);

  const scrollToForecast = useCallback(() => {
    const el = document.getElementById('forecast-plot');
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const forecastTitle = useMemo(() => {
    const days = Number(forecastDays) || 8;
    const daysLabel = `${days} day forecast`;

    if (selectedLocation?.source !== 'cbc-circle') return daysLabel;
    const p = selectedLocation?.circle?.properties || {};
    const circleNameRaw = p?.Name ?? p?.CircleName ?? p?.CIRCLE_NAME ?? selectedLocation?.label ?? '';
    const abbrevRaw = p?.Abbrev ?? p?.ABBREV ?? '';
    const circleName = String(circleNameRaw || '').trim();
    const abbrev = String(abbrevRaw || '').trim();

    const dateISO = countDateISO || '';
    const dateLabel = dateISO ? formatIsoToMdy(dateISO) : '';

    if (!circleName && !abbrev && !dateLabel) return daysLabel;
    return [daysLabel, circleName || 'CBC Circle', abbrev || '—', dateLabel || '—'].join(' - ');
  }, [forecastDays, selectedLocation, countDateISO]);

  const exportForecastComposite = useCallback(async () => {
    try {
      const Plotly = (await import('plotly.js-basic-dist-min')).default;
      const el = document.getElementById('forecast-plot');
      if (!el) return;

      const title = String(forecastTitle || '').trim();
      const imageUrl = await Plotly.toImage(el, { format: 'png', scale: 2 });

      const img = new Image();
      img.src = imageUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const titleBlock = 64;
      const countBlock = countDatePassed ? 130 : 0;
      const footerBlock = 32;
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = titleBlock + img.height + countBlock + footerBlock;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#111827';
      ctx.font = '800 30px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillText(title || 'Forecast', 18, 40);

      ctx.drawImage(img, 0, titleBlock);

      if (countDatePassed) {
        let y = titleBlock + img.height + 34;
        ctx.fillStyle = '#111827';
        ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillText('Count day data', 18, y);

        y += 28;
        ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        if (countDateISO) {
          ctx.fillText(`Count date: ${formatIsoToMdy(countDateISO)}`, 18, y);
          y += 24;
        }

        ctx.font = '500 18px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        if (countDateWeatherSummary) {
          ctx.fillText(countDateWeatherSummary, 18, y);
        }
      }

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = '500 14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      ctx.fillText('Weather data by Open-Meteo.com', 18, canvas.height - 12);

      const a = document.createElement('a');
      const filenameBase = (title || `${forecastDays}-day-forecast`).replace(/[^a-z0-9\-_. ]/gi, '').trim().replace(/\s+/g, '_');
      a.download = `${filenameBase || 'forecast'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch (e) {
      setError(e?.message ? `Export failed: ${e.message}` : 'Export failed');
    }
  }, [forecastTitle, forecastDays, countDatePassed, countDateISO, countDateWeatherSummary]);

  const onSearch = useCallback(async (queryOverride) => {
    setError('');
    setCandidates([]);

    const q = (typeof queryOverride === 'string') ? queryOverride : query;
    const qTrim = String(q || '').trim();

    const coords = parseLatLon(qTrim);
    if (coords) {
      const sel = { lat: coords.lat, lon: coords.lon, label: `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` };
      setSelectedLocation(sel);
      return;
    }

    if (!qTrim) {
      setError('Enter a place name or coordinates.');
      return;
    }

    const idx = await loadCbcIndex();
    const cbcMatches = searchCbcCircles(qTrim, idx);

    geocodeSeqRef.current += 1;
    const seq = geocodeSeqRef.current;
    await new Promise((r) => window.setTimeout(r, 350));
    if (seq !== geocodeSeqRef.current) return;

    try {
      const results = await geocode(qTrim, { count: 10 });
      if (seq !== geocodeSeqRef.current) return;
      const geoResults = results.map((r) => ({ ...r, source: 'geocode' }));
      const combined = [...cbcMatches, ...geoResults];
      setCandidates(combined);
      if (combined.length === 0) setError('No locations found.');
    } catch (e) {
      if (seq !== geocodeSeqRef.current) return;
      setError(e?.message || 'Geocoding failed');
      if (cbcMatches.length > 0) setCandidates(cbcMatches);
    }
  }, [query, loadCbcIndex, searchCbcCircles]);

  const selectAndFetch = useCallback(async ({ lat, lon, label, bounds, source, circle, autoLocated }) => {
    setError('');
    setCandidates([]);

    selectionIdRef.current += 1;

    let boundsValue = bounds;
    if (!boundsValue && circle?.properties) {
      const miles = Number(circle?.properties?.BUFF_DIST);
      const mi = Number.isFinite(miles) ? miles : 7.5;
      const centerLat = Number(circle?.centerLat ?? lat);
      const centerLon = Number(circle?.centerLon ?? lon);
      if (Number.isFinite(centerLat) && Number.isFinite(centerLon) && Number.isFinite(mi) && mi > 0) {
        const latDelta = mi / 69.0;
        const cos = Math.cos((centerLat * Math.PI) / 180);
        const lonDelta = mi / (69.0 * Math.max(0.2, cos));
        boundsValue = [[centerLat - latDelta, centerLon - lonDelta], [centerLat + latDelta, centerLon + lonDelta]];
      }
    }

    const sel = {
      lat: Number(lat),
      lon: Number(lon),
      label: label || '',
      bounds: boundsValue,
      source: source || 'manual',
      circle: circle || null,
      autoLocated: Boolean(autoLocated),
      selectionId: selectionIdRef.current,
    };
    setSelectedLocation(sel);
  }, []);

  const onSelectCandidate = useCallback((c) => {
    if (c?.source === 'cbc') {
      selectAndFetch({
        lat: c.latitude,
        lon: c.longitude,
        label: c.name,
        source: 'cbc-circle',
        circle: c.circle
      });
      return;
    }
    selectAndFetch({ lat: c.latitude, lon: c.longitude, label: c.name });
  }, [selectAndFetch]);

  const onSelectSaved = useCallback((s) => {
    selectAndFetch({ lat: s.lat, lon: s.lon, label: s.name });
  }, [selectAndFetch]);

  const onSaveSelected = useCallback((name) => {
    setError('');
    const n = (name || '').trim();
    if (!selectedLocation) {
      setError('Select a location first.');
      return;
    }
    if (!n) {
      setError('Enter a name to save.');
      return;
    }

    const existing = saved.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      const same = Math.abs(existing.lat - selectedLocation.lat) < 1e-6 && Math.abs(existing.lon - selectedLocation.lon) < 1e-6;
      if (!same) {
        setError(`Name conflict: "${n}" already exists with different coordinates.`);
        return;
      }
      setError(`"${n}" already saved.`);
      return;
    }

    const next = [...saved, { name: n, lat: selectedLocation.lat, lon: selectedLocation.lon }].sort((a, b) => a.name.localeCompare(b.name));
    setSaved(next);
    saveSaved(next);
  }, [saved, selectedLocation]);

  const mapSelected = useMemo(() => {
    if (!selectedLocation) return null;
    return { lat: selectedLocation.lat, lon: selectedLocation.lon, name: selectedLocation.label || '' };
  }, [selectedLocation]);

  const extendPlotTo = null;
  const showForecastOverlay = Boolean(selectedLocation);

  return (
    <div className="app appFull">
      <div className="topbar">
        <div className="topbarTitle">Christmas Bird Count Weather Mapper</div>
        <button
          type="button"
          className="infoButton"
          aria-label="About this tool"
          onClick={() => setAboutOpen(true)}
        >
          i
        </button>
      </div>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <MapPane
        appTitle=""
        query={query}
        setQuery={setQuery}
        onSearch={onSearch}
        onSelectCandidate={onSelectCandidate}
        error={error}
        candidates={candidates}
        saved={saved}
        selected={selectedLocation ? {
          lat: selectedLocation.lat,
          lon: selectedLocation.lon,
          bounds: selectedLocation.bounds,
          label: selectedLocation.label,
          source: selectedLocation.source,
          circle: selectedLocation.circle,
          selectionId: selectedLocation.selectionId,
        } : null}
        countDateInfo={{
          iso: countDateISO || '',
          passed: Boolean(countDatePassed),
          weatherSummary: countDateWeatherSummary || ''
        }}
        forecastPanel={{
          show: Boolean(showForecastOverlay),
          title: forecastTitle,
          forecast,
          plotForecast,
          forecastDays,
          setForecastDays,
          units,
          setUnits,
          highlightDateISO,
          setHighlightDateISO,
          extendXAxisTo: extendPlotTo,
          plotId: 'forecast-plot',
          onExport: exportForecastComposite,
        }}
        onJumpToForecast={() => {}}
        onSelect={selectAndFetch}
      />
      </div>
      <footer className="footerbar">
        <a
          className="footerLink"
          href="https://buymeacoffee.com/bartg"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Buy me a coffee"
        >
          <img
            className="bmcButton"
            src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
            alt="Buy Me a Coffee"
            loading="lazy"
          />
        </a>
      </footer>
    </div>
  );
}
