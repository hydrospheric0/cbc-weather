import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MapPane from './components/MapPane.jsx';
import ForecastPlot from './components/ForecastPlot.jsx';
import SummaryTable from './components/SummaryTable.jsx';

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
  if (c === 61) return 'light rain';
  if (c === 63) return 'moderate rain';
  if (c === 65) return 'heavy intensity rain';
  if (c === 66 || c === 67) return 'freezing rain';
  if (c === 71 || c === 73 || c === 75) return 'snow';
  if (c === 77) return 'snow grains';
  if (c === 80 || c === 81 || c === 82) return 'rain showers';
  if (c === 85 || c === 86) return 'snow showers';
  if (c === 95 || c === 96 || c === 99) return 'thunderstorm';
  return 'weather';
}

export default function App() {
  const [query, setQuery] = useState('');

  const [candidates, setCandidates] = useState([]);
  const [saved, setSaved] = useState(() => loadSaved());

  const [selectedLocation, setSelectedLocation] = useState(null); // {lat, lon, label, bounds?, source?, circle?}
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  // Controls the *plot window* only. The left-hand forecast list always shows 10 days.
  const [forecastDays, setForecastDays] = useState(8);

  const [highlightDateISO, setHighlightDateISO] = useState('');

  const [cbcIndex, setCbcIndex] = useState(null); // Array<{ id, name, abbrev, latitude, longitude, dateLabel, circle, miles }>
  const [cbcIndexLoading, setCbcIndexLoading] = useState(false);

  const loadCbcIndex = useCallback(async () => {
    if (cbcIndex || cbcIndexLoading) return;
    setCbcIndexLoading(true);
    try {
      const url = new URL('../data/cbc_circles_merged.geojson', import.meta.url);
      if (import.meta.env.DEV) url.searchParams.set('v', String(Date.now()));
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load CBC circles (${res.status})`);
      const data = await res.json();

      const items = [];
      for (const f of (data?.features || [])) {
        const p = f?.properties || {};
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
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load CBC circles index', e);
      // Don't hard-fail the app; keep normal geocoding.
    } finally {
      setCbcIndexLoading(false);
    }
  }, [cbcIndex, cbcIndexLoading]);

  const normalizeForSearch = useCallback((s) => {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }, []);

  const isSubsequence = useCallback((needle, hay) => {
    const n = String(needle || '');
    const h = String(hay || '');
    if (!n) return true;
    let j = 0;
    for (let i = 0; i < h.length && j < n.length; i++) {
      if (h[i] === n[j]) j++;
    }
    return j === n.length;
  }, []);

  const searchCbcCircles = useCallback((q) => {
    const rawNeedle = String(q || '').trim();
    const needle = rawNeedle.toLowerCase();
    if (!needle || needle.length < 2 || !Array.isArray(cbcIndex)) return [];

    const needleNorm = normalizeForSearch(rawNeedle);
    if (!needleNorm || needleNorm.length < 2) return [];

    const scoreMatch = (hayRaw, kind) => {
      const hayNorm = normalizeForSearch(hayRaw);
      if (!hayNorm) return null;

      // name matches should outrank abbrev matches
      const kindPenalty = kind === 'abbrev' ? 2000 : 0;

      if (hayNorm.startsWith(needleNorm)) {
        return kindPenalty + 0;
      }
      const idx = hayNorm.indexOf(needleNorm);
      if (idx !== -1) {
        return kindPenalty + 50 + idx;
      }
      if (isSubsequence(needleNorm, hayNorm)) {
        // Fuzzy partial match: allow missing chars (e.g., Tonsend ~ Townsend)
        return kindPenalty + 250 + Math.max(0, hayNorm.length - needleNorm.length);
      }
      return null;
    };

    const scored = [];
    for (const item of cbcIndex) {
      const nameScore = scoreMatch(item.name, 'name');
      const abbrevScore = scoreMatch(item.abbrev, 'abbrev');

      const best = [nameScore, abbrevScore].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0];
      if (!Number.isFinite(best)) continue;

      // Small tie-breaker: shorter names slightly preferred
      const score = best + Math.min(25, (item.name.length / 10));
      scored.push({ score, item });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 10).map(({ item }) => ({
      ...item,
      source: 'cbc',
    }));
  }, [cbcIndex, normalizeForSearch, isSubsequence]);

  const fetchWithDays = useCallback(async (lat, lon, days) => {
    try {
      const fc = await fetchForecast({ lat, lon, days });
      setForecast(fc);
    } catch (e) {
      setError(e?.message || 'Failed to fetch forecast');
    }
  }, []);

  // Always fetch 8 days so the left list stays 8-day.
  // The plot is filtered client-side for 3-day view.
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
    // When selecting a CBC circle that has a known count date, default highlight to that date.
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

    const parts = [];
    if (desc) parts.push(desc);
    if (Number.isFinite(tmax) && Number.isFinite(tmin)) parts.push(`${Math.round(tmax)} / ${Math.round(tmin)}°F`);
    if (Number.isFinite(precip)) parts.push(`Precip: ${Number(precip).toFixed(2)}"`);
    return parts.join(' • ');
  }, [countDateISO, countDatePassed, forecast]);

  const scrollToForecast = useCallback(() => {
    const el = document.getElementById('forecast-plot');
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const forecastTitle = useMemo(() => {
    if (selectedLocation?.source === 'cbc-circle') {
      const p = selectedLocation?.circle?.properties || {};
      const name = String(p?.Name || selectedLocation.label || '').trim();
      const abbrev = String(p?.Abbrev || '').trim();
      if (name && abbrev) return `Forecast - ${name} - ${abbrev}`;
      if (name) return `Forecast - ${name}`;
    }
    if (selectedLocation?.label) return `Forecast - ${selectedLocation.label}`;
    return 'Forecast';
  }, [selectedLocation]);

  const onSearch = useCallback(async () => {
    setError('');
    setCandidates([]);

    const coords = parseLatLon(query);
    if (coords) {
      const sel = { lat: coords.lat, lon: coords.lon, label: `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` };
      setSelectedLocation(sel);
      // Effect will trigger fetch
      return;
    }

    if (!query.trim()) {
      setError('Enter a place name or coordinates.');
      return;
    }

    // Ensure we have the CBC circles index loaded (best-effort).
    await loadCbcIndex();
    const cbcMatches = searchCbcCircles(query);

    try {
      const results = await geocode(query.trim(), { count: 10 });
      const geoResults = results.map((r) => ({ ...r, source: 'geocode' }));
      const combined = [...cbcMatches, ...geoResults];
      setCandidates(combined);
      if (combined.length === 0) setError('No locations found.');
    } catch (e) {
      setError(e?.message || 'Geocoding failed');
      if (cbcMatches.length > 0) setCandidates(cbcMatches);
    }
  }, [query, loadCbcIndex, searchCbcCircles]);

  const selectAndFetch = useCallback(async ({ lat, lon, label, bounds, source, circle, autoLocated }) => {
    setError('');
    setCandidates([]);

    let boundsValue = bounds;
    // For CBC matches selected from search, we may only have a center + radius.
    // Provide a bounds array so the map can fit the full circle.
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
      autoLocated: Boolean(autoLocated)
    };
    setSelectedLocation(sel);
    // Effect will trigger fetch
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

  return (
    <div className="app">
      <div className="topbar">CBC weather</div>
      <div className="content">
        <div className="grid">
          <MapPane
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
              circle: selectedLocation.circle
            } : null}
            countDateInfo={{
              iso: countDateISO || '',
              passed: Boolean(countDatePassed),
              weatherSummary: countDateWeatherSummary || ''
            }}
            onJumpToForecast={scrollToForecast}
            onSelect={selectAndFetch}
          />
        </div>

        <div style={{ marginTop: 14, width: '100%', marginLeft: 'auto', marginRight: 'auto', display: 'flex', gap: 14, alignItems: 'stretch', height: '40vh' }}>
          <div className="card" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="cardHeader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>{forecastTitle}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="small" style={{ fontWeight: 600 }}>Highlight</span>
                    <input
                      className="input"
                      type="date"
                      value={highlightDateISO}
                      onChange={(e) => setHighlightDateISO(e.target.value)}
                      style={{ width: 150, padding: '6px 8px', fontSize: 12 }}
                      title="Highlight a day on the plot"
                    />
                  </div>
                <button
                  className="button"
                  style={{ padding: '6px 10px', fontSize: 12, background: forecastDays === 3 ? '#e5e7eb' : '#fff', fontWeight: forecastDays === 3 ? 700 : 400 }}
                  onClick={() => setForecastDays(3)}
                  title="3-day forecast"
                >
                  3 day
                </button>
                <button
                  className="button"
                  style={{ padding: '6px 10px', fontSize: 12, background: forecastDays === 8 ? '#e5e7eb' : '#fff', fontWeight: forecastDays === 8 ? 700 : 400 }}
                  onClick={() => setForecastDays(8)}
                  title="8-day forecast"
                >
                  8 day
                </button>
                <button
                  className="button"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  onClick={async () => {
                    try {
                      const Plotly = (await import('plotly.js-dist-min')).default;
                      const el = document.getElementById('forecast-plot');
                      if (!el) return;

                      const title = (selectedLocation?.label || '').trim();
                      const layoutUpdate = { title: { text: title || '', x: 0.01, xanchor: 'left' } };
                      await Plotly.relayout(el, layoutUpdate);

                      const filenameBase = (title || `${forecastDays}-day-forecast`).replace(/[^a-z0-9\-_. ]/gi, '').trim().replace(/\s+/g, '_');
                      await Plotly.downloadImage(el, { format: 'png', filename: filenameBase || 'forecast', scale: 2 });
                    } catch (e) {
                      // eslint-disable-next-line no-console
                      console.error('Export failed', e);
                    }
                  }}
                  title="Export plot"
                >
                  Export
                </button>
              </div>
            </div>
            <div className="cardBody" style={{ flex: 1, minHeight: 0, padding: 0 }}>
              <div style={{ padding: 12, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                <SummaryTable forecast={forecast} highlightDateISO={highlightDateISO || undefined} daysToShow={forecastDays} />
              </div>
              <div style={{ height: 'calc(100% - 82px)', minHeight: 0 }}>
                <ForecastPlot forecast={plotForecast} highlightDateISO={highlightDateISO || undefined} extendXAxisTo={extendPlotTo} plotId="forecast-plot" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
