import React, { useEffect, useMemo, useRef } from 'react';
import { dir16 } from '../lib/geo.js';

function weathercodeToOpenWeatherIcon(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return '01d';
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

function toDate(x) {
  return new Date(x);
}

export default function ForecastPlot({ forecast, highlightDateISO, extendXAxisTo, plotId }) {
  const divRef = useRef(null);
  const plotlyRef = useRef(null);

  const fig = useMemo(() => {
    if (!forecast?.hourly?.time) return null;

    const t = forecast.hourly.time.map(toDate);
    const temp = forecast.hourly.temperature_2m;
    const rain = forecast.hourly.rain;
    const wind = forecast.hourly.wind_speed_10m;
    const wdirFrom = forecast.hourly.wind_direction_10m;

    const angleTo = wdirFrom.map((d) => (Number(d) + 180) % 360);

    const wsClipped = wind.map((v) => Math.max(0, Math.min(20, Number(v))));

    const theta = angleTo.map((a) => (a * Math.PI) / 180);
    const dxMinutes = 22;
    const dyMph = 0.9;

    const xArrow = t.map((dt, i) => new Date(dt.getTime() + dxMinutes * 60_000 * Math.sin(theta[i] || 0)));
    const yArrow = wind.map((v, i) => Number(v) + dyMph * Math.cos(theta[i] || 0));

    const intensityScale = [
      [0.0, '#2c79a0'],
      [0.33, '#ffeb3b'],
      [0.66, '#ff5c3b'],
      [1.0, '#d62728']
    ];

    const durationDays = (t[t.length - 1] - t[0]) / (1000 * 3600 * 24);
    const intervalHours = durationDays <= 3.5 ? 3 : 12;
    const isLongDuration = durationDays > 3.5;

    const labelIdx = t
      .map((dt, i) => ({ dt, i }))
      .filter(({ dt, i }) => i !== 0 && dt.getMinutes() === 0 && (dt.getHours() % intervalHours === 0))
      .map(({ i }) => i);

    const labelTimes = labelIdx.map((i) => t[i]);
    const labelText = labelIdx.map((i) => dir16(wdirFrom[i]));

    const shapes = [];
    const axisStart = t[0];
    const axisEnd = (extendXAxisTo && extendXAxisTo > t[t.length - 1]) ? extendXAxisTo : t[t.length - 1];

    const resolveNoonForDay = (iso) => {
      const prefix = `${String(iso)}T00:00`;
      const hit = forecast?.hourly?.time?.find?.((s) => String(s).startsWith(prefix));
      const base = hit ? new Date(hit) : new Date(`${iso}T00:00:00`);
      if (Number.isNaN(base.getTime())) return null;
      return new Date(base.getTime() + 12 * 60 * 60 * 1000);
    };

    const firstMidnight = (() => {
      const d = new Date(axisStart);
      d.setHours(0, 0, 0, 0);
      if (d < axisStart) d.setDate(d.getDate() + 1);
      return d;
    })();

    for (let d = new Date(firstMidnight); d <= axisEnd; d.setDate(d.getDate() + 1)) {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: new Date(d),
        x1: new Date(d),
        y0: 0.5,
        y1: 1.0,
        line: { color: 'rgba(0,0,0,0.35)', width: 1, dash: 'dash' }
      });

      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: new Date(d),
        x1: new Date(d),
        y0: 0.0,
        y1: 0.5,
        line: { color: 'rgba(0,0,0,0.35)', width: 1, dash: 'dash' }
      });
    }
    if (highlightDateISO) {
      const d0 = new Date(`${highlightDateISO}T00:00:00`);
      const d1 = new Date(d0.getTime() + 24 * 60 * 60 * 1000);
      const start = axisStart;
      const end = axisEnd;

      if (d0 < end && d1 > start) {
        shapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: d0,
          x1: d1,
          y0: 0,
          y1: 1,
          layer: 'below',
          line: { width: 0 },
          fillcolor: 'rgba(255, 255, 0, 0.25)'
        });
      }
    }

    const tempUnit = (forecast?.hourly_units?.temperature_2m) || (forecast?.daily_units?.temperature_2m_max) || '°F';
    const rainUnit = (forecast?.daily_units?.rain_sum) || (forecast?.daily_units?.precipitation_sum) || (forecast?.hourly_units?.rain) || 'in';
    const windUnit = (forecast?.hourly_units?.wind_speed_10m) || (forecast?.daily_units?.wind_speed_10m_max) || 'mph';

    const ru = String(rainUnit).toLowerCase().trim();
    const precipUnitLabel = (ru === 'in' || ru === 'inch' || ru === 'inches' || ru === '"') ? 'in' : String(rainUnit);

    const wu = String(windUnit).toLowerCase().replace(/\s+/g, '');
    const windUnitLabel = (wu === 'mph' || wu === 'mi/h' || wu === 'miph') ? 'mph' : String(windUnit);

    const dailyTimes = forecast?.daily?.time;
    const dailyTmax = forecast?.daily?.temperature_2m_max;
    const dailyTmin = forecast?.daily?.temperature_2m_min;
    const dailyRain = forecast?.daily?.rain_sum;
    const dailyPrecip = forecast?.daily?.precipitation_sum;
    const dailyWindMax = forecast?.daily?.wind_speed_10m_max;
    const dailyWindDir = forecast?.daily?.wind_direction_10m_dominant;

    const dailyWeatherCode = forecast?.daily?.weathercode;
    const daySummaryAnnotations = [];
    const daySummaryImages = [];
    if (Array.isArray(dailyTimes) && dailyTimes.length > 0) {
      const tempUnitLabel = String(tempUnit || '').replace('°', '').trim();
      const maxDays = Math.min(8, dailyTimes.length);
      for (let i = 0; i < maxDays; i++) {
        const iso = dailyTimes[i];
        const x = resolveNoonForDay(iso);
        if (!x) continue;
        if (x < axisStart || x > axisEnd) continue;

        const tmax = Number(dailyTmax?.[i]);
        const tmin = Number(dailyTmin?.[i]);
        const rainTotal = Number.isFinite(Number(dailyRain?.[i])) ? Number(dailyRain?.[i]) : (Number.isFinite(Number(dailyPrecip?.[i])) ? Number(dailyPrecip?.[i]) : null);
        const windMax = Number(dailyWindMax?.[i]);
        const windDir = Number(dailyWindDir?.[i]);

        const code = dailyWeatherCode?.[i];
        const icon = weathercodeToOpenWeatherIcon(code);
        const iconUrl = `https://openweathermap.org/img/wn/${icon}@4x.png`;

        const tPart = (Number.isFinite(tmax) && Number.isFinite(tmin))
          ? `<b>${Math.round(tmin)} / ${Math.round(tmax)} ${tempUnitLabel}</b>`.trim()
          : '';

        const rPart = (rainTotal !== null && Number.isFinite(rainTotal))
          ? `${rainTotal.toFixed(2)} ${precipUnitLabel}`
          : '';

        const wPart = Number.isFinite(windMax) ? `${Math.round(windMax)} ${windUnitLabel}` : '';
        const dPart = Number.isFinite(windDir) ? dir16(windDir) : '';

        const lines = [tPart, rPart, wPart, dPart].filter((s) => String(s).trim() !== '');
        if (lines.length === 0) continue;

        daySummaryImages.push({
          source: iconUrl,
          xref: 'x',
          yref: 'paper',
          x,
          y: 1.25,
          xanchor: 'center',
          yanchor: 'bottom',
          sizex: 11 * 60 * 60 * 1000,
          sizey: 0.16,
          sizing: 'contain',
          opacity: 1.0,
          layer: 'above'
        });

        daySummaryAnnotations.push({
          x,
          y: 1.06,
          xref: 'x',
          yref: 'paper',
          text: lines.join('<br>'),
          showarrow: false,
          xanchor: 'center',
          yanchor: 'bottom',
          align: 'center',
          font: { size: 11, color: '#111827' }
        });
      }
    }

    const annotations = [
      {
        x: 0,
        y: 0.01,
        xref: 'paper',
        yref: 'paper',
        text: 'Source: Open-Meteo',
        showarrow: false,
        xanchor: 'left',
        yanchor: 'bottom',
        font: { size: 10, color: 'rgba(0,0,0,0.55)' }
      },
      ...daySummaryAnnotations
    ];

    return {
      data: [
        {
          x: t,
          y: temp,
          type: 'scatter',
          mode: 'lines',
          name: `Temp (${tempUnit})`,
          line: { width: 2, color: 'red' },
          xaxis: 'x',
          yaxis: 'y'
        },
        {
          x: t,
          y: rain,
          type: 'bar',
          name: `Precip (${precipUnitLabel})`,
          opacity: 0.6,
          marker: { color: '#3D6DB0' },
          xaxis: 'x',
          yaxis: 'y2'
        },
        {
          x: t,
          y: wind,
          type: 'scatter',
          mode: 'lines',
          name: `Speed (${windUnitLabel})`,
          line: { width: 2 },
          opacity: 0.85,
          xaxis: 'x2',
          yaxis: 'y3'
        },
        {
          x: xArrow,
          y: yArrow,
          type: 'scatter',
          mode: 'markers',
          showlegend: false,
          marker: {
            symbol: 'arrow',
            size: isLongDuration ? 10 : 16,
            angle: angleTo,
            color: wsClipped,
            cmin: 0,
            cmax: 20,
            colorscale: intensityScale,
            showscale: false,
            line: { width: 1, color: 'rgba(0,0,0,0.55)' }
          },
          xaxis: 'x2',
          yaxis: 'y3'
        }
      ],
      layout: {
        title: { text: '', x: 0.01, xanchor: 'left' },
        height: 520,
        margin: { l: 55, r: 55, t: 125, b: 55 },
        barmode: 'overlay',
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        legend: { orientation: 'h', xanchor: 'left', x: 0, yanchor: 'top', y: -0.12 },
        shapes,
        images: daySummaryImages,
        annotations: annotations,
        xaxis: {
          domain: [0, 1],
          anchor: 'y',
          range: [axisStart, axisEnd],
          showgrid: false,
          showline: true,
          mirror: true,
          ticks: '',
          showticklabels: false
        },
        yaxis: {
          title: `Temp (${tempUnit})`,
          domain: [0.52, 0.94],
          showgrid: true,
          gridcolor: 'rgba(0,0,0,0.08)',
          showline: true,
          mirror: true
        },
        yaxis2: {
          title: `Precip (${precipUnitLabel})`,
          overlaying: 'y',
          side: 'right',
          domain: [0.52, 0.94],
          showgrid: false,
          showline: true,
          mirror: true
        },
        xaxis2: {
          domain: [0, 1],
          anchor: 'y3',
          range: [axisStart, axisEnd],
          showgrid: false,
          showline: true,
          mirror: true,
          ticks: 'outside',
          tick0: firstMidnight,
          dtick: 24 * 60 * 60 * 1000,
          tickformat: '%a %m/%d',
          minor: {
            dtick: 12 * 60 * 60 * 1000,
            ticks: 'outside',
            ticklen: 3,
            tickcolor: 'rgba(0,0,0,0.45)'
          }
        },
        yaxis3: {
          title: `Speed (${windUnitLabel})`,
          domain: [0.0, 0.46],
          rangemode: 'tozero',
          showgrid: true,
          gridcolor: 'rgba(0,0,0,0.08)',
          showline: true,
          mirror: true
        }
      },
      config: { displayModeBar: false, responsive: true }
    };
  }, [forecast, highlightDateISO, extendXAxisTo]);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    let cancelled = false;

    const ensurePlotly = async () => {
      if (plotlyRef.current) return plotlyRef.current;
      const mod = await import('plotly.js-basic-dist-min');
      plotlyRef.current = mod.default;
      return plotlyRef.current;
    };

    const run = async () => {
      const Plotly = await ensurePlotly();
      if (cancelled) return;

      if (!fig) {
        Plotly.purge(el);
        return;
      }

      Plotly.react(el, fig.data, fig.layout, fig.config);
    };

    run();

    return () => {
      cancelled = true;
      const Plotly = plotlyRef.current;
      if (Plotly) Plotly.purge(el);
    };
  }, [fig]);

  useEffect(() => {
    const el = divRef.current;
    if (!el || !fig) return;

    let frame = 0;
    const scheduleResize = () => {
      const Plotly = plotlyRef.current;
      if (!Plotly || !el) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          Plotly.Plots.resize(el);
        } catch {}
      });
    };

    scheduleResize();

    let observer;
    if (window.ResizeObserver) {
      observer = new ResizeObserver(() => scheduleResize());
      observer.observe(el);
      if (el.parentElement) observer.observe(el.parentElement);
    }

    window.addEventListener('resize', scheduleResize, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleResize);
      if (observer) observer.disconnect();
    };
  }, [fig]);

  return (
    <div className="plot" id={plotId} ref={divRef} />
  );
}
