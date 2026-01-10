import fs from 'node:fs/promises';
import path from 'node:path';

const LAYER_URL = 'https://services1.arcgis.com/lDFzr3JyGEn5Eymu/arcgis/rest/services/CBC_126/FeatureServer/0';
const OUT_FILE = path.resolve('data/cbc_circles_merged.geojson');

const OVERRIDES_FILE = path.resolve('data/cbc_overrides.json');

const DROP_FIELDS = new Set([
  'FirstName',
  'LastName',
  'EmailAddress',
  'Phone',
  'PhoneNumber',
  'IsPrimary',
  'ParticipantEnrollmentStatus',
  'Circle_id',
  'Circle_id_1',
  'Circle_code',
  'Description',
  'Comments'
]);

function toMdy(iso) {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Unknown';
  const [yy, mm, dd] = s.split('-');
  return `${mm}/${dd}/${yy}`;
}

async function loadOverrides() {
  try {
    const raw = await fs.readFile(OVERRIDES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return {};
    throw e;
  }
}

function applyOverrides(attrs, overrides) {
  const abbrev = String(attrs?.Abbrev || '').trim();
  const ov = abbrev && overrides && overrides[abbrev] ? overrides[abbrev] : null;
  return ov ? { ...attrs, ...ov } : attrs;
}

function dropFields(attrs) {
  const out = {};
  for (const [k, v] of Object.entries(attrs || {})) {
    if (DROP_FIELDS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const overrides = await loadOverrides();

  const meta = await getJson(`${LAYER_URL}?f=pjson`);
  const pageSize = Math.min(Number(meta?.maxRecordCount) || 2000, 2000);

  const countJson = await getJson(`${LAYER_URL}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const total = Number(countJson?.count) || 0;

  const features = [];

  for (let offset = 0; offset < total; offset += pageSize) {
    const url = `${LAYER_URL}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=${pageSize}&resultOffset=${offset}&f=json`;
    const page = await getJson(url);

    for (const f of page?.features || []) {
      const attrs0 = applyOverrides(f?.attributes || {}, overrides);
      const attrs = dropFields(attrs0);

      const lat = Number(attrs?.Latitude);
      const lon = Number(attrs?.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const iso = attrs?.Cnt_dt ? String(attrs.Cnt_dt).trim() : null;

      const props = {
        ...attrs,
        date: iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
        date_label: iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? toMdy(iso) : 'Unknown'
      };

      features.push({
        type: 'Feature',
        properties: props,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      });
    }
  }

  const geojson = {
    type: 'FeatureCollection',
    name: 'cbc_circles',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(geojson));
  console.log(`Wrote ${features.length} features to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
