# CBC weather

Web dashboard (Leaflet + Open‑Meteo + Plotly) for selecting a location and viewing a 3‑day forecast.

- Hosted app: https://hydrospheric0.github.io/cbc-weather/
- Related: https://github.com/[redacted]/newsmapper

## Deploy (GitHub Pages)
This repo includes a GitHub Actions workflow that deploys the built `dist/` to GitHub Pages.

In GitHub repo settings, set:
- Settings → Pages → Build and deployment → **Source: GitHub Actions**

If Pages is instead set to deploy from the repo root, GitHub will serve the development `index.html` (which references `/src/main.jsx`) and you’ll see 404s like `GET https://hydrospheric0.github.io/src/main.jsx`.

## Features
- Full-width top bar title: **CBC weather**
- Content area with ~20% left/right margins
- Left navigation panel: location search (place name or `lat,lon`) + date input
- Map panel: OpenStreetMap and Esri Satellite basemaps
- Shows Open‑Meteo geocoding results and saved locations as clickable markers
- Clicking a marker fetches a 3‑day Open‑Meteo forecast and renders a Plotly chart

## Run
From this folder:

- `npm install`
- `npm run dev`

Then open the URL Vite prints (typically `http://localhost:5173`).
