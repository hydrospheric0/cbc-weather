# CBC weather

Web dashboard (Leaflet + Open‑Meteo + Plotly) for selecting a location and viewing a 3‑day forecast.

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
