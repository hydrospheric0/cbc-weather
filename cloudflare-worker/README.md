# Cloudflare Worker: AviationWeather CORS proxy

This is a minimal proxy for the AviationWeather.gov Data API to avoid CORS issues when hosting the frontend on GitHub Pages.

## What it allows
- `GET`/`HEAD`/`OPTIONS`
- Only paths under `/api/data/` (e.g. `/api/data/stationinfo`, `/api/data/metar`)

## CORS (tight)
This Worker only allows browser requests from:
- `https://hydrospheric0.github.io` (GitHub Pages for `hydrospheric0/cbc-weather`)
- `http://localhost:5173` and `http://127.0.0.1:5173` (local dev)

Other origins are rejected with `403`.

## Deploy
Prereqs:
- Cloudflare account
- `wrangler` installed (`npm i -g wrangler`)

From the repo root:

- `cd cloudflare-worker`
- `wrangler login`
- `wrangler deploy`

Wrangler prints a URL like:
- `https://cbc-weather-awc-proxy.<your-subdomain>.workers.dev`

Use that as `VITE_AWC_BASE_URL` for the frontend build.

## Set frontend base URL
For local dev, the app still uses the Vite `/awc` proxy on localhost.

For GitHub Pages, set a repository variable:
- Name: `VITE_AWC_BASE_URL`
- Value: your Worker URL (no trailing slash)

Example:
- `https://cbc-weather-awc-proxy.example.workers.dev`
