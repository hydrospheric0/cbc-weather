import React from 'react';

function fToC(f) {
  return (Number(f) - 32) * (5 / 9);
}

function formatWeekdayDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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

function weathercodeToOpenWeatherIcon(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return '01d';

  // Use daytime icons consistently.
  if (c === 0) return '01d';
  if (c === 1) return '02d';
  if (c === 2) return '03d';
  if (c === 3) return '04d';
  if (c === 45 || c === 48) return '50d';
  if ([51, 53, 55, 56, 57].includes(c)) return '09d';
  if ([61, 63, 65, 66, 67].includes(c)) return '10d';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return '13d';
  if ([80, 81, 82].includes(c)) return '09d';
  if ([95, 96, 99].includes(c)) return '11d';
  return '01d';
}

export default function SummaryTable({ forecast, highlightDateISO, daysToShow = 8 }) {
  const hasForecast = Boolean(forecast && forecast.daily);

  if (!hasForecast) return null;

  const daily = forecast?.daily;
  const time = daily?.time;
  const precipitation_sum = daily?.precipitation_sum;
  const temperature_2m_max = daily?.temperature_2m_max;
  const temperature_2m_min = daily?.temperature_2m_min;
  const weathercode = daily?.weathercode;

  const n = Math.max(1, Math.min(10, Number(daysToShow) || 10));
  const days = Array.isArray(time) ? time.slice(0, n) : [];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(72px, 1fr))`,
        gap: 8,
        alignItems: 'stretch',
        width: '100%',
        overflowX: 'auto',
      }}
    >
      {days.map((t, i) => {
        const tminF = temperature_2m_min?.[i];
        const tmaxF = temperature_2m_max?.[i];

        const tminC = Number.isFinite(tminF) ? fToC(tminF) : null;
        const tmaxC = Number.isFinite(tmaxF) ? fToC(tmaxF) : null;

        const code = weathercode?.[i];
        const desc = weathercodeToText(code);
        const icon = weathercodeToOpenWeatherIcon(code);
        const iconUrl = `https://openweathermap.org/img/wn/${icon}@2x.png`;

        const isHighlighted = highlightDateISO && t === highlightDateISO;
        const precipIn = precipitation_sum?.[i];

        return (
          <div
            key={t}
            title={`${formatWeekdayDate(t)}${desc ? ` • ${desc}` : ''}${Number.isFinite(precipIn) ? ` • Precip: ${precipIn.toFixed(2)}"` : ''}`}
            style={{
              display: 'grid',
              gridTemplateRows: 'auto auto auto auto',
              justifyItems: 'center',
              gap: 4,
              padding: '6px 6px',
              borderRadius: 10,
              border: isHighlighted ? '2px solid #f59e0b' : '1px solid rgba(0,0,0,0.06)',
              background: isHighlighted ? 'rgba(245, 158, 11, 0.10)' : 'transparent',
              minWidth: 72,
            }}
          >
            <div style={{ fontWeight: 700, lineHeight: 1 }}>{formatWeekdayDate(t).split(',')[0]}</div>
            <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1 }}>{formatWeekdayDate(t).split(',').slice(1).join(',').trim()}</div>
            <img
              src={iconUrl}
              alt={desc}
              crossOrigin="anonymous"
              width={24}
              height={24}
              style={{ display: 'block' }}
              loading="lazy"
            />
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{ fontWeight: 700 }}>{Number.isFinite(tmaxC) ? `${Math.round(tmaxC)}°` : ''}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{Number.isFinite(tminC) ? `${Math.round(tminC)}°` : ''}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
