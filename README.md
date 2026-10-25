# GlarePilot

Forecast weather and sun glare for the places **and the times** you will actually be on a long US drive.

**Live demo:** https://umass308xiaofanliu.github.io/glarepilot/ — free, no login, no API key.

| Quick link | What it opens |
|---|---|
| [`?preset=chicago-sunset`](https://umass308xiaofanliu.github.io/glarepilot/?preset=chicago-sunset) | Amherst, MA → Chicago, IL tomorrow 8:00 AM EDT, **live** route + forecast |
| [`?snapshot=chicago-sunset`](https://umass308xiaofanliu.github.io/glarepilot/?snapshot=chicago-sunset) | Same trip from a **recorded snapshot** (works if public APIs are down) |
| [`?demo=congestion-shift`](https://umass308xiaofanliu.github.io/glarepilot/?demo=congestion-shift) | **Manual demo scenario** (synthetic): an assumed 75 min mid-route delay pushes the New York arrival into hand-set rain and darkness |
| [`?demo=sunset-glare&view=3d`](https://umass308xiaofanliu.github.io/glarepilot/?demo=sunset-glare&view=3d) | **Manual demo scenario** (synthetic, clear skies) opened in the **3D chase preview** |

**Demo video:** public YouTube link — TODO (human uploads). Narrated + captioned 2:50 recording of the live site: [GitHub release v1.0-hackachusetts](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts) (MP4 + SRT; synthetic TTS narration). Transcript: [docs/media/TRANSCRIPT.md](docs/media/TRANSCRIPT.md).

[![GlarePilot demo video poster](docs/media/glarepilot-demo-poster.png)](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts)

Hackachusetts 2026 entry. Built with Kiro CLI — see [docs/SUBMISSION.md](docs/SUBMISSION.md).

![Desktop: Amherst to Chicago with KPIs, glare-colored route map and hour-by-hour timeline](docs/screenshots/desktop-chicago-sunset.png)

| Mobile: Albany → Boston sunrise | Desktop full page: Albany → Boston sunrise |
|---|---|
| <img src="docs/screenshots/mobile-boston-sunrise.png" width="260" alt="Mobile layout of the Albany to Boston sunrise trip"> | <img src="docs/screenshots/desktop-boston-sunrise-full.png" width="520" alt="Full desktop page of the Albany to Boston sunrise trip"> |

Screenshots were captured from the live site with live data on 2026-10-24 (for departures on 2026-10-25). Live numbers change with each forecast run. Screenshots of the newer modes (manual demo scenarios, delay card, condition icons) are in [docs/qa/](docs/qa/), e.g. [docs/qa/e2e-demo-congestion.png](docs/qa/e2e-demo-congestion.png).

## The problem

Route apps show the weather *now* along the line, and weather apps show a city. Neither tells you whether, on a 14-hour westbound drive, you will reach Ohio just as the sun drops low straight ahead, or whether rain will be at the state line at the hour you get there. Low sun in the driver's eyes is a common, predictable hazard: it depends only on where you are, when, and which way the road points.

## What it does

1. Search a US origin and destination (or pick a demo trip) and enter the departure as wall-clock time **in the origin's time zone**.
2. Route with per-segment routed travel time (Valhalla, OSRM fallback). Optional break plan: none, 15 min every 2 h, or 30 min every 3 h.
3. Resample the route every 1 km with a smoothed heading and compute the arrival time at each sample.
4. Fetch one multi-location hourly forecast for up to 40 checkpoints and pick the value valid **at each sample's arrival time**.
5. Compute sun altitude/azimuth at each sample and time and compare it to the heading: forward glare, low sun behind you, twilight and night.
6. Derive driving implications: rain, heavy rain, snow, ice/freezing precipitation, fog/low visibility, thunderstorms, crosswind and headwind from gusts, cold, darkness and fatigue.
7. Re-evaluate the same route for departures from −3 h to +3 h and suggest a better departure when the difference is meaningful.
8. Show a prioritized briefing where every item says **when, where, why** (the triggering values) and what to do.

UI: KPI strip (drive, arrival, glare, after dark, wet/snowy, temperature), Leaflet map with **Sun glare / Weather / Daylight** layers and legend, SVG hour-by-hour timeline with a scrubber, sun-vs-heading compass, moment card for the selected point, "When should I leave?" optimizer bars, checkpoint table, °F·mi / °C·km toggle, vehicle type (car/SUV, van/truck/RV, motorcycle), loading/error/empty states, and a mobile layout.

## Two data modes

A switch at the top of the side panel selects one of two clearly labeled modes.

**Real-data planning (real forecast planning).** A live Valhalla route (OSRM fallback) and an Open-Meteo forecast are retrieved now, and each route point is evaluated at its **projected future arrival time** = departure + routed drive time + optional breaks + optional assumed delay. The provenance strip shows the retrieval time and the projected departure/arrival. This is **not a current-conditions dashboard**. Recorded real-data snapshots (`?snapshot=chicago-sunset|boston-sunrise|nyc-evening`) are kept distinct: they are labeled "Recorded real data — not current" with their retrieval time.

**Manual demo scenarios.** `?demo=storm-crosswind|sunset-glare|snow-fog-night|congestion-shift` (or the "Manual demo scenarios" button). Weather and delay values are **deliberately hand-set synthetic values** (`src/lib/scenarios.js`) laid over a recorded real Valhalla route, so the features can be shown reproducibly. No weather, routing or traffic API is called; only OpenStreetMap map tiles load. Every scenario is labeled "Manual demo scenario — synthetic data".

| Scenario | Route (recorded) | Departure | Hand-set conditions |
|---|---|---|---|
| `storm-crosswind` | Amherst → New York | 1:00 PM | Heavy rain over the middle of the drive, westerly gusts up to 85 km/h; vehicle van/truck |
| `sunset-glare` | Amherst → Chicago | 8:00 AM | Clear skies everywhere, so low sun ahead near Lake Erie is not softened |
| `snow-fog-night` | Albany → Boston | 7:30 PM | Snow over the Berkshires, freezing fog near Worcester, after dark |
| `congestion-shift` | Amherst → New York | 3:30 PM | Dry until 6:15 PM, then rain and gusts at the New York end; assumed +75 min mid-route delay |

## What is forecast vs computed vs estimated vs assumed

- **Forecast:** Open-Meteo model weather for the hour each point is reached (synthetic hand-set values in manual demo scenarios).
- **Computed:** SunCalc sun position and glare for each point's future arrival time and heading.
- **Estimated:** arrival times from free-flow routing (Valhalla / OSRM).
- **Assumed:** the traffic delay you choose (or the scenario's hand-set delay).
- **Observed / live:** none. GlarePilot shows no current conditions and does not track your location.

The same breakdown is in the "What is forecast, computed, estimated or assumed?" disclosure under the provenance strip.

## Traffic delay assumptions

No live or predictive traffic provider is connected. The free public Valhalla and OSRM servers return free-flow times; a Valhalla request with a `date_time` returned the same 10,475 s for Amherst → New York as without it. Traffic-aware APIs (TomTom, HERE, Google) need API keys, which were not available.

Instead, the "Traffic delay assumption" control lets you add +15 min … +2 h of extra time **spread linearly** over a chosen stretch: whole trip, first quarter, mid-route (37.5–62.5 % of the distance) or last quarter (`makeDelay` / `congestionAt` in `src/lib/trip.js`). Points before the stretch are unaffected, points inside it are partially delayed, and every later point is delayed in full; its arrival time, forecast hour, sun position and glare are recomputed. The "What the assumed delay changes" card compares arrival, wet roads, strong glare, after dark, crosswind and snow/ice minutes with and without the delay. The forecast is fetched for departure −3.5 h … arrival +5.5 h (`src/lib/planner.js`), so delays up to 2 h need no refetch.

## Keyless live overlays (NYC DOT speeds, INDOT work zones)

Real-data plans only — never in synthetic demo (`?demo=`) or recorded-snapshot mode — and only on demand: after planning, **Check live traffic overlays** appears when a source is relevant (`src/lib/traffic/overlays/`). A normal plan makes no overlay requests.

- **NYC DOT real-time speeds** (NYC Open Data `i4gi-tjb9`, keyless, CORS `*`): offered only when the departure is within 60 min of now and the route enters NYC; used only when the newest `data_as_of` is at most 20 min old (otherwise a muted "NYC DOT speeds are as of HH:MM, too old to use"). Slow links on the route (within 150 m; speed < 50 % of an assumed free-flow reference of 50 mph highway / 30 mph other, or < 15 mph on highways) are drawn in red and listed as "NYC DOT speeds as of HH:MM (current, not a forecast)". Arrival times are never changed automatically: **Add as delay assumption** copies a rounded-up suggestion into the manual delay control.
- **INDOT WZDx work zones** (`in.carsprogram.org`, keyless, CORS `*`): zones within 150 m of the route (two vertices for lines, to skip crossing roads) and active at the projected arrival there become "WZ" map markers and the advice line "Work zone reported by INDOT (as of feed time HH:MM)". They never change timing.
- Fetches have a 12 s timeout, abort when a new trip starts, and failures become a small muted note; planning is unaffected.

## Optional traffic-aware routing (your own API key) — experimental

Hidden unless the URL has `?experimental=traffic` (or `localStorage["glarepilot.experimental.traffic"] = "1"`); when shown it is labelled "Experimental — not verified against real provider responses", and without the flag no provider is ever called. Off by default; without a key the app behaves exactly as above. In Real-data mode, open **Traffic-aware routing (needs your own API key)** under the trip form, choose TomTom, HERE or Mapbox and paste your own key. The key is kept in memory only unless you tick **Remember on this device** (then `localStorage["glarepilot.traffic.v1"]`); **Clear key** removes it from the page and the device. It is sent only to the chosen provider, directly from the browser (this is a static site — there is no GlarePilot server), and is never logged or shown in messages. Because the key is in the browser, use a key restricted to your own domain/localhost where the provider supports that.

- Adapters (`src/lib/traffic/`): `routeWithTraffic(origin, dest, { provider, departureUtc, apiKey, fetchImpl, signal })` returns the normal route shape plus `traffic: { provider, mode, departureUtc, retrievedAt, freeFlowSec, trafficDelaySec, timing, note }`.
  - **TomTom** Calculate Route: `traffic=true`, `departAt`, `sectionType=traffic`, `computeTravelTimeFor=all`, `instructionsType=coded`. Per-instruction cumulative times (else traffic-section delays) become per-point times; free-flow = `noTrafficTravelTimeInSeconds`, delay = `trafficDelayInSeconds`.
  - **HERE** Routing v8: `departureTime`, `return=polyline,summary,travelSummary`, `spans=duration,length`; includes a Flexible Polyline decoder tested against the official example. Delay = `duration − baseDuration`.
  - **Mapbox** Directions `driving-traffic`: `annotations=duration,distance` (per-segment); `depart_at` only for future departures (never in the past; capped at the app's 14-day horizon — the docs page did not state an explicit window). With `depart_at` Mapbox's duration is a historical prediction and it reports no free-flow time, so no delay figure is invented.
  - A provider that returns only a total is labelled **scaled total, not per-segment**.
- Semantics: departures more than 30 min ahead are labelled **predictive (provider historical/typical traffic for that departure time)**; near-now departures **live traffic**. The provenance strip shows provider · mode, retrieval time, with-traffic vs free-flow time and the traffic delay. Your manual delay assumption remains a separate, labelled user assumption added on top; it is never called traffic.
- The resulting per-point times feed arrival times, forecast hours, sun position/glare and the optimizer. The optimizer makes **one traffic request per plan**: other departure bars reuse this plan's traffic timing (labelled under the chart).
- Failures (401 invalid key, 403 not enabled/restricted, 429 rate/quota, timeouts) show a visible warning and fall back to free-flow Valhalla/OSRM routing.
- Cost/quota: all three require an account and key; each currently advertises a free usage tier, but quotas, prices and terms change — check the provider's pricing page before use. Tests use mocked responses built from the documented formats; **no real provider call has been made**, so live response details remain unverified.

## Route condition icons

- Original inline SVG icons written for this project (`src/ui/condlayer.js`); no third-party icon assets.
- Categories: strong low sun ahead, sun aligned but clouds forecast, snow/ice, rain, fog/low visibility, strong crosswind gusts, assumed traffic delay, dark.
- Icons are placed only at route samples where that condition is projected at the arrival time (`src/lib/conditions.js`), then thinned in screen space for the current zoom so they do not overlap.
- The delay icon appears only when a delay is set and is labeled as a scenario or assumed delay.
- Animations are CSS transform/opacity loops with cycles of 1.6 s or longer and no flashing. The **Animation: on/off** toggle stops them; `prefers-reduced-motion: reduce` disables them by default.

## 2D overview and 3D chase preview

- **2D overview:** north-up Leaflet map with the Sun glare / Weather / Daylight layers and condition icons.
- **3D chase preview:** a lightweight Canvas 2D perspective projection of the actual route geometry, seen from behind and above a **simulated playback position** on the planned route. It is not GPS and has no terrain, buildings or WebGL.
- Sky, sun, clouds, rain, snow, fog, wind streaks, night, headlights and assumed-delay tail lights are drawn from the represented point's projected conditions.
- Mouse wheel, horizontal swipe or arrow keys preview ahead or behind without changing the playback position; **Return to playback position** goes back. Camera distances: Close / Near / Far / Wide. **Play/Pause** advances the playback.
- Both views share one selected time with the timeline. Optional GPS follow: see below.

## 3D terrain view

A third map view, **3D terrain**, drapes the planned route (colored by the projected condition at each point's arrival time) over real elevation in [MapLibre GL JS](https://maplibre.org/) 4.7.1. The camera sits behind and above the *simulated* playback position, looking along the route heading, and follows the same selected point as the timeline and the 3D chase preview; Play, "Return to playback position" and Close/Near/Far/Wide work like the chase preview, and you can drag, rotate and zoom to look around. It is simulated playback of the planned route, not GPS.

- Elevation: Terrain: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen; SRTM, USGS 3DEP and others), terrarium encoding, 1.4× vertical exaggeration. Basemap: © OpenStreetMap contributors.
- The hillshade light direction follows the represented point's sun azimuth. This is visual shading only; it is **not** used for the glare model.
- Needs WebGL and online map + elevation tiles (also in the manual demo scenarios, whose weather stays hand-set). MapLibre is loaded on demand only when this view is opened. If WebGL is unavailable or the map cannot load, the app shows a short notice and switches to the lightweight 3D chase preview. `?view=terrain` opens this view directly.

## Terrain check (approximate, on demand)
Each sun-glare card has a "Check terrain (approximate)" button. It casts a line-of-sight ray toward the
low sun from up to 6 points of that stretch (≤ 60 rays per plan) over bare-earth elevation (AWS Terrain
Tiles, ~30 m) and says whether hills likely hide the sun, the horizon is open, or the check is
unavailable. After a check, the card adds "Terrain-adjusted strong glare: X of Y min", the timeline's
Sun glare row hatches stretches where terrain likely hides the sun (with a legend note), and the glare
KPI subtext adds "(terrain check: …)". This terrain-adjusted glare is a SEPARATE number: geometric and
cloud-adjusted glare, KPI values, advice severity, exposure score and optimizer are unchanged. Points
between two checked points take their verdict only if both agree; anything else stays "not checked".
"Check terrain automatically after each plan" (off by default, remembered in this browser only while
ticked) runs it after every plan. Buildings, trees and road cuts are not modeled. The elevation tiles
are an online dependency even in synthetic demo mode. Details: [docs/OCCLUSION.md](docs/OCCLUSION.md).

## Optional: follow my location

Branch feature (not in the frozen contest build). Click **Use my location (optional)** to start; nothing happens before that click.

- Uses the browser Geolocation API (HTTPS only) with explicit permission. Denied / unavailable / timed-out locations show a message, and the planned-route playback keeps working.
- Each fix is matched to a 1 km sample of the planned route (`snapFix` in `src/lib/geo.js`). The status line shows the fix time, the reported accuracy (±) and the distance from the route line. Fixes coarser than ±1.5 km are not snapped; fixes more than 2 km from the route report "off this planned route" and leave the position unchanged.
- **Hysteresis:** forward progress is accepted at once and, near overlapping route legs, a match just ahead of the current position is preferred. A fix that matches *behind* the current position is held ("holding position") until 3 consecutive fixes agree, so GPS jitter never moves the position backwards. When the matched position keeps decreasing, the label gently adds "You seem to be moving against the planned direction?" (label only). After an off-route excursion the first fix back on the route snaps freely.
- **2D accuracy circle:** the 2D map draws a circle around the latest fix with radius = the reported accuracy in meters. Only the latest fix is drawn; **Stop** removes it.
- Following works the same in all views: the position drives the shared selection, so the 2D map, 3D chase preview and 3D terrain view all move together, and the 3D chase and 3D terrain views show the same "Following your location (GPS)" label.
- Scrubbing, clicking the map/timeline/advice or playing the 3D preview **pauses** following, so you can explore the plan; **Return to my location** resumes it. **Stop** ends the watch.
- The weather and glare shown are still the **planned forecast** for this trip's timeline, not live conditions at your position; the clock is not re-timed to your actual progress. **The heading between consecutive GPS fixes is not used for glare** — glare uses the planned route heading at each sample.
- Coordinates stay in memory in this tab: they are never stored, logged or sent anywhere (no API request carries them). Between fixes only route sample indices and counters are kept.
- Tested with Chrome's emulated geolocation (near-route, 4-step Amherst→Chicago drive, accuracy circle, off-route and back, jitter, reversal, imprecise, denied, pause/return, 2D and 3D chase; the terrain-view label was checked manually in real Chrome under Xvfb). **Not yet verified on a real device's GPS.**

## Data you see and where it comes from

| What you see | Kind | Source |
|---|---|---|
| Temperature, precipitation, snowfall, precip. probability, weather code, cloud cover, visibility, wind speed/direction/gusts | **Model forecast** — not observations | Open-Meteo hourly forecast API (`timeformat=unixtime`) |
| Drive time, arrival time at each point, route line, road names | **Routed estimate** — free-flow, no live traffic | Valhalla (FOSSGIS public server); OSRM demo server as fallback. Never a straight-line substitute |
| Sun altitude/azimuth, glare score, rear sun, twilight/night, crosswind/headwind components | **Computed geometry** in the browser | SunCalc + `src/lib/*.js` |
| Place names and time zones in search | Geocoding result | Open-Meteo Geocoding API |
| "near Toledo, OH" labels | Bundled place list | `src/data/us_places.json` (GeoNames) |
| Anything opened via `?snapshot=` or "Open a recorded snapshot" | **Recorded snapshot** of route + forecast, labeled "Recorded snapshot" with capture time | `public/fixtures/*.json`, captured 2026-10-24 ~4:12 PM EDT for departures on 2026-10-25 |

Forecast lookup rules (`src/lib/forecast.js`): instantaneous variables (temperature, cloud, visibility, wind speed) are interpolated between hours; precipitation, snowfall, probability and gusts come from the hour bin ending at or after the arrival time; wind direction and weather code use the nearest hour. Outside the returned forecast window the value is `null` and shown as "no forecast", never filled in. The planner accepts departures up to about 13 days ahead (Open-Meteo serves 16 days including today; GlarePilot keeps a margin so the whole trip, plus the optimizer's ±3 h, stays inside the window).

## How the glare model works

Constants from `src/lib/sun.js`:

- The sun counts as visible when its geometric altitude is above **−0.833°** (upper limb on the horizon).
- Forward glare needs altitude **≤ 25°** (higher sun is usually blocked by the roof/visor) and an angle to the heading of **≤ 30°**.
- `score = lowness × centering`, with `lowness = 1 − max(0, alt)/25` and `centering = 1 − offset/30` (minimum 0.01 inside the cone).
- Severity: **Severe ≥ 0.55**, **Strong ≥ 0.3**, **Mild > 0**, otherwise None.
- Expected glare after the forecast: cloud cover **≥ 85 %**, precipitation ≥ 0.2 mm or visibility < 2 km lowers severity **2 levels**; cloud **≥ 60 %** lowers it **1 level**. Geometric severity is kept and shown alongside.
- Rear sun: visible, altitude ≤ 15° and ≥ 150° from the heading (signals and brake lights look unlit; oncoming drivers face glare).
- Light phase: day > 6°, low sun > −0.833°, twilight > −6°, otherwise night.

```
            sun (alt ≤ 25°)
              \   |   /
         -30°  \  |  /  +30°        score = lowness × centering
                \ | /               lowness   = 1 − alt/25
                 \|/                centering = 1 − |sun az − heading|/30
   ───────────── [car] ──► heading
                  |
       rear cone: ≥150° from heading, alt ≤ 15°
```

SunCalc azimuth (radians from south, positive west) is converted to compass degrees (0 = north, clockwise); headings use the same convention.

## Driving implications and the rules engine

`src/lib/weather.js` turns each forecast value into flags. Crosswind uses the gust (or wind speed) and the meteorological FROM direction: `crosswind = gust × |sin(from − heading)|`. The advisory crosswind limit is **40 mph** for a car/SUV and **25 mph** for a van/truck/RV or motorcycle. Thresholds are planning heuristics, not official criteria.

`src/lib/advice.js` is a **deterministic, explainable rules engine — no LLM or generative AI at runtime**. The same inputs always give the same recommendations. Each one carries the triggering data (sun altitude range, closest angle to heading, cloud cover, snowfall, gusts…) and concrete actions. Rules cover glare windows, rear sun, snow/ice, rain/heavy rain, low visibility, thunderstorms, crosswinds, night driving and dusk arrival, freezing temperatures, fatigue, missing forecast coverage and a departure suggestion.

## Departure optimizer

`src/lib/optimizer.js` re-evaluates the same route (no extra network calls) for departures shifted −180 … +180 min in 30-minute steps. Each candidate gets an exposure score in weighted minutes:

| Condition (per minute) | Weight |
|---|---|
| Severe / strong / mild expected glare | 3 / 2 / 0.5 |
| Snow | 4 |
| Ice | 5 |
| Heavy rain / rain | 2 / 0.75 |
| Thunderstorm | 3 |
| Low visibility | 2 |
| Crosswind above limit | 2 |
| Night | 0.4 |

Candidates in the past, or with more than 5 % of the drive outside the forecast window, are marked unavailable. Among near-ties (within 3 points or 5 % of the best) the smallest shift wins, and a change is suggested only if it saves at least 10 points or 20 %. This is a transparent heuristic for comparing departures, **not a crash-risk model**.

## Architecture

```
place search ─► Open-Meteo Geocoding (name, state, IANA time zone)
route ────────► Valhalla (FOSSGIS) ──fallback──► OSRM demo   (no straight-line fallback)
                coords[], cumDist[], cumTime[] (routed seconds), road names
resample ─────► sample every 1 km: distance, lat/lon, routed driveSec, heading (±300 m)
checkpoints ──► ≤ 40 points (~30 min / 45 km apart) ─► ONE Open-Meteo multi-location request
evaluate(dep) ► per sample: t = dep + driveSec (+ breaks)
                SunCalc → glare / rear sun / phase;  forecast valid at t → hazards, wind
aggregate ────► totals + windows (glare, rear, wet, snow, wind, low vis, night, missing)
optimizer ────► re-evaluate dep −3 h … +3 h → exposure score
rules engine ─► prioritized recommendations: when / where / why / actions
UI ───────────► KPIs · Leaflet map + layers · SVG timeline + scrubber · compass · table
```

Static single-page app: Vite 5 + vanilla ES modules, no backend, no keys. Pure logic in `src/lib/*.js` (no DOM), UI in `src/main.js` and `src/ui/*.js`. All internal times are UTC epoch milliseconds; each point is displayed in its own local zone (the Chicago trip crosses from EDT to CDT).

## Quick start

Requires Node.js and npm.

```bash
npm ci
npm run dev        # Vite dev server on 127.0.0.1
npm run build      # static build in dist/
npm run preview    # serve dist/ on http://127.0.0.1:4173
```

## Tests

```bash
npm test           # 35 node:test unit, integration and fast-check property tests
npm run test:e2e   # 13 puppeteer-core browser scenarios
```

- `tests/unit/math.test.mjs`: time-zone conversion across DST (including the spring-forward gap), compass/bearing helpers, polyline decoding, routed-time resampling, SunCalc azimuth conversion, glare geometry, cloud adjustment, wind components, hazard flags. Property tests (fast-check): wall time → UTC → wall time round trip in 5 US zones, `angleDiff` invariants, glare monotonicity, crosswind ≤ wind speed.
- `tests/unit/pipeline.test.mjs`: forecast hour semantics and `null` outside the window, break timing, window grouping, geocoding, Valhalla → OSRM fallback with no straight-line route, horizon clamping, one multi-point forecast request, snapshot scenarios (Eastern → Central crossing, sunrise glare), optimizer determinism, synthetic snow/wind/night advice.
- `tests/e2e/app.test.mjs`: normal flow, sunrise glare preset, night trip, invalid input, service failures (no route, forecast down, Valhalla down → OSRM), route change and controls, mobile layout, accessibility basics.
- `tests/unit/scenarios.test.mjs`: linear delay accumulation, delay propagation to every downstream point (time, forecast hour, sun position, arrival), glare timing shifting with delay, trip-clock optimizer in snapshot/scenario mode, the four scenarios triggering their intended conditions, congestion-shift arrival in rain and darkness.
- `tests/e2e/modes.test.mjs`: manual demo scenarios with synthetic labels and zero API calls, shared 2D/3D state with preview ahead and return to playback position, real-mode delay re-timing without refetch, reduced motion and the animation toggle.

E2E runs headless system Chrome (default `/opt/google/chrome/chrome`; override with `CHROME_PATH=/path/to/chrome`) with an isolated temporary profile, a loopback-only Vite preview server, and network requests replayed from the recorded snapshots.

## Recording snapshots

```bash
npm run record:snapshots            # departures tomorrow
npm run record:snapshots 2026-10-25 # departures on a given date
```

Calls the live services for the three presets and writes `public/fixtures/*.json` with `capturedAt`.

## Deploy

```bash
bash scripts/deploy-gh-pages.sh
```

Builds and pushes `dist/` to the `gh-pages` branch (requires push access). The live demo above is served by GitHub Pages. The build uses a relative base, so `dist/` also works on Cloudflare Pages or any static host. **Cloudflare Pages is not deployed** (no Cloudflare login was available); after `npx wrangler login` (or setting `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`), `npm run deploy:cloudflare` publishes `dist/` as the Pages project `glarepilot`.

## Built with Kiro

Built in Kiro CLI with steering docs (`.kiro/steering/`), a spec (`.kiro/specs/route-time-weather-glare/`: requirements, design, tasks), fast-check property tests and Kiro subagents for independent review and parallel stages. Full write-up, including what was not used: [docs/SUBMISSION.md](docs/SUBMISSION.md#how-kiro-was-used).

## Limitations

- Routed times are free-flow estimates: no live or predicted traffic, construction or stops beyond the optional break plan and your own delay assumption.
- The 3D chase preview is a simulated playback of the plan, not navigation: no GPS, terrain or buildings.
- Weather is model forecast, available about 16 days ahead and less reliable the further out you go.
- The glare model ignores terrain, buildings, trees, road curvature between 1 km samples and windshield/visor geometry.
- Glare, wind and optimizer thresholds and weights are heuristics, not validated safety criteria.
- Public free servers (Valhalla FOSSGIS, OSRM demo, Open-Meteo) can be slow or rate-limited; use a recorded snapshot if they fail. Map tiles follow the OpenStreetMap tile usage policy and are not meant for heavy traffic.
- US only. Web app only: no native app, no PWA/installable app.
- **Not a safety system.** GlarePilot is a planning aid; road signs, official weather alerts and your own judgment take priority.

## Attribution and licenses

Forecasts and geocoding: Open-Meteo (CC BY 4.0). Routing: Valhalla on FOSSGIS servers, OSRM demo server. Map data and tiles © OpenStreetMap contributors (ODbL). Place labels: GeoNames (CC BY 4.0). Bundled libraries: Leaflet (BSD-2-Clause), SunCalc (BSD-2-Clause). Details and full license texts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

**Project license:** TODO (human) — the author has not chosen a license yet. Until one is added, no open-source license is granted for this repository's own code.

## Team

TODO (human) — add team member names as registered on SundAI.

## Roadmap (not in this build)

- **3D terrain view** (MapLibre GL + AWS Terrain Tiles): implemented on branch [`terrain-preview`](https://github.com/Umass308XiaofanLiu/glarepilot/tree/terrain-preview) but not visually verified (no WebGL in the build machine's headless browser), so it is not deployed.
- **Terrain/building sun occlusion** in the glare calculation: not modeled. Glare uses bare sun geometry vs heading plus forecast clouds; hills, buildings, trees and road cuts can hide the sun.
- **Live or predictive traffic**: not connected (the free routers are free-flow; traffic-aware APIs need keys). Delays are explicit user assumptions.
- **Real-device GPS follow**: the optional follow mode is tested only with emulated geolocation; the 3D views remain a playback of the planned route.
- Buildings in 3D, more scenario authoring, broader test coverage.
