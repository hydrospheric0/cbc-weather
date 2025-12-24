import React, { useEffect, useMemo, useState } from 'react';

function safeKeyPart(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 200);
}

function makeKey({ circleName, abbrev, dateISO }) {
  const name = safeKeyPart(circleName);
  const ab = safeKeyPart(abbrev);
  const d = safeKeyPart(dateISO);
  return `countday|${name}|${ab}|${d}`;
}

function loadAll() {
  try {
    const raw = localStorage.getItem('cbcweather.countDayConditions');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAll(obj) {
  localStorage.setItem('cbcweather.countDayConditions', JSON.stringify(obj));
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function downloadTextFile({ filename, text, mime }) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WIND_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'Variable', 'Calm', 'Unknown'];
// Required categories (plus Unknown as a safe default).
const CLOUD_COVER = ['Clear', 'Cloudy', 'Foggy', 'Local Fog', 'Partly Clear', 'Partly Cloudy', 'Unknown'];
const INTENSITY = ['None', 'Light', 'Heavy', 'Unknown'];
const WATER = ['None', 'Some', 'Many', 'Unknown'];

function normalizeCloudValue(v) {
  const s = String(v || '').trim();
  if (!s) return 'Unknown';
  const u = s.toLowerCase();
  if (u === 'unknown') return 'Unknown';
  if (u === 'clear' || u === 'cavok') return 'Clear';
  if (u === 'fog' || u === 'foggy') return 'Foggy';
  if (u === 'local fog' || u === 'bcfg') return 'Local Fog';
  if (u === 'mostly clear') return 'Partly Clear';
  if (u === 'partly cloudy') return 'Partly Cloudy';
  if (u === 'mostly cloudy' || u === 'overcast') return 'Cloudy';
  if (u === 'cloudy') return 'Cloudy';
  if (u === 'partly clear') return 'Partly Clear';
  if (u === 'partly cloudy') return 'Partly Cloudy';
  return CLOUD_COVER.includes(s) ? s : 'Unknown';
}

function mergePrefillIntoForm(current, prefill) {
  const next = { ...current };
  Object.entries(prefill || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const cur = next[k];
    const canFill = cur === '' || cur === null || cur === undefined || cur === 'Unknown';
    if (!canFill) return;
    next[k] = v;
  });
  // Always normalize to current cloud categories.
  next.cloudCoverAM = normalizeCloudValue(next.cloudCoverAM);
  next.cloudCoverPM = normalizeCloudValue(next.cloudCoverPM);
  return next;
}

function RadioRow({ label, name, value, options, onChange }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="small" style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
        {options.map((opt) => (
          <label key={opt} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="radio"
              name={name || label}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
            />
            <span className="small">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="small" style={{ fontWeight: 600 }}>{label}</div>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ padding: '6px 8px', fontSize: 12 }}
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="small" style={{ fontWeight: 600 }}>{label}</div>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ padding: '6px 8px', fontSize: 12 }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

export default function CountDayForm({ circleName, abbrev, dateISO, enabled, prefill }) {
  const storageKey = useMemo(() => makeKey({ circleName, abbrev, dateISO }), [circleName, abbrev, dateISO]);

  const [all, setAll] = useState(() => loadAll());
  const existing = all?.[storageKey] || null;

  const [form, setForm] = useState(() => ({
    weather: '',
    tempMinF: '',
    tempMaxF: '',
    windDir: 'Unknown',
    windMinMph: '',
    windMaxMph: '',
    snowMinIn: '',
    snowMaxIn: '',
    stillWater: 'Unknown',
    movingWater: 'Unknown',
    cloudCoverAM: 'Unknown',
    cloudCoverPM: 'Unknown',
    amRain: 'Unknown',
    amSnow: 'Unknown',
    pmRain: 'Unknown',
    pmSnow: 'Unknown',
  }));

  useEffect(() => {
    // Reload from storage when switching circles/dates.
    const nextAll = loadAll();
    setAll(nextAll);
    const saved = nextAll?.[storageKey] || null;
    if (saved?.form && typeof saved.form === 'object') {
      setForm((prev) => {
        const merged = { ...prev, ...saved.form };
        merged.cloudCoverAM = normalizeCloudValue(merged.cloudCoverAM);
        merged.cloudCoverPM = normalizeCloudValue(merged.cloudCoverPM);
        return merged;
      });
    } else {
      setForm({
        weather: '',
        tempMinF: '',
        tempMaxF: '',
        windDir: 'Unknown',
        windMinMph: '',
        windMaxMph: '',
        snowMinIn: '',
        snowMaxIn: '',
        stillWater: 'Unknown',
        movingWater: 'Unknown',
        cloudCoverAM: 'Unknown',
        cloudCoverPM: 'Unknown',
        amRain: 'Unknown',
        amSnow: 'Unknown',
        pmRain: 'Unknown',
        pmSnow: 'Unknown',
      });
    }
  }, [storageKey]);

  const lastPrefillRef = React.useRef('');
  useEffect(() => {
    if (!enabled) return;
    if (!prefill || typeof prefill !== 'object') return;
    const key = JSON.stringify(prefill);
    if (!key || key === lastPrefillRef.current) return;
    lastPrefillRef.current = key;
    setForm((cur) => mergePrefillIntoForm(cur, prefill));
  }, [enabled, prefill]);

  if (!enabled) return null;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onSave = () => {
    const nextAll = loadAll();
    const record = {
      circleName: String(circleName || ''),
      abbrev: String(abbrev || ''),
      dateISO: String(dateISO || ''),
      savedAtISO: new Date().toISOString(),
      form,
    };
    nextAll[storageKey] = record;
    saveAll(nextAll);
    setAll(nextAll);

    // Export a one-row CSV for easy sharing/archiving.
    const row = {
      circleName: record.circleName,
      abbrev: record.abbrev,
      dateISO: record.dateISO,
      savedAtISO: record.savedAtISO,
      tempMinF: form.tempMinF,
      tempMaxF: form.tempMaxF,
      windDir: form.windDir,
      windMinMph: form.windMinMph,
      windMaxMph: form.windMaxMph,
      snowMinIn: form.snowMinIn,
      snowMaxIn: form.snowMaxIn,
      stillWater: form.stillWater,
      movingWater: form.movingWater,
      cloudCoverAM: form.cloudCoverAM,
      cloudCoverPM: form.cloudCoverPM,
      amRain: form.amRain,
      amSnow: form.amSnow,
      pmRain: form.pmRain,
      pmSnow: form.pmSnow,
    };

    const headers = Object.keys(row);
    const csv = [
      headers.map(csvEscape).join(','),
      headers.map((h) => csvEscape(row[h])).join(','),
      ''
    ].join('\n');

    const safeBase = `${record.circleName || 'cbc'}_${record.abbrev || ''}_${record.dateISO || ''}`
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\-]+/gi, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);

    downloadTextFile({
      filename: `${safeBase || 'countday'}_weather_report.csv`,
      text: csv,
      mime: 'text/csv;charset=utf-8'
    });
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: 'rgba(61,109,176,0.14)',
          border: '1px solid rgba(61,109,176,0.25)',
          borderRadius: 10,
          padding: '8px 10px'
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.2, color: '#111827' }}>Weather report</div>
        <button className="button" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onSave}>Save</button>
      </div>

      <div style={{ paddingLeft: 22, paddingRight: 22 }}>
        {existing?.savedAtISO && (
          <div className="small" style={{ opacity: 0.75, marginTop: 4 }}>
            Saved: {new Date(existing.savedAtISO).toLocaleString()}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Temperature (°F)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <NumberField label="Minimum" value={form.tempMinF} onChange={(v) => set({ tempMinF: v })} placeholder="min" />
            <NumberField label="Maximum" value={form.tempMaxF} onChange={(v) => set({ tempMaxF: v })} placeholder="max" />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Wind</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <SelectField label="Direction" value={form.windDir} options={WIND_DIRS} onChange={(v) => set({ windDir: v })} />
            <div />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <NumberField label="Min (mph)" value={form.windMinMph} onChange={(v) => set({ windMinMph: v })} placeholder="min" />
            <NumberField label="Max (mph)" value={form.windMaxMph} onChange={(v) => set({ windMaxMph: v })} placeholder="max" />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Snow Depth (in)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <NumberField label="Minimum" value={form.snowMinIn} onChange={(v) => set({ snowMinIn: v })} placeholder="min" />
            <NumberField label="Maximum" value={form.snowMaxIn} onChange={(v) => set({ snowMaxIn: v })} placeholder="max" />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Water</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <SelectField label="Still Water" value={form.stillWater} options={WATER} onChange={(v) => set({ stillWater: v })} />
            <SelectField label="Moving Water" value={form.movingWater} options={WATER} onChange={(v) => set({ movingWater: v })} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700 }}>Cloud Cover</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            <SelectField label="AM" value={form.cloudCoverAM} options={CLOUD_COVER} onChange={(v) => set({ cloudCoverAM: v })} />
            <SelectField label="PM" value={form.cloudCoverPM} options={CLOUD_COVER} onChange={(v) => set({ cloudCoverPM: v })} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Rain</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <RadioRow name="amRain" label="AM" value={form.amRain} options={INTENSITY} onChange={(v) => set({ amRain: v })} />
            <RadioRow name="pmRain" label="PM" value={form.pmRain} options={INTENSITY} onChange={(v) => set({ pmRain: v })} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Snow</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <RadioRow name="amSnow" label="AM" value={form.amSnow} options={INTENSITY} onChange={(v) => set({ amSnow: v })} />
            <RadioRow name="pmSnow" label="PM" value={form.pmSnow} options={INTENSITY} onChange={(v) => set({ pmSnow: v })} />
          </div>
        </div>
      </div>
    </div>
  );
}
