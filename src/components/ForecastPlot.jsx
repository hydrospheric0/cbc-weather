import React, { useEffect, useMemo, useRef } from 'react';
import { dir16 } from '../lib/geo.js';

function toDate(x) {
  // Open-Meteo hourly.time is ISO-like (timezone already applied by API)
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

    // Labels: every 3h if <= 3 days, else every 12h
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
    if (highlightDateISO) {
      const d0 = new Date(`${highlightDateISO}T00:00:00`);
      const d1 = new Date(d0.getTime() + 24 * 60 * 60 * 1000);
      const start = axisStart;
      const end = axisEnd;

      const addDashedDayLine = (x) => {
        // Only draw on the top subplot (temp/precip), not the wind subplot.
        shapes.push({
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: x,
          x1: x,
          y0: 0.56,
          y1: 1.0,
          line: { color: 'rgba(0,0,0,0.55)', width: 2, dash: 'dash' }
        });
      };

      // Highlight selected day (count date) in light yellow.
      if (d0 < end && d1 > start) {
        shapes.push({
          type: 'rect',
          xref: 'x',
          yref: 'paper',
          x0: d0,
          x1: d1,
          y0: 0,
          y1: 1,
          line: { width: 0 },
          fillcolor: 'rgba(255, 255, 0, 0.25)'
        });

        // Day boundary markers (dashed) for the temp/precip subplot.
        addDashedDayLine(d0);
        addDashedDayLine(d1);
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
      // Wind direction labels
      ...labelIdx.map((i) => ({
        x: t[i],
        y: 0.41, // Top of wind subplot area (domain ends at 0.42)
        xref: 'x',
        yref: 'paper',
        text: `<b>${dir16(wdirFrom[i])}</b>`,
        showarrow: false,
        xanchor: 'center',
        yanchor: 'top',
        font: { size: 11, color: '#444' }
      }))
    ];

    return {
      data: [
        {
          x: t,
          y: temp,
          type: 'scatter',
          mode: 'lines',
          name: 'Temperature (°F)',
          line: { width: 2, color: 'red' },
          xaxis: 'x',
          yaxis: 'y'
        },
        {
          x: t,
          y: rain,
          type: 'bar',
          name: 'Rain (in)',
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
          name: 'Wind speed (mph)',
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
        margin: { l: 70, r: 70, t: 50, b: 110 },
        barmode: 'overlay',
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        legend: { orientation: 'h', xanchor: 'left', x: 0, yanchor: 'top', y: -0.22 },
        shapes,
        annotations: annotations,
        xaxis: {
          domain: [0, 1],
          anchor: 'y',
          range: [axisStart, axisEnd],
          showgrid: false,
          showline: true,
          mirror: true,
          ticks: 'outside'
        },
        yaxis: {
          title: 'Temperature (°F)',
          domain: [0.56, 1.0],
          showgrid: true,
          gridcolor: 'rgba(0,0,0,0.08)',
          showline: true,
          mirror: true
        },
        yaxis2: {
          title: 'Rain (in)',
          overlaying: 'y',
          side: 'right',
          domain: [0.56, 1.0],
          showgrid: false,
          showline: true,
          mirror: true
        },
        xaxis2: {
          domain: [0, 1],
          anchor: 'y3',
          range: [axisStart, axisEnd],
          showgrid: true,
          gridcolor: 'rgba(0,0,0,0.22)',
          griddash: 'dash',
          showline: true,
          mirror: true,
          ticks: 'outside'
        },
        yaxis3: {
          title: 'Wind speed (mph)',
          domain: [0.0, 0.42],
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
      const mod = await import('plotly.js-dist-min');
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

  return (
    <div className="plot" id={plotId} ref={divRef} />
  );
}
