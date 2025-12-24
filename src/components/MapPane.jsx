import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, LayersControl, ZoomControl, LayerGroup, Marker, Popup, Tooltip, Circle, CircleMarker, useMap, useMapEvents, GeoJSON, Pane } from 'react-leaflet';
import L from 'leaflet';
import CountDayForm from './CountDayForm.jsx';
import ForecastPlot from './ForecastPlot.jsx';
import { dir16 } from '../lib/geo.js';
import { approxUtcOffsetHoursFromLon, deriveCountDayPrefillFromMetars, fetchMetarsJSON, fetchStationInfoGeoJSON } from '../lib/aviationWeather.js';

// Fix default marker icons in bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function FlyTo({ lat, lon, zoom, bounds, source, circle, selectionId, fitPaddingTopLeft, fitPaddingBottomRight, zoomOutAfterFit }) {
  const map = useMap();
  const lastKeyRef = React.useRef(null);

  const computeAdjustedCenter = React.useCallback((targetLat, targetLon, targetZoom, restPointX, restPointY) => {
    try {
      const size = map.getSize();
      if (!size || !Number.isFinite(size.x) || !Number.isFinite(size.y) || size.x <= 0 || size.y <= 0) {
        return L.latLng(targetLat, targetLon);
      }

      const rpX = Number.isFinite(restPointX) ? restPointX : 0.5;
      const rpY = Number.isFinite(restPointY) ? restPointY : 0.5;

      // Delta from true center (0.5, 0.5) to desired screen rest point.
      const dx = (rpX - 0.5) * size.x;
      const dy = (rpY - 0.5) * size.y;

      const targetPoint = map.project([targetLat, targetLon], targetZoom);
      const adjustedPoint = targetPoint.subtract([dx, dy]);
      return map.unproject(adjustedPoint, targetZoom);
    } catch {
      return L.latLng(targetLat, targetLon);
    }
  }, [map]);

  useEffect(() => {
    const hasLatLon = Number.isFinite(lat) && Number.isFinite(lon);
    if (!hasLatLon) return;

    const circleKey = String(circle?.properties?.Abbrev || circle?.name || '');
    const key = `${Number(selectionId) || 0}:${String(source || '')}:${circleKey}:${lat},${lon}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    // Requested behavior: do not fit-to-bounds or variable zoom.
    // On selection, zoom in up to a fixed 12 (never zoom out); otherwise pan only.
    const FIXED_ZOOM = 12;
    const current = map.getZoom?.();
    const shouldZoomIn = Number.isFinite(current) ? current < FIXED_ZOOM : true;

    const isCbcSelection = String(source || '').startsWith('cbc');
    // Desired on-screen rest point: for CBC selections, land ~70% from left.
    const restPointX = isCbcSelection ? 0.70 : 0.50;
    // Move the target ~10% higher on screen.
    const restPointY = 0.40;

    if (shouldZoomIn) {
      const adjusted = computeAdjustedCenter(lat, lon, FIXED_ZOOM, restPointX, restPointY);
      map.setView(adjusted, FIXED_ZOOM, { animate: true, duration: 0.6 });
      return;
    }

    const z = Number.isFinite(current) ? current : FIXED_ZOOM;
    const adjusted = computeAdjustedCenter(lat, lon, z, restPointX, restPointY);
    map.panTo(adjusted, { animate: true, duration: 0.6 });
  }, [lat, lon, zoom, bounds, source, circle, selectionId, fitPaddingTopLeft, fitPaddingBottomRight, zoomOutAfterFit, map, computeAdjustedCenter]);
  return null;
}

// NOTE: fillOpacity 0 keeps appearance the same, but makes the entire polygon area interactive
// (so hover tooltips work when the cursor is inside the circle, not only on the thin outline).
const CIRCLE_STYLE_BASE = { color: '#444', weight: 2, fill: true, fillOpacity: 0 };

const OSM_LAYER_NAME = 'OpenStreetMap';
const ESRI_LAYER_NAME = 'Esri Satellite';
const ESRI_TOPO_LAYER_NAME = 'Esri Topo';

const DEFAULT_CENTER = [37.5333, -98.6833];
const DEFAULT_ZOOM = 3.5;

const STATION_RADIUS_MILES = 20;

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function milesToMeters(miles) {
  const mi = Number(miles);
  if (!Number.isFinite(mi)) return null;
  return mi * 1609.34;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function milesFromKm(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return null;
  return n * 0.621371;
}

function bboxAroundMiles(lat, lon, miles) {
  const latN = Number(lat);
  const lonN = Number(lon);
  const mi = Number(miles);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN) || !Number.isFinite(mi)) return '';
  const latDelta = mi / 69;
  const lonDelta = mi / (69 * Math.cos((latN * Math.PI) / 180));
  const lat0 = latN - latDelta;
  const lon0 = lonN - lonDelta;
  const lat1 = latN + latDelta;
  const lon1 = lonN + lonDelta;
  return `${lat0},${lon0},${lat1},${lon1}`;
}

async function loadGeoJson(url) {
  const res = await fetch(String(url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load GeoJSON (${res.status})`);
  return res.json();
}

function MapClickHandler({ onMapClick }) {
  const map = useMapEvents({
    click: (e) => {
      // Ignore clicks that originate from interactive overlays/markers/popups.
      // Without this, clicking a CBC center point can also trigger the map click handler,
      // overriding the circle selection (and its bounds) and making the view zoom to a point.
      const t = e?.originalEvent?.target;
      try {
        if (t?.closest?.('.leaflet-interactive') || t?.closest?.('.leaflet-marker-icon') || t?.closest?.('.leaflet-popup')) {
          return;
        }
      } catch {
        // ignore
      }

      onMapClick(e.latlng, map.getZoom());
    },
  });
  return null;
}

function formatCbcTooltip(props) {
  const name = String(props?.Name || props?.Abbrev || 'CBC Circle');
  const count = props?.Count_Date ? String(props.Count_Date) : (props?.date_label ? String(props.date_label) : (props?.date ? String(props.date) : ''));
  const abbrev = props?.Abbrev ? String(props.Abbrev) : '';
  const parts = [name];
  if (abbrev && abbrev !== name) parts.push(`(${abbrev})`);
  if (count) parts.push(`• ${count}`);
  return parts.join(' ');
}

function normalizeDateToIso(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Common CBC formats like M/D/YY or MM/DD/YY
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

function ZoomSync({ onZoomChange }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return undefined;
    const update = () => onZoomChange(map.getZoom());
    update();

    map.on('zoomend', update);
    return () => {
      map.off('zoomend', update);
    };
  }, [map, onZoomChange]);
  return null;
}

function BaseLayerSync({ onBaseLayerName }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return undefined;

    const handler = (e) => {
      const name = e?.name ? String(e.name) : '';
      if (name) onBaseLayerName(name);
    };

    map.on('baselayerchange', handler);
    return () => {
      map.off('baselayerchange', handler);
    };
  }, [map, onBaseLayerName]);
  return null;
}

function OverlayActiveSync({ layerRef, onActiveChange }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return undefined;

    const resolveLayer = () => {
      const ref = layerRef?.current;
      // react-leaflet ref is typically the Leaflet layer instance.
      // Some versions expose { leafletElement }.
      return ref?.leafletElement || ref || null;
    };

    const update = () => {
      const layer = resolveLayer();
      if (!layer) return;
      onActiveChange(Boolean(map.hasLayer(layer)));
    };

    const onAdd = (e) => {
      const layer = resolveLayer();
      if (layer && e?.layer === layer) onActiveChange(true);
    };
    const onRemove = (e) => {
      const layer = resolveLayer();
      if (layer && e?.layer === layer) onActiveChange(false);
    };

    update();
    map.on('overlayadd', onAdd);
    map.on('overlayremove', onRemove);
    return () => {
      map.off('overlayadd', onAdd);
      map.off('overlayremove', onRemove);
    };
  }, [map, layerRef, onActiveChange]);

  return null;
}

// Auto-open popup removed: popups should open only on click.

function pick(props, keys) {
  for (const k of keys) {
    const v = props?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

export default function MapPane({
  appTitle,
  query,
  setQuery,
  onSearch,
  onSelectCandidate,
  error,
  candidates,
  saved,
  selected,
  countDateInfo,
  forecastPanel,
  onJumpToForecast,
  onSelect
}) {

  const searchInputRef = React.useRef(null);

  const center = useMemo(() => {
    const lat = Number(selected?.lat);
    const lon = Number(selected?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    return DEFAULT_CENTER;
  }, [selected]);

  const CBC_ZOOM_POINT_THRESHOLD = 10;

  const [cbcGeoJson, setCbcGeoJson] = useState(null);

  const [cbcSelectedCircle, setCbcSelectedCircle] = useState(null);
  // { name, properties, centerLat, centerLon, bounds }
  const [cbcPoint, setCbcPoint] = useState(null); // { lat, lon }

  const [userLocation, setUserLocation] = useState(null); // { lat, lon }
  const [didAutoLocate, setDidAutoLocate] = useState(false);

  const [mapZoom, setMapZoom] = useState(null);
  const [baseLayerName, setBaseLayerName] = useState(OSM_LAYER_NAME);

  const rainViewerLayerRef = React.useRef(null);
  const selectedCircleMarkerRef = React.useRef(null);

  const circleStyle = useMemo(() => {
    const isEsri = baseLayerName === ESRI_LAYER_NAME;
    return { ...CIRCLE_STYLE_BASE, color: isEsri ? '#fff' : CIRCLE_STYLE_BASE.color };
  }, [baseLayerName]);

  const selectedCircleProps = useMemo(() => {
    const p = selected?.circle?.properties || null;
    return p && typeof p === 'object' ? p : null;
  }, [selected]);

  const selectedCircleSummary = useMemo(() => {
    if (!selectedCircleProps) return null;
    const p = selectedCircleProps;

    const circleName = pick(p, ['Name', 'CircleName', 'CIRCLE_NAME', 'Abbrev', 'ABBREV']) || 'CBC Circle';
    const abbrev = pick(p, ['Abbrev', 'ABBREV']);
    const countDate = pick(p, ['Count_Date', 'COUNT_DATE', 'CountDate', 'Count Date', 'date_label', 'date']);
    const buffDist = pick(p, ['BUFF_DIST', 'BuffDist', 'BUFFDIST']);
    const lat = pick(p, ['Latitude', 'LATITUDE', 'Lat']);
    const lon = pick(p, ['Longitude', 'LONGITUDE', 'Lon', 'Lng']);
    const firstName = pick(p, ['FirstName', 'first_name', 'FIRST_NAME']);
    const lastName = pick(p, ['LastName', 'last_name', 'LAST_NAME']);
    const compiler = pick(p, ['compiler', 'Compiler']);
    const contactEmail = pick(p, ['contact_email', 'EmailAddress', 'email', 'Email']);
    const contactPhone = pick(p, ['contact_phone', 'phone', 'Phone']);

    const leaderName = [firstName, lastName].filter(Boolean).join(' ').trim() || (compiler ? String(compiler) : '');

    return {
      circleName,
      abbrev,
      countDate,
      buffDist,
      lat,
      lon,
      leaderName,
      contactEmail,
      contactPhone
    };
  }, [selectedCircleProps]);

  const isCbcCircleSelection = selected?.source === 'cbc-circle';
  const showLeftInfoPanel = Boolean(selected && (isCbcCircleSelection ? selectedCircleSummary : true));
  const hasLeftInfoPanel = showLeftInfoPanel;

  const selectedCircleTitle = useMemo(() => {
    if (!selectedCircleSummary) return '';
    const name = String(selectedCircleSummary.circleName || '').trim();
    const ab = String(selectedCircleSummary.abbrev || '').trim();
    const rawCount = String(selectedCircleSummary.countDate || '').trim();
    const iso = normalizeDateToIso(rawCount);
    const mdy = iso ? formatIsoToMdy(iso) : '';
    const parts = [];
    if (name) parts.push(name);
    if (ab) parts.push(ab);
    if (mdy) parts.push(mdy);
    else parts.push('Unknown');
    return parts.join(' - ');
  }, [selectedCircleSummary]);

  const customLocationTitle = useMemo(() => {
    if (!selected || isCbcCircleSelection) return '';
    return 'Custom location';
  }, [selected, isCbcCircleSelection]);

  const countDatePassed = Boolean(countDateInfo?.passed);
  const countDateWeatherSummary = String(countDateInfo?.weatherSummary || '').trim();
  const countDateISO = String(countDateInfo?.iso || '').trim();

  const selectedCircleCenter = useMemo(() => {
    if (selected?.source !== 'cbc-circle') return null;
    const centerLat = isFiniteNumber(selected?.circle?.centerLat) ? selected.circle.centerLat : (isFiniteNumber(selectedCircleProps?.Latitude) ? selectedCircleProps.Latitude : null);
    const centerLon = isFiniteNumber(selected?.circle?.centerLon) ? selected.circle.centerLon : (isFiniteNumber(selectedCircleProps?.Longitude) ? selectedCircleProps.Longitude : null);
    if (!isFiniteNumber(centerLat) || !isFiniteNumber(centerLon)) return null;
    return { lat: centerLat, lon: centerLon };
  }, [selected, selectedCircleProps]);

  const [stations15mi, setStations15mi] = useState([]); // [{ icaoId, site, lat, lon, miles, siteType }]
  const [nearestStation, setNearestStation] = useState(null);
  const [stationFetch, setStationFetch] = useState({ loading: false, error: '' });
  const [metarFetch, setMetarFetch] = useState({ loading: false, error: '' });
  const [stationPrefill, setStationPrefill] = useState(null); // { patch, used, stationId }

  const countDayFormEnabled = Boolean(selectedCircleSummary?.countDate) && countDatePassed && Boolean(countDateISO);
  const countDayDataStatus = useMemo(() => {
    if (!countDayFormEnabled) return 'idle';
    if (stationFetch.loading || metarFetch.loading) return 'loading';
    if (stationFetch.error || metarFetch.error) return 'idle';
    if (stationPrefill?.patch && typeof stationPrefill.patch === 'object') return 'ready';
    return 'notfound';
  }, [countDayFormEnabled, stationFetch.loading, metarFetch.loading, stationFetch.error, metarFetch.error, stationPrefill]);

  useEffect(() => {
    setStations15mi([]);
    setNearestStation(null);
    setStationPrefill(null);
    setStationFetch({ loading: false, error: '' });
    setMetarFetch({ loading: false, error: '' });

    if (!selectedCircleCenter) return;
    if (!countDatePassed) return;

    const controller = new AbortController();
    const centerLat = selectedCircleCenter.lat;
    const centerLon = selectedCircleCenter.lon;

    const stationHasMetar = (st) => {
      const types = Array.isArray(st?.siteType) ? st.siteType : [];
      return types.some((t) => String(t || '').toLowerCase().includes('metar'));
    };

    (async () => {
      setStationFetch({ loading: true, error: '' });
      const bbox = bboxAroundMiles(centerLat, centerLon, STATION_RADIUS_MILES);
      const gj = await fetchStationInfoGeoJSON({ bbox, signal: controller.signal });
      const features = Array.isArray(gj?.features) ? gj.features : [];

      const items = [];
      for (const f of features) {
        const p = f?.properties || {};
        const icaoId = String(p?.icaoId || '').trim();
        const site = String(p?.site || '').trim();
        const types = Array.isArray(p?.siteType) ? p.siteType : [];
        const coords = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
        const lon = Array.isArray(coords) ? Number(coords[0]) : null;
        const lat = Array.isArray(coords) ? Number(coords[1]) : null;
        if (!icaoId || !isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;

        const km = haversineKm(centerLat, centerLon, lat, lon);
        const miles = milesFromKm(km);
        if (!Number.isFinite(miles) || miles > STATION_RADIUS_MILES) continue;

        items.push({ icaoId, site, siteType: types, lat, lon, miles });
      }

      items.sort((a, b) => a.miles - b.miles);
      setStations15mi(items);
      setNearestStation(items.find(stationHasMetar) || items[0] || null);
      setStationFetch({ loading: false, error: '' });
    })().catch((e) => {
      if (controller.signal.aborted) return;
      setStationFetch({ loading: false, error: e?.message || String(e) });
    });

    return () => controller.abort();
  }, [selectedCircleCenter?.lat, selectedCircleCenter?.lon, countDatePassed]);

  useEffect(() => {
    setStationPrefill(null);
    setMetarFetch({ loading: false, error: '' });

    if (!nearestStation?.icaoId) return;
    if (!countDatePassed || !countDateISO) return;

    const controller = new AbortController();

    (async () => {
      setMetarFetch({ loading: true, error: '' });

      const offsetHours = approxUtcOffsetHoursFromLon(nearestStation.lon);
      const [yy, mm, dd] = String(countDateISO).split('-').map((v) => Number(v));
      const localEndUtcMs = Date.UTC(yy, mm - 1, dd, 23, 59, 59) - offsetHours * 3600 * 1000;
      const date = new Date(localEndUtcMs).toISOString();

      const metars = await fetchMetarsJSON({
        ids: nearestStation.icaoId,
        hours: 30,
        date,
        signal: controller.signal
      });

      const derived = deriveCountDayPrefillFromMetars({ metars, stationLon: nearestStation.lon, countDateISO });
      const patch = derived?.patch ? { ...derived.patch } : null;

      if (patch && Number.isFinite(patch.windDirDegrees)) {
        patch.windDir = dir16(patch.windDirDegrees) || 'Unknown';
        delete patch.windDirDegrees;
      }

      setStationPrefill(patch ? { patch, used: derived.used, stationId: nearestStation.icaoId } : null);
      setMetarFetch({ loading: false, error: '' });
    })().catch((e) => {
      if (controller.signal.aborted) return;
      setMetarFetch({ loading: false, error: e?.message || String(e) });
    });

    return () => controller.abort();
  }, [nearestStation?.icaoId, nearestStation?.lon, countDatePassed, countDateISO]);

  const [rainViewerFrames, setRainViewerFrames] = useState([]); // [{ time, path }]
  const [rainViewerHost, setRainViewerHost] = useState('https://tilecache.rainviewer.com');
  const [rainViewerTimestamp, setRainViewerTimestamp] = useState(null);
  const [isRainViewerActive, setIsRainViewerActive] = useState(false);

  const rainViewerRadarUrl = useMemo(() => {
    if (!Number.isFinite(rainViewerTimestamp)) return null;
    const host = String(rainViewerHost || 'https://tilecache.rainviewer.com').replace(/\/$/, '');
    // Based on RainViewer public endpoints + Leaflet.Rainviewer plugin conventions.
    // Example: https://tilecache.rainviewer.com/v2/radar/<ts>/256/{z}/{x}/{y}/2/1_1.png
    return `${host}/v2/radar/${rainViewerTimestamp}/256/{z}/{x}/{y}/2/1_1.png`;
  }, [rainViewerTimestamp]);

  useEffect(() => {
    // Intentionally no initial RainViewer API fetch here.
    // This avoids metered usage unless the radar overlay is enabled.
    return undefined;
  }, []);

  useEffect(() => {
    if (!isRainViewerActive) return undefined;

    let cancelled = false;
    let intervalId = null;

    const refresh = async () => {
      // Reuse the same endpoint; keep the overlay current while enabled.
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        const host = typeof data?.host === 'string' ? data.host : null;
        const past = Array.isArray(data?.radar?.past) ? data.radar.past : [];
        const nowcast = Array.isArray(data?.radar?.nowcast) ? data.radar.nowcast : [];

        const frames = [
          ...past.map((f) => ({ time: Number(f?.time), path: String(f?.path || ''), kind: 'past' })),
          ...nowcast.map((f) => ({ time: Number(f?.time), path: String(f?.path || ''), kind: 'nowcast' })),
        ].filter((f) => Number.isFinite(f.time) && f.time > 0 && f.path.startsWith('/'));

        if (cancelled) return;
        if (host) setRainViewerHost(host);
        if (frames.length) {
          setRainViewerFrames(frames);
          const last = frames[frames.length - 1].time;
          if (Number.isFinite(last)) setRainViewerTimestamp(last);
        }
      } catch {
        // ignore
      }
    };

    refresh();
    intervalId = window.setInterval(refresh, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [isRainViewerActive]);

  useEffect(() => {
    if (!isRainViewerActive) return undefined;
    if (!Array.isArray(rainViewerFrames) || rainViewerFrames.length < 2) return undefined;

    // Try to animate roughly the last 6 hours. RainViewer typically provides fewer hours
    // (often ~2h past + short nowcast), so this will animate whatever is available.
    const nowSec = Date.now() / 1000;
    const cutoff = nowSec - (6 * 60 * 60);
    const frames = rainViewerFrames.filter((f) => f.time >= cutoff);
    const playable = frames.length >= 2 ? frames : rainViewerFrames;

    let idx = Math.max(0, playable.length - 1);
    setRainViewerTimestamp(playable[idx].time);

    const timer = window.setInterval(() => {
      idx = (idx + 1) % playable.length;
      setRainViewerTimestamp(playable[idx].time);
    }, 700);

    return () => {
      window.clearInterval(timer);
    };
  }, [isRainViewerActive, rainViewerFrames]);

  const rainViewerTimestampLabel = useMemo(() => {
    if (!Number.isFinite(rainViewerTimestamp)) return '';
    try {
      const dt = new Date(Number(rainViewerTimestamp) * 1000);
      if (Number.isNaN(dt.getTime())) return '';

      const frame = Array.isArray(rainViewerFrames)
        ? rainViewerFrames.find((f) => Number(f?.time) === Number(rainViewerTimestamp))
        : null;
      const kind = frame?.kind === 'nowcast' ? 'nowcast' : (frame?.kind === 'past' ? 'past' : '');

      const when = dt.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
      return kind ? `${when} (${kind})` : when;
    } catch {
      return '';
    }
  }, [rainViewerTimestamp, rainViewerFrames]);

  const selectCbcCircle = useMemo(() => {
    return (feature, boundsOverride, options) => {
      const props = feature?.properties || {};
      const circleName = String(props?.Name || props?.Abbrev || 'CBC Circle');

      const centerLat = isFiniteNumber(props?.Latitude) ? props.Latitude : null;
      const centerLon = isFiniteNumber(props?.Longitude) ? props.Longitude : null;

      let bounds = boundsOverride || null;
      if (!bounds) {
        // If we only have a point feature, compute a circle bounds from BUFF_DIST.
        const miles = isFiniteNumber(props?.BUFF_DIST) ? props.BUFF_DIST : 7.5;
        const radiusMeters = milesToMeters(miles);
        if (isFiniteNumber(centerLat) && isFiniteNumber(centerLon) && Number.isFinite(radiusMeters) && radiusMeters > 0) {
          try {
            bounds = L.circle([centerLat, centerLon], { radius: radiusMeters }).getBounds();
          } catch {
            bounds = null;
          }
        }

        if (!bounds) {
          try {
            bounds = L.geoJSON(feature).getBounds();
          } catch {
            bounds = null;
          }
        }
      }

      const boundsArrayFromLeaflet = (b) => {
        try {
          if (!b?.getSouthWest || !b?.getNorthEast) return null;
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          if (!sw || !ne) return null;
          if (!Number.isFinite(sw.lat) || !Number.isFinite(sw.lng) || !Number.isFinite(ne.lat) || !Number.isFinite(ne.lng)) return null;
          return [[sw.lat, sw.lng], [ne.lat, ne.lng]];
        } catch {
          return null;
        }
      };

      const isBoundsArray = Array.isArray(boundsOverride)
        && boundsOverride.length === 2
        && Array.isArray(boundsOverride[0])
        && Array.isArray(boundsOverride[1])
        && boundsOverride[0].length === 2
        && boundsOverride[1].length === 2;

      const validLeafletBounds = (!isBoundsArray && bounds && bounds.isValid && bounds.isValid()) ? bounds : null;
      const boundsForSelect = isBoundsArray ? boundsOverride : (validLeafletBounds ? boundsArrayFromLeaflet(validLeafletBounds) : null);

      setCbcSelectedCircle({
        name: circleName,
        properties: props,
        centerLat,
        centerLon,
        bounds: validLeafletBounds,
      });
      setCbcPoint(null);

      if (isFiniteNumber(centerLat) && isFiniteNumber(centerLon)) {
        onSelect({
          lat: centerLat,
          lon: centerLon,
          label: circleName,
          bounds: boundsForSelect || undefined,
          source: 'cbc-circle',
          autoLocated: Boolean(options?.autoLocated),
          circle: {
            name: circleName,
            properties: props,
            centerLat,
            centerLon,
            bounds: validLeafletBounds || null
          }
        });
      }
    };
  }, [onSelect]);

  const redIcon = useMemo(() => {
    return L.divIcon({
      className: 'cbc-pin-icon',
      html: '<div style="width:14px;height:14px;border-radius:9999px;background:#ef4444;border:2px solid #fff;box-shadow:0 0 0 1px #111"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8]
    });
  }, []);

  const blueIcon = useMemo(() => {
    return L.divIcon({
      className: 'cbc-pin-icon',
      html: '<div style="width:14px;height:14px;border-radius:9999px;background:#3b82f6;border:2px solid #fff;box-shadow:0 0 0 1px #111"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8]
    });
  }, []);

  const cbcCenters = useMemo(() => {
    if (!cbcGeoJson?.features) return null;

    const items = [];
    const featureById = new Map();

    cbcGeoJson.features.forEach((f, idx) => {
      const p = f?.properties || {};
      const lat = p?.Latitude;
      const lon = p?.Longitude;
      if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return;

      const miles = isFiniteNumber(p?.BUFF_DIST) ? p.BUFF_DIST : 7.5;
      const radiusMeters = milesToMeters(miles);
      if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return;

      const base = String(p?.CircleID || p?.CIRCLE_ID || p?.id || p?.Abbrev || p?.Name || '');
      const id = `${base}|${lat}|${lon}|${String(p?.Count_Date || '')}|${idx}`;
      featureById.set(id, f);

      const label = String(p?.Name || p?.Abbrev || 'CBC Circle');
      items.push({
        id,
        lat,
        lon,
        label,
        radiusMeters,
        tooltip: formatCbcTooltip(p)
      });
    });

    return { items, featureById };
  }, [cbcGeoJson]);

  const activeCbcCenterId = useMemo(() => {
    if (selected?.source !== 'cbc-circle') return '';
    if (!cbcCenters?.items?.length) return '';
    const lat = Number(selected?.lat);
    const lon = Number(selected?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

    // Match by exact center coordinates (CBC circle selection uses the circle center).
    // Tolerant compare to avoid float noise.
    const eps = 1e-6;
    const hit = cbcCenters.items.find((c) => Math.abs(Number(c.lat) - lat) < eps && Math.abs(Number(c.lon) - lon) < eps);
    return hit?.id ? String(hit.id) : '';
  }, [selected, cbcCenters]);

  const cbcCentersGeoJson = useMemo(() => {
    if (!cbcCenters?.items?.length) return null;
    return {
      type: 'FeatureCollection',
      features: cbcCenters.items.map((c) => ({
        type: 'Feature',
        properties: { __centerId: c.id, Name: c.label },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] }
      }))
    };
  }, [cbcCenters]);

  const cbcAllBounds = useMemo(() => {
    if (!cbcCenters?.items?.length) return null;
    let bounds = null;
    for (const c of cbcCenters.items) {
      if (!isFiniteNumber(c?.lat) || !isFiniteNumber(c?.lon)) continue;
      if (!Number.isFinite(c?.radiusMeters) || c.radiusMeters <= 0) continue;
      try {
        const b = L.circle([c.lat, c.lon], { radius: c.radiusMeters }).getBounds();
        if (!bounds) bounds = b;
        else bounds.extend(b);
      } catch {
        // ignore
      }
    }
    return bounds && bounds.isValid && bounds.isValid() ? bounds : null;
  }, [cbcCenters]);

  const mapKey = 'map-default';

  useEffect(() => {
    let cancelled = false;
    if (cbcGeoJson) return undefined;

    // Load all nationwide CBC circles (with their buffer MultiPolygons already computed)
    // and local-corrected count dates merged in.
    const cbcUrl = new URL('../../data/cbc_circles_merged.geojson', import.meta.url);
    if (import.meta.env.DEV) {
      cbcUrl.searchParams.set('v', String(Date.now()));
    }

    loadGeoJson(cbcUrl)
      .then((data) => {
        if (!cancelled) setCbcGeoJson(data);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load cbc_circles_merged.geojson', e);
      });

    return () => {
      cancelled = true;
    };
  }, [cbcGeoJson]);

  useEffect(() => {
    if (selected) return;
    if (!('geolocation' in navigator)) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const lat = Number(pos?.coords?.latitude);
        const lon = Number(pos?.coords?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          setUserLocation({ lat, lon });
        }
      },
      () => {
        // ignore (permission denied/unavailable)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );

    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (didAutoLocate) return;
    if (selected) return;
    if (!userLocation) return;
    if (!cbcCenters?.items?.length || !cbcCenters?.featureById) return;

    let best = null;
    let bestDist = Infinity;
    for (const c of cbcCenters.items) {
      if (!isFiniteNumber(c?.lat) || !isFiniteNumber(c?.lon)) continue;
      const d = haversineKm(userLocation.lat, userLocation.lon, c.lat, c.lon);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }

    if (best?.id) {
      const feature = cbcCenters.featureById.get(String(best.id));
      if (feature) {
        setDidAutoLocate(true);
        selectCbcCircle(feature, undefined, { autoLocated: true });
      }
    }
  }, [didAutoLocate, selected, userLocation, cbcCenters, selectCbcCircle]);

  return (
    <div className="mapFullWrap">
      <div className="map mapFull">
        <div
          style={{
            position: 'absolute',
            left: hasLeftInfoPanel
              ? 'calc(var(--cbc-sidebar-w) + var(--cbc-overlay-gap) + var(--cbc-overlay-pad) + 30px)'
              : 'var(--cbc-overlay-pad)',
            right: 'auto',
            top: 12,
            zIndex: 1200,
            width: 'var(--cbc-search-w)',
            maxWidth: hasLeftInfoPanel
              ? 'calc(100% - (var(--cbc-sidebar-w) + var(--cbc-overlay-gap) + (2 * var(--cbc-overlay-pad)) + 30px))'
              : 'calc(100% - (2 * var(--cbc-overlay-pad)))',
            maxHeight: '100%',
            overflow: 'auto',
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: 10,
            padding: 10,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)'
          }}
        >
          <div
            style={{
              marginTop: 0,
              background: '#009688',
              borderRadius: 10,
              padding: 8
            }}
          >
            <div className="small" style={{ fontWeight: 700, color: '#fff' }}>Find CBC circle</div>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                ref={searchInputRef}
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSearch(e.currentTarget.value);
                  }
                }}
                placeholder="Search CBC circle / place / lat,lon"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                className="button"
                onClick={() => onSearch(searchInputRef.current?.value ?? query)}
                style={{
                  width: 'auto',
                  padding: '6px 10px',
                  fontSize: 12,
                  whiteSpace: 'nowrap'
                }}
              >
                Search
              </button>
            </div>
          </div>

          {Array.isArray(candidates) && candidates.length > 0 && (
            <ul className="list" style={{ marginTop: 10, maxHeight: 260 }}>
              {candidates.map((c) => (
                <li
                  key={`${c.source || 'geocode'}:${c.id || ''}:${c.latitude},${c.longitude},${c.name}`}
                  className="listItem"
                  style={{ backgroundColor: c.source === 'cbc' ? 'rgba(0, 150, 136, 0.18)' : 'transparent' }}
                  onClick={() => onSelectCandidate(c)}
                  title="Click to select & fetch forecast"
                >
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="small">
                    {c.source === 'cbc' ? 'CBC circle' : (c.admin1 ? `${c.admin1}, ` : '')}
                    {c.source !== 'cbc' && c.country ? c.country : ''}
                    {c.source === 'cbc' && c.dateLabel ? ` • ${c.dateLabel}` : ''}
                    {' • '}{Number(c.latitude).toFixed(4)}, {Number(c.longitude).toFixed(4)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
        </div>

        {showLeftInfoPanel && (
          <div
            style={{
              position: 'absolute',
              left: 'var(--cbc-overlay-pad)',
              top: 12,
              zIndex: 1100,
              width: 'var(--cbc-sidebar-w)',
              maxWidth: 'calc(100% - 20px)',
              maxHeight: '100%',
              overflow: 'auto',
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 10,
              padding: 14,
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)'
            }}
          >
            <div style={{ marginTop: 0 }}>
              <div
                style={{
                  fontWeight: 900,
                  marginTop: 0,
                  fontSize: 22,
                  lineHeight: 1.2,
                  background: '#009688',
                  color: '#f9fafb',
                  padding: '10px 12px',
                  borderRadius: 10
                }}
              >
                {isCbcCircleSelection
                  ? (selectedCircleTitle || selectedCircleSummary?.circleName || 'CBC Circle')
                  : (customLocationTitle || 'Custom location:')}
              </div>

              <div style={{ paddingLeft: 22, paddingRight: 22 }}>
                {isCbcCircleSelection && (selectedCircleSummary?.leaderName || selectedCircleSummary?.contactEmail || selectedCircleSummary?.contactPhone) && (
                  <div style={{ opacity: 0.9, marginTop: 12, fontSize: 16, fontWeight: 700 }}>
                    {selectedCircleSummary.leaderName ? `Contact: ${selectedCircleSummary.leaderName}` : ''}
                    {selectedCircleSummary.leaderName && (selectedCircleSummary.contactEmail || selectedCircleSummary.contactPhone) ? ' • ' : ''}
                    {selectedCircleSummary.contactEmail ? selectedCircleSummary.contactEmail : ''}
                    {(selectedCircleSummary.contactEmail && selectedCircleSummary.contactPhone) ? ' • ' : ''}
                    {selectedCircleSummary.contactPhone ? selectedCircleSummary.contactPhone : ''}
                  </div>
                )}

                {isCbcCircleSelection && selectedCircleSummary?.countDate && countDatePassed && countDateWeatherSummary && (
                  <div style={{ opacity: 0.95, marginTop: 12, fontSize: 14, fontWeight: 700 }}>
                    -{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (typeof onJumpToForecast === 'function') onJumpToForecast();
                      }}
                      style={{ color: 'inherit', textDecoration: 'underline' }}
                      title="Jump to forecast plot"
                    >
                      {countDateWeatherSummary}
                    </a>
                  </div>
                )}

                <div
                  className="small"
                  style={{
                    opacity: 0.9,
                    marginTop: 12,
                    fontSize: 14,
                    fontWeight: 650
                  }}
                >
                  {(() => {
                    const parts = [];
                    if (isCbcCircleSelection) {
                      if (selectedCircleSummary?.lat !== null && selectedCircleSummary?.lon !== null) {
                        parts.push(`Center: ${Number(selectedCircleSummary.lat).toFixed(4)}, ${Number(selectedCircleSummary.lon).toFixed(4)}`);
                      }
                      if (selectedCircleSummary?.buffDist !== null) {
                        parts.push(`Radius: ${selectedCircleSummary.buffDist} mi`);
                      }
                    } else {
                      const lat = Number(selected?.lat);
                      const lon = Number(selected?.lon);
                      if (Number.isFinite(lat) && Number.isFinite(lon)) {
                        parts.push(`Center: ${lon.toFixed(4)}, ${lat.toFixed(4)}`);
                      }
                    }

                    const centerRadius = parts.join(' • ');
                    const showStation = isCbcCircleSelection && countDatePassed && Boolean(stationFetch.loading || stationFetch.error || nearestStation);

                    const stationText = stationFetch.loading
                      ? 'Loading…'
                      : stationFetch.error
                        ? `Error: ${stationFetch.error}`
                        : nearestStation
                          ? `${nearestStation.icaoId}${nearestStation.site ? ` - ${nearestStation.site}` : ''} (${nearestStation.miles.toFixed(1)} mi)`
                          : 'None found';

                    return (
                      <>
                        {centerRadius}
                        {showStation ? (
                          <>
                            {' • '}
                            Met Station: {stationText}
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>

              {forecastPanel?.show && (
                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      background: 'rgba(61,109,176,0.14)',
                      borderRadius: 10,
                      padding: '8px 10px'
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2, color: '#111827' }}>{Number(forecastPanel.forecastDays) || 8} day forecast</div>
                    <button
                      className="button"
                      style={{ padding: '6px 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => forecastPanel.onExport?.()}
                      title="Export forecast"
                    >
                      Export
                    </button>
                  </div>

                  <div style={{ marginTop: 0 }}>
                    <ForecastPlot
                      forecast={forecastPanel.plotForecast || forecastPanel.forecast}
                      highlightDateISO={forecastPanel.highlightDateISO || undefined}
                      extendXAxisTo={forecastPanel.extendXAxisTo || null}
                      plotId={forecastPanel.plotId || 'forecast-plot'}
                    />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                      marginTop: 4
                    }}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="small" style={{ fontWeight: 700 }}>Highlight</span>
                      <input
                        className="input"
                        type="date"
                        value={forecastPanel.highlightDateISO || ''}
                        onChange={(e) => forecastPanel.setHighlightDateISO?.(e.target.value)}
                        style={{ width: 150, padding: '6px 8px', fontSize: 12 }}
                        title="Highlight a day on the plot"
                      />
                    </div>

                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="small" style={{ fontWeight: 700 }}>Units</span>
                      <button
                        className="button"
                        style={{
                          padding: '6px 10px',
                          fontSize: 12,
                          background: forecastPanel.units === 'metric' ? '#e5e7eb' : '#fff',
                          fontWeight: forecastPanel.units === 'metric' ? 700 : 400
                        }}
                        onClick={() => forecastPanel.setUnits?.(forecastPanel.units === 'metric' ? 'us' : 'metric')}
                        title="Toggle metric units"
                      >
                        {forecastPanel.units === 'metric' ? 'Metric' : 'US'}
                      </button>
                    </div>

                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className="small" style={{ fontWeight: 700 }}>Days</span>
                      <button
                        className="button"
                        style={{ padding: '6px 10px', fontSize: 12, background: forecastPanel.forecastDays === 3 ? '#e5e7eb' : '#fff', fontWeight: forecastPanel.forecastDays === 3 ? 700 : 400 }}
                        onClick={() => forecastPanel.setForecastDays?.(3)}
                        title="Show 3-day forecast"
                      >
                        3
                      </button>
                      <button
                        className="button"
                        style={{ padding: '6px 10px', fontSize: 12, background: forecastPanel.forecastDays === 8 ? '#e5e7eb' : '#fff', fontWeight: forecastPanel.forecastDays === 8 ? 700 : 400 }}
                        onClick={() => forecastPanel.setForecastDays?.(8)}
                        title="Show 8-day forecast"
                      >
                        8
                      </button>
                    </div>

                  </div>

                  {countDatePassed && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                      {countDateWeatherSummary ? (
                        <div style={{ fontSize: 14 }}>{countDateWeatherSummary}</div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {isCbcCircleSelection && (
                <CountDayForm
                  enabled={countDayFormEnabled}
                  circleName={selectedCircleSummary?.circleName}
                  abbrev={selectedCircleSummary?.abbrev}
                  dateISO={countDateISO}
                  prefill={stationPrefill?.patch || null}
                  dataStatus={countDayDataStatus}
                />
              )}

              <hr style={{ border: 0, borderTop: '1px solid rgba(0,0,0,0.12)', marginTop: 14, marginBottom: 10 }} />
              <div className="small" style={{ opacity: 0.85, lineHeight: 1.35 }}>
                <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                  Weather data by Open-Meteo.com
                </a>
                {' • '}
                <a href="https://gis.audubon.org/christmasbirdcount/" target="_blank" rel="noreferrer">
                  CBC circles by National Audubon Society
                </a>
                {' • '}
                <span>Developed by [redacted], 2026</span>
              </div>
            </div>

            {isRainViewerActive && rainViewerTimestampLabel && (
              <div className="small" style={{ marginTop: 8, opacity: 0.85 }}>
                Radar time: {rainViewerTimestampLabel}
              </div>
            )}
          </div>
        )}

        <MapContainer
          key={mapKey}
          center={center}
          zoom={DEFAULT_ZOOM}
          zoomControl={false}
          zoomSnap={0.25}
          zoomDelta={0.25}
          wheelPxPerZoomLevel={240}
          style={{ height: '100%', width: '100%' }}
        >
          <ZoomControl position="bottomright" />
          <BaseLayerSync onBaseLayerName={setBaseLayerName} />
          <ZoomSync onZoomChange={setMapZoom} />
          {/* Default view stays at US center/zoom; auto-locate may select a nearby circle. */}

          <LayersControl position="topright" collapsed={false}>
            <LayersControl.BaseLayer checked name={OSM_LAYER_NAME}>
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name={ESRI_LAYER_NAME}>
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name={ESRI_TOPO_LAYER_NAME}>
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
                maxZoom={19}
              />
            </LayersControl.BaseLayer>

            <LayersControl.Overlay checked name="CBC circles">
              <LayerGroup>
                {cbcCenters?.items?.length > 0 && (
                  <>
                    {cbcCenters.items.map((c) => (
                      <Circle
                        key={`cbc-circle-${c.id}`}
                        center={[c.lat, c.lon]}
                        radius={c.radiusMeters}
                        pathOptions={{
                          ...circleStyle,
                          color: (activeCbcCenterId && String(c.id) === String(activeCbcCenterId)) ? '#f97316' : circleStyle.color,
                          weight: (activeCbcCenterId && String(c.id) === String(activeCbcCenterId)) ? 5 : circleStyle.weight
                        }}
                        interactive={false}
                      >
                        <Tooltip direction="top" opacity={0.9} sticky>
                          {c.tooltip}
                        </Tooltip>
                      </Circle>
                    ))}
                  </>
                )}

                {cbcCentersGeoJson && cbcCenters && (
                  <GeoJSON
                    data={cbcCentersGeoJson}
                    pointToLayer={(_, latlng) => {
                      return L.circleMarker(latlng, {
                        radius: 4,
                        color: '#ef4444',
                        weight: 2,
                        opacity: 1,
                        fillColor: '#ef4444',
                        fillOpacity: 0.9,
                        bubblingMouseEvents: false
                      });
                    }}
                    onEachFeature={(f, layer) => {
                      try {
                        const id = f?.properties?.__centerId;
                        const poly = id ? cbcCenters.featureById.get(String(id)) : null;
                        const props = poly?.properties || f?.properties || {};
                        layer.bindTooltip(formatCbcTooltip(props), { direction: 'top', opacity: 0.9, sticky: true });
                      } catch {
                        // ignore
                      }

                      layer.on('click', (e) => {
                        try {
                          if (e?.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                        } catch {
                          // ignore
                        }

                        const id = f?.properties?.__centerId;
                        const poly = id ? cbcCenters.featureById.get(String(id)) : null;
                        if (poly) selectCbcCircle(poly);
                      });
                    }}
                  />
                )}
              </LayerGroup>
            </LayersControl.Overlay>

            <LayersControl.Overlay name="Rainfall radar">
              {rainViewerRadarUrl ? (
                <TileLayer
                  ref={rainViewerLayerRef}
                  attribution='&copy; <a href="https://www.rainviewer.com" target="_blank" rel="noreferrer">RainViewer</a>'
                  url={rainViewerRadarUrl}
                  opacity={0.7}
                />
              ) : (
                <LayerGroup />
              )}
            </LayersControl.Overlay>
          </LayersControl>

          <OverlayActiveSync layerRef={rainViewerLayerRef} onActiveChange={setIsRainViewerActive} />

          <MapClickHandler
            onMapClick={(latlng, zoom) => {
              const isZoomedIn = Number.isFinite(zoom) && zoom >= CBC_ZOOM_POINT_THRESHOLD;
              if (isZoomedIn) {
                setCbcPoint({ lat: latlng.lat, lon: latlng.lng });
                onSelect({
                  lat: latlng.lat,
                  lon: latlng.lng,
                  label: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`,
                  source: 'cbc-point',
                  circle: null
                });
                return;
              }

              onSelect({
                lat: latlng.lat,
                lon: latlng.lng,
                label: `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`
              });
            }}
          />

          {selected && (
            <FlyTo
              lat={selected.lat}
              lon={selected.lon}
              zoom={selected.source === 'cbc-point' ? undefined : 10}
              bounds={selected.bounds}
              source={selected.source}
              circle={selected.circle || null}
              selectionId={selected.selectionId}
              fitPaddingTopLeft={[420, 20]}
              fitPaddingBottomRight={[20, 20]}
              zoomOutAfterFit={Boolean(selected.autoLocated) && Boolean(selected.bounds) && selected.source !== 'cbc-point'}
            />
          )}

          {selectedCircleCenter && selectedCircleSummary && (
            <Marker
              ref={selectedCircleMarkerRef}
              position={[selectedCircleCenter.lat, selectedCircleCenter.lon]}
              icon={redIcon}
              bubblingMouseEvents={false}
            >
              <Popup autoPan={false}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 700 }}>{selectedCircleSummary.circleName}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {selectedCircleSummary.abbrev ? `Abbrev: ${selectedCircleSummary.abbrev}` : ''}
                    {selectedCircleSummary.abbrev && selectedCircleSummary.countDate ? ' • ' : ''}
                    {selectedCircleSummary.countDate ? `Count date: ${selectedCircleSummary.countDate}` : ''}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    Center: {selectedCircleCenter.lat.toFixed(4)}, {selectedCircleCenter.lon.toFixed(4)}
                  </div>
                </div>
              </Popup>
            </Marker>
          )}

          {selectedCircleCenter && Array.isArray(stations15mi) && stations15mi.length > 0 && (
            <Pane name="stationsPane" style={{ zIndex: 650 }}>
              <LayerGroup>
                {stations15mi.map((st) => {
                  const isNearest = String(nearestStation?.icaoId || '') === String(st.icaoId || '');
                  return (
                    <CircleMarker
                      key={`st-${st.icaoId}-${st.lat}-${st.lon}`}
                      pane="stationsPane"
                      center={[st.lat, st.lon]}
                      radius={isNearest ? 7 : 5}
                      pathOptions={{
                        color: '#3b82f6',
                        weight: isNearest ? 3 : 2,
                        opacity: 1,
                        fillColor: '#3b82f6',
                        fillOpacity: 0.85,
                      }}
                      bubblingMouseEvents={false}
                    >
                      <Popup autoPan={false}>
                        <div style={{ minWidth: 220 }}>
                          <div style={{ fontWeight: 700 }}>{st.icaoId}</div>
                          {st.site ? <div style={{ fontSize: 12, opacity: 0.8 }}>{st.site}</div> : null}
                          <div style={{ marginTop: 6, fontSize: 12 }}>
                            {st.miles.toFixed(1)} mi from circle center
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {st.lat.toFixed(4)}, {st.lon.toFixed(4)}
                          </div>
                          {isNearest ? (
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              Nearest station used for observations
                            </div>
                          ) : null}
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
              </LayerGroup>
            </Pane>
          )}

          {cbcPoint && isFiniteNumber(cbcPoint.lat) && isFiniteNumber(cbcPoint.lon) && (
            <Marker
              position={[cbcPoint.lat, cbcPoint.lon]}
              icon={blueIcon}
              bubblingMouseEvents={false}
              eventHandlers={{
                click: () => {
                  onSelect({
                    lat: cbcPoint.lat,
                    lon: cbcPoint.lon,
                    label: `${cbcPoint.lat.toFixed(4)}, ${cbcPoint.lon.toFixed(4)}`,
                    source: 'cbc-point',
                    circle: null
                  });
                },
              }}
            >
              <Popup autoPan={false}>
                <div style={{ fontWeight: 700 }}>Weather point</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {cbcPoint.lat.toFixed(5)}, {cbcPoint.lon.toFixed(5)}
                </div>
              </Popup>
            </Marker>
          )}

          {selected && isFiniteNumber(selected.lat) && isFiniteNumber(selected.lon) && !['cbc-circle', 'cbc-point'].includes(String(selected.source || '')) && (
            <Marker position={[selected.lat, selected.lon]} bubblingMouseEvents={false}>
              <Popup>
                <div style={{ fontWeight: 700 }}>{selected?.label || 'Selected location'}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}
                </div>
              </Popup>
            </Marker>
          )}

          {candidates.map((c) => (
            <Marker
              key={`cand-${c.latitude}-${c.longitude}-${c.name}`}
              position={[c.latitude, c.longitude]}
              eventHandlers={{
                click: () => {
                  if (c?.source === 'cbc' && c?.circle) {
                    onSelect({
                      lat: c.latitude,
                      lon: c.longitude,
                      label: c.name,
                      source: 'cbc-circle',
                      circle: c.circle
                    });
                    return;
                  }
                  onSelect({ lat: c.latitude, lon: c.longitude, label: c.name });
                }
              }}
            >
              <Popup>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div>{c.admin1 ? `${c.admin1}, ` : ''}{c.country ? c.country : ''}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {Number(c.latitude).toFixed(4)}, {Number(c.longitude).toFixed(4)}
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Click marker to fetch forecast.
                </div>
              </Popup>
            </Marker>
          ))}

          {saved.map((s) => (
            <Marker
              key={`saved-${s.name}`}
              position={[s.lat, s.lon]}
              eventHandlers={{
                click: () => onSelect({ lat: s.lat, lon: s.lon, label: s.name })
              }}
            >
              <Popup>
                <div style={{ fontWeight: 700 }}>{s.name}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                </div>
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  Click marker to fetch forecast.
                </div>
              </Popup>
            </Marker>
          ))}

        </MapContainer>
      </div>
    </div>
  );
}
