# RouteCast architecture

Static single-page app (Vite 5, vanilla ES modules). There is no RouteCast server: every request
goes from the browser directly to a public service. State described here is the post-hackathon
v1.1 release served by GitHub Pages (checked against the code at 816df5c/d8a745e, 2026-10-24/25;
v1.1.1 only renamed the app). The contest build is preserved as `v1.0-hackachusetts`.

RouteCast was named GlarePilot until 2026-10-25, when the repository was renamed to
`Umass308XiaofanLiu/RouteCast` and the live demo moved to https://umass308xiaofanliu.github.io/RouteCast/
(the old `/glarepilot/` Pages path returns 404). The `glarepilot.*` storage keys keep the original name.

## Module map

Pure logic lives in `src/lib/` (no DOM; unit-tested in Node with injected `fetch`/samplers). DOM,
maps and canvases live in `src/main.js` and `src/ui/`.

| Module | Role |
| --- | --- |
| `lib/providers.js` | Network adapters: Open-Meteo geocoding + forecast, Valhalla route with OSRM fallback (no straight-line fallback). Injectable `fetch`. |
| `lib/planner.js` | `buildTripModel`: route → 1 km samples → ≤ 40 forecast checkpoints → one multi-location forecast. `toSnapshot` / `fromSnapshot`. Uses `traffic/` only when a provider key is supplied. |
| `lib/geo.js` | Bearings, polyline decode, resampling with routed time and smoothed heading; `snapFix` GPS-to-route matching with hysteresis (`GPS_MATCH_DEFAULTS`). |
| `lib/forecast.js` | Picks the forecast value valid at an arrival time (hourly semantics; `null` outside the window). |
| `lib/sun.js`, `lib/weather.js` | Sun position vs heading (glare, rear sun, light phase); driving implications (rain/snow/ice/fog/storm, crosswind/headwind). |
| `lib/trip.js` | `evaluateTrip(model, departureUtc, { breakPlan, vehicle, delay })`: per-sample rows, windows, totals; manual delay (`makeDelay`, `congestionAt`). |
| `lib/optimizer.js` | `optimizeDeparture`: re-evaluates −180 … +180 min in 30 min steps, exposure score. |
| `lib/advice.js` | Deterministic rules engine (`buildAdvice`); no LLM. |
| `lib/conditions.js` | Which projected condition applies at each sample (icons/colours). |
| `lib/scenarios.js`, `lib/presets.js` | Hand-set synthetic demo scenarios; demo trips / snapshot ids. |
| `lib/horizon.js`, `lib/demsampler.js` | Terrain line-of-sight math; AWS terrarium tile fetch/decode/cache (never throws; missing → `null`). |
| `lib/terraincheck.js`, `lib/terrainglare.js` | Approximate terrain check per glare window (≤ 6 points/window, ≤ 60 rays/plan) and the separate terrain-adjusted glare layer. Never mutate `ev`. |
| `lib/traffic/` | Experimental key-based routing adapters (TomTom, HERE + Flexible Polyline, Mapbox) behind `routeWithTraffic`. |
| `lib/traffic/overlays/` | Keyless overlays: NYC DOT speeds (`nycdot.js`), INDOT WZDx (`wzdx.js`), route proximity index (`routeindex.js`). |
| `lib/time.js`, `lib/units.js`, `lib/states.js` | Intl time-zone conversion (UTC epoch ms internally), unit formatting, state abbreviations. |
| `main.js` | App state, forms, modes, rendering of KPIs/cards/table, view switching, GPS, terrain check, overlays, experimental traffic UI. |
| `ui/mapview.js` | Leaflet 2D map, condition-coloured route, GPS accuracy circle. |
| `ui/condlayer.js`, `ui/palette.js` | Animated inline-SVG condition icons; shared colour system. |
| `ui/timeline.js`, `ui/compass.js`, `ui/combobox.js` | SVG timeline + scrubber, sun-vs-heading compass, ARIA place search. |
| `ui/chase3d.js` | Canvas 2D "3D chase" preview of the planned route (no WebGL). |
| `ui/terrain3d.js`, `ui/terrainfx.js` | MapLibre GL "3D terrain" view (lazy-loaded chunk) with OpenFreeMap 3D buildings; 2D canvas overlay for rain/snow/fog/night/low-sun/wind effects. |

## Data flow

```
place search ─► geocode (Open-Meteo)            [real mode only]
route ────────► Valhalla ─fallback─► OSRM        [or experimental provider route with user key]
samples ──────► resampleRoute: every 1 km, routed driveSec, smoothed heading
checkpoints ──► ≤ 40 points ─► ONE Open-Meteo multi-location hourly request
                (snapshot: from public/fixtures/*.json; synthetic: hand-set series)
evaluateTrip ─► per sample t = departure + driveSec (+ breaks) (+ manual delay)
                sun.js → glare / rear sun / phase; forecast.js at t → weather.js hazards
                → rows, windows, totals
optimizer ────► evaluateTrip for shifted departures (no extra network) → exposure scores
advice ───────► buildAdvice → prioritized when/where/why/actions
views ────────► KPIs · Leaflet 2D · Canvas 3D chase · MapLibre 3D terrain · timeline · compass · table
optional ─────► terrain check (click or opt-in auto) → checkGlareWindows → terrainAdjustedGlare (separate)
                overlays (click, real mode) → fetchOverlays → evaluateOverlays → markers/lines
                GPS (click) → snapFix → shared selected sample
```

The three views share one selected sample/time (timeline scrubber, Play, map clicks, GPS). The
terrain-adjusted glare is stored separately (`state.terrainCheck.adj`) and never changes `r.glare`,
`r.expected`, KPI values, advice severity, the exposure score or the optimizer.

## Modes

The model's `source.kind` decides the mode:

| `source.kind` | Opened by | Data |
| --- | --- | --- |
| `live` (UI: "Real-data planning") | "See my drive", `?preset=` | Live route + forecast retrieved now, evaluated at projected arrival times. |
| `snapshot` | `?snapshot=`, "Open a recorded snapshot" | `public/fixtures/<id>.json` (recorded real route + forecast with `capturedAt`). |
| `synthetic` | `?demo=<scenario>`, "Manual demo scenarios" | Recorded real Valhalla route + deliberately hand-set weather/delay (`lib/scenarios.js`). |

`?view=3d` / `?view=terrain` select the starting view; `?experimental=traffic` reveals the
provider-key UI.

## Network inventory

Hosts are taken from the source (`grep` of `https://` URLs, 2026-10-24). Mode-level behaviour for
synthetic and snapshot was verified by the batch reviewer and by E2E (`modes.test.mjs`,
`overlays.test.mjs`: zero API/overlay calls in those modes).

| When | Hosts |
| --- | --- |
| Every mode, 2D map / 3D terrain basemap | `tile.openstreetmap.org` |
| Snapshot mode | `fixtures/*.json` from the app's own origin, plus map tiles |
| 3D terrain view opened (any mode) | `s3.amazonaws.com/elevation-tiles-prod/terrarium/…` (DEM), `tiles.openfreemap.org` (3D buildings) |
| Terrain check (button, or opt-in auto; any mode) | `s3.amazonaws.com/elevation-tiles-prod/terrarium/…` |
| Real mode: place search typing / form submit | `geocoding-api.open-meteo.com` |
| Real mode: plan | `valhalla1.openstreetmap.de` (fallback `router.project-osrm.org`), `api.open-meteo.com` |
| Real mode: "Check live traffic overlays" click | `data.cityofnewyork.us` (only if the route enters NYC and departure ≤ 60 min from now), `in.carsprogram.org` (only if the route bbox meets Indiana) |
| Real mode, `?experimental=traffic` and a user key | exactly one of `api.tomtom.com`, `router.hereapi.com`, `api.mapbox.com` |

GPS uses the browser Geolocation API; coordinates are not sent in any request. `511ny.org` appears
only in a code comment (probed, not usable).

## Storage

Only `localStorage`, written only by explicit user action (checked in `src/main.js`):

| Key | Written when | Content |
| --- | --- | --- |
| `glarepilot.terrainAuto` | "Check terrain automatically" ticked (removed when unticked) | `"1"` |
| `glarepilot.traffic.v1` | Experimental traffic UI: "Remember on this device" ticked with a key (removed on untick / "Clear key") | `{ provider, key }` |
| `glarepilot.experimental.traffic` | Never written by the app; read only (manual opt-in) | `"1"` |

No cookies, no sessionStorage, no IndexedDB in `src/`. GPS fixes stay in memory (latest fix only
for the accuracy circle; sample indices/counters for hysteresis).

## Privacy and security notes

- No backend, accounts, analytics or telemetry code in `src/`.
- Provider keys are sent only to the chosen provider and are redacted from errors/provenance
  (`lib/traffic/common.js`; unit-tested). A key kept in `localStorage` is readable by any script on
  the same origin; use a domain-restricted key.
- External feed text (NYC DOT link names, WZDx road/description) is HTML-escaped before it reaches
  card HTML and Leaflet tooltips (commit 816df5c; XSS regression E2E in `overlays.test.mjs`).
- Requests to public services reveal the queried places/route to those services, as in any web map.
