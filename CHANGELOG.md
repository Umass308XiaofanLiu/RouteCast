# Changelog

Dates are US Eastern. Hashes point to representative commits. The contest submission is preserved as
tag/release `v1.0-hackachusetts`; GitHub Pages serves v1.1.0 since 2026-10-25.

## v1.1.0 — post-hackathon release (developed 2026-10-24 evening, published 2026-10-25)

Views
- 3D terrain view: MapLibre GL 4.7.1 + AWS Terrain Tiles, lazy-loaded, Canvas-chase fallback without
  WebGL (6f02521); blank-map/HUD/attribution fixes and OpenFreeMap 3D buildings (6d7c728);
  context-loss handling, reduced-motion stepped playback, cleanup (3627836).
- Weather/light/wind effects in the terrain view (rain/snow, fog, night + headlights, low-sun glow,
  wind gauge, sky from the represented row) (d999df2).
- Shared trip/time state and control parity across 2D / 3D chase / 3D terrain, fly-in and
  cross-fade transitions (off with reduced motion / Animation off) (8171280).

Location
- Optional "Use my location" follow snapped to the planned route, no storage or transmission of
  coordinates (8047b48); accuracy/fix time, imprecise-fix rejection, pause + "Return to my
  location" (ee4a157); hysteresis, 2D accuracy circle, terrain-view label, wrong-way hint
  (8d9f677). Emulated-geolocation tests only.

Terrain
- Terrain sun-occlusion library and probe (8faf2e4); validation on recorded real terrarium tiles,
  sampler concurrency/retry/timeout/abort, near-field skip (c3cc891).
- On-demand approximate terrain check per glare window (e14b4c9); separate terrain-adjusted glare
  with card/timeline/KPI display, opt-in auto check, 60-ray cap, DEM cache reuse (8629610).

Traffic
- Experimental key-based routing adapters (TomTom/HERE/Mapbox) with provenance and free-flow
  fallback (0467142); traffic source assessment `docs/TRAFFIC.md` (517e665).
- Keyless on-demand overlays: NYC DOT speeds (near-now only) and INDOT WZDx work zones; provider UI
  hidden behind `?experimental=traffic` (5c2ce17).

Fixes, security and testing
- G4-BUG-1: V8 Maglev let optimizer candidates overwrite the base plan's numbers in the minified
  build; fixed with a tagged-field `tripResult()`; TomTom E2E re-enabled (5c17994).
- Feed text escaped in Leaflet tooltips (XSS) with a regression E2E (816df5c).
- `npm run test:visual` (headed Chrome + SwiftShader under Xvfb) and `docs/TESTING.md` (5c17994).
- Totals at 816df5c: 122 unit tests, 37 E2E tests (measured 2026-10-24).

## v1.0-hackachusetts — contest build (2026-10-24, tag at fc69369)

- 15:00–16:31: initial app, rebuild with routed timing, time-aligned Open-Meteo forecasts, glare
  model and UI (d1f2a56, 022bfd0); browser E2E suite with recorded-response replay (2d1e4fc).
- 17:00–17:13: independent-review fixes, docs/submission pack, demo recording, Cloudflare deploy
  script (human login required; not deployed) (50ff93a … e7e060c).
- 18:38–18:56: delay assumptions, API-free manual demo scenarios, animated condition icons, Canvas
  3D chase preview; review fixes; submission docs (472e365 … fc69369).
- Post-tag docs/media only (no `src/` changes): video release links, poster, transcript, demo
  recording script (346e6af, f172889, d8c1dd4).
