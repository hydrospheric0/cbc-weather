const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export async function geocode(query, { count = 10 } = {}) {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', String(count));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocoding failed (${r.status})`);
  const data = await r.json();

  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((x) => ({
    id: `${x.id ?? ''}`,
    name: x.name,
    admin1: x.admin1,
    country: x.country,
    latitude: x.latitude,
    longitude: x.longitude,
    timezone: x.timezone,
  }));
}

export async function fetchForecast({ lat, lon, days = 3, units = 'us' }) {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('hourly', [
    'temperature_2m',
    'precipitation_probability',
    'cloud_cover',
    'rain',
    'wind_speed_10m',
    'wind_direction_10m'
  ].join(','));
  url.searchParams.set('daily', [
    'weathercode',
    'precipitation_sum',
    'rain_sum',
    'temperature_2m_max',
    'temperature_2m_min',
    'wind_speed_10m_max',
    'wind_direction_10m_dominant'
  ].join(','));

  const u = String(units || 'us').toLowerCase();
  if (u === 'metric') {
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('precipitation_unit', 'mm');
  } else {
    url.searchParams.set('temperature_unit', 'fahrenheit');
    url.searchParams.set('wind_speed_unit', 'mph');
    url.searchParams.set('precipitation_unit', 'inch');
  }
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', String(days));

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Forecast failed (${r.status})`);
  return await r.json();
}

export async function fetchForecast3Day({ lat, lon }) {
  return fetchForecast({ lat, lon, days: 3 });
}

export async function fetchTodayPrecipitationSum({ lat, lon }) {
  const data = await fetchForecast({ lat, lon, days: 1 });
  const date = data?.daily?.time?.[0] ?? null;
  const precipitationIn = data?.daily?.precipitation_sum?.[0];
  const rainIn = data?.daily?.rain_sum?.[0];
  return {
    date,
    precipitationIn: Number.isFinite(precipitationIn) ? precipitationIn : null,
    rainIn: Number.isFinite(rainIn) ? rainIn : null,
    raw: data
  };
}
