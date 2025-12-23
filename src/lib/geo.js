export function parseLatLon(input) {
  const s = (input || '').trim();
  if (!s) return null;

  // Accept: "lat, lon" or "lat lon"
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[ ,]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;

  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}

export function dir16(deg) {
  const labels = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const d = Number(deg);
  if (!Number.isFinite(d)) return '';
  const idx = (Math.round(((d % 360) / 22.5)) + 16) % 16;
  return labels[idx];
}
