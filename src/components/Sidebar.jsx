import React, { useMemo } from 'react';
import { parseLatLon } from '../lib/geo.js';

function pick(props, keys) {
  for (const k of keys) {
    const v = props?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

export default function Sidebar({
  query,
  setQuery,
  candidates,
  onSearch,
  onSelectCandidate,
  circleInfo,
  error
}) {
  const parsed = useMemo(() => parseLatLon(query), [query]);
  const p = circleInfo?.properties || circleInfo || null;

  const circleName = pick(p, ['Name', 'CircleName', 'CIRCLE_NAME', 'Abbrev', 'ABBREV']) || '';
  const abbrev = pick(p, ['Abbrev', 'ABBREV']);
  const countDate = pick(p, ['Count_Date', 'COUNT_DATE', 'CountDate', 'Count Date', 'date_label', 'date']);
  const buffDist = pick(p, ['BUFF_DIST', 'BuffDist', 'BUFFDIST']);
  const lat = pick(p, ['Latitude', 'LATITUDE', 'Lat']);
  const lon = pick(p, ['Longitude', 'LONGITUDE', 'Lon', 'Lng']);
  const compiler = pick(p, ['compiler', 'Compiler']);
  const contactEmail = pick(p, ['contact_email', 'EmailAddress', 'email', 'Email']);
  const contactPhone = pick(p, ['contact_phone', 'phone', 'Phone']);

  return (
    <div className="card sidebar">
      <div className="cardHeader">Navigation</div>
      <div className="cardBody">
        <div className="small" style={{ fontWeight: 600 }}>Location search</div>
        <div className="small" style={{ marginTop: 2 }}>Name / place / lat,lon</div>
        <div className="row" style={{ marginTop: 6 }}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Vacaville CA or 38.3761, -121.9607"
          />
          <button className="button" onClick={onSearch}>Search</button>
        </div>
        {parsed && (
          <div className="small" style={{ marginTop: 6 }}>
            Parsed coordinates: {parsed.lat.toFixed(5)}, {parsed.lon.toFixed(5)}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div className="small">Search results</div>
          <ul className="list">
            {candidates.length === 0 ? (
              <li className="listItem small">No results yet.</li>
            ) : candidates.map((c) => (
              <li
                key={`${c.source || 'geocode'}:${c.id || ''}:${c.latitude},${c.longitude},${c.name}`}
                className="listItem"
                style={{ backgroundColor: c.source === 'cbc' ? 'rgba(255, 255, 0, 0.25)' : 'transparent' }}
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
        </div>

        <div style={{ marginTop: 12 }}>
          <div className="small" style={{ fontWeight: 600 }}>Information</div>
          {!p ? (
            <div className="small" style={{ marginTop: 6, opacity: 0.8 }}>
              No circle selected.
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 700 }}>{circleName || 'CBC Circle'}</div>
              <div className="small" style={{ opacity: 0.85, marginTop: 2 }}>
                {abbrev ? `Abbrev: ${abbrev}` : ''}
                {abbrev && countDate ? ' • ' : ''}
                {countDate ? `Count: ${countDate}` : ''}
              </div>
              {(compiler || contactEmail || contactPhone) && (
                <div className="small" style={{ opacity: 0.85, marginTop: 4 }}>
                  {compiler ? `Compiler: ${compiler}` : ''}
                  {compiler && (contactEmail || contactPhone) ? ' • ' : ''}
                  {contactEmail ? contactEmail : ''}
                  {(contactEmail && contactPhone) ? ' • ' : ''}
                  {contactPhone ? contactPhone : ''}
                </div>
              )}
              {(lat !== null || lon !== null || buffDist !== null) && (
                <div className="small" style={{ opacity: 0.85, marginTop: 4 }}>
                  {(lat !== null && lon !== null) ? `Center: ${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}` : ''}
                  {(lat !== null && lon !== null && buffDist !== null) ? ' • ' : ''}
                  {buffDist !== null ? `Radius: ${buffDist} mi` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
