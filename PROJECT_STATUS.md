# GlarePilot — project status (2026-10-24, Hackachusetts 2026)

Live: https://umass308xiaofanliu.github.io/glarepilot/ (GitHub Pages, deployed commit 8ad2b12) · Repo: https://github.com/Umass308XiaofanLiu/glarepilot

## Completed
- Route-time forecast and sun-glare planner: Valhalla route (OSRM fallback), 1 km samples, Open-Meteo forecast at each projected arrival time, SunCalc glare, hazards, departure optimizer, deterministic rules engine.
- Two data modes: real-data planning (live route + forecast retrieved now; recorded real-data snapshots labeled separately) and four manual demo scenarios with hand-set synthetic weather/delay (`?demo=`).
- Traffic delay assumption (+15 min … +2 h, chosen stretch) with the "What the assumed delay changes" card.
- Animated route condition icons and 2D overview / 3D chase preview sharing one selected time.
- Second independent Kiro subagent review of the deployed build: no blockers; its majors were fixed.

## In progress
- Demo video upload and SundAI submission (human-only, below).

## Deferred / not implemented
- GPS / live location tracking (not implemented; the 3D view is a simulated playback).
- Live or predictive traffic integration.
- Terrain, buildings or a WebGL 3D map. Project license. Cloudflare Pages mirror.

## Renderer
Canvas 2D perspective projection of the actual route geometry from a camera behind/above the simulated playback position (`src/ui/chase3d.js`). Sky, sun, clouds, rain, snow, fog, wind streaks, night, headlights and assumed-delay tail lights come from the represented point's projected conditions. Limitations: no terrain, elevation, buildings, lanes or WebGL; flat ground plane.

## Traffic integration vs delay scenarios
No traffic provider is connected. Free public Valhalla/OSRM return free-flow times (a Valhalla `date_time` request returned the same 10,475 s for Amherst → New York); TomTom/HERE/Google need keys that were not available. Delay is an explicit user (or scenario) assumption, spread linearly over the chosen stretch; later points' arrival, forecast hour, sun and glare are recomputed. Forecast window: departure −3.5 h … arrival +5.5 h.

## Real data vs synthetic
Real mode and snapshots: Open-Meteo forecast + routed times, retrieval time shown. Scenarios: hand-set values on a recorded real route; no weather/routing/traffic API calls, only OSM map tiles.

## Animation coverage
Inline SVG icons for glare, sun-aligned, snow/ice, rain, fog, wind, delay and dark; CSS transform/opacity cycles ≥ 1.6 s, no flashing; "Animation: on/off" toggle; `prefers-reduced-motion` disables icon and 3D motion.

## Tests
35 unit (`npm test`: math, pipeline, scenarios) and 13 E2E (`npm run test:e2e`: app, modes) pass.

## Human-only submission actions
SundAI login · add team members · choose track · upload video publicly · paste links and text · Submit before 8:00 PM ET and confirm.

## Choices made by the agent (not explicit human decisions)
- Delay modeled as a linear spread over a chosen route stretch (whole trip, first quarter, mid-route 37.5–62.5 %, last quarter).
- Four scenario designs and their hand-set values (`src/lib/scenarios.js`): storm-crosswind (Amherst → NYC 1:00 PM, heavy rain, gusts to 85 km/h, van/truck); sunset-glare (Amherst → Chicago 8:00 AM, clear skies); snow-fog-night (Albany → Boston 7:30 PM, snow + freezing fog); congestion-shift (Amherst → NYC 3:30 PM, +75 min mid-route, rain after 6:15 PM).
- Canvas perspective instead of a WebGL map library: MapLibre/Cesium need tile/style sources and more time; Mapbox/Google need keys.
- GitHub Pages instead of Cloudflare Pages (no Cloudflare credentials).
- Civic Action V3 track recommendation (the human decides).
- No license chosen.
