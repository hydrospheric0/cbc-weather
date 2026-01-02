# CBC weather

Web dashboard (Leaflet + Open‑Meteo + Plotly) for selecting a location and viewing a 3‑day forecast.

- Hosted app: https://hydrospheric0.github.io/cbc-weather/

## Features
- Full-width top bar title: **CBC weather**
- Content area with ~20% left/right margins
- Left navigation panel: location search (place name or `lat,lon`) + date input
- Map panel: OpenStreetMap and Esri Satellite basemaps
- Shows Open‑Meteo geocoding results and saved locations as clickable markers
- Clicking a marker fetches a 3‑day Open‑Meteo forecast and renders a Plotly chart

## About the Christmas Bird Count Weather Tool
The Christmas Bird Count is the nation’s longest-running community science bird project. It occurs December 14 to January 5 every season in over 3000 count circles. More information can be found on the [Audubon website](https://www.audubon.org/community-science/christmas-bird-count).

This tool was developed to **help count circle compilers** plan their count by:
- Creating accurate and easy-to-share insights into the likely weather conditions during their count.
- Allow easy extraction of the observed conditions during the count for reporting purposes.

## How to use
By default the tool will request the user’s location. If permitted, the tool zooms in on the nearest count circle and populates the weather forecast.
If the count date was published on the [CBC circles by National Audubon Society](https://gis.audubon.org/christmasbirdcount/), the count date will be highlighted on the plot.

Once the count has passed, the weather information for that circle’s count date will be automatically populated. This is the information a compiler needs to provide when filling out the count results on the [Application Portal](https://netapp.audubon.org/aap/application/cbc?_gl=1*14vfzzw*_gcl_au*NDI1NjA4MDIuMTc2NjI5MTI2MA..*_ga*MTAwNTY5OTc2Ny4xNzY2MjkxMjU5*_ga_X2XNL2MWTT*czE3NjY1OTQ0MjEkbzIkZzAkdDE3NjY1OTQ0MjEkajYwJGwwJGgw).

## Run
From this folder:

- `npm install`
- `npm run dev`

Then open the URL Vite prints (typically `http://localhost:5173`).
