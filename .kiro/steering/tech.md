# GlarePilot tech steering

- Static client-side app: Vite 5 + vanilla ES modules, Leaflet 1.9 map, SunCalc 1.9 sun position. No backend: every data source is free, keyless and CORS-enabled. Deployable to GitHub Pages.
- Pure logic lives in `src/lib/*.js` (no DOM). UI lives in `src/main.js` and `src/ui/*.js`.
- Data sources: OSRM demo server (route geometry + per-segment durations), Open-Meteo forecast API (hourly, multi-location, `timeformat=unixtime`), Open-Meteo geocoding (US places + IANA timezone), Photon reverse geocoding (labels only, optional).
- Time: all internal times are UTC epoch milliseconds. Departure wall-clock time is interpreted in the origin's IANA timezone. Display each point in its own local timezone.
- Angles: compass degrees, 0 = north, clockwise. Meteorological wind direction = direction the wind comes FROM.
- Tests: `node --test` for unit/integration (with fast-check property tests); `tests/e2e` uses puppeteer-core with system Chrome headless, an isolated temp profile, a loopback-only preview server, and network interception with recorded fixtures.
- Pin exact dependency versions. No secrets in the repo. No API keys required.
