# RouteCast limitations

Honest scope of the v1.1 post-hackathon release (v1.1.0, renamed RouteCast in v1.1.1, 2026-10-25). The live
GitHub Pages demo serves this release; the contest build (`v1.0-hackachusetts`) has none of the post-hackathon features.

## Timing and traffic

- Routing is **free-flow**: the public Valhalla (FOSSGIS) and OSRM demo servers return no live or
  predictive traffic. A Valhalla request with `date_time` returned the same time as without it.
- **No live or predictive traffic by default.** Delays are the user's explicit assumption (or a
  scenario's hand-set value), spread linearly over a chosen stretch.
- Keyless overlays are **current conditions only** and narrow in coverage: NYC DOT speeds only for
  routes entering NYC with a departure within 60 min of now and `data_as_of` ≤ 20 min old (a probe on
  2026-10-24 found the feed ~1.5 h old, so "too old to use" is common); work zones only from INDOT
  (Indiana). Overlays never change timing automatically; free-flow references (50/30 mph) are
  RouteCast assumptions.
- Provider traffic (TomTom/HERE/Mapbox) is **experimental and hidden** (`?experimental=traffic`),
  tested only against mocked responses built from documentation. No real provider call has been
  made; live behaviour is UNVERIFIED. The optimizer reuses one plan's traffic timing for all bars.

## Sun, glare and terrain

- The core glare score is bare geometry (sun altitude/azimuth vs planned heading) softened by
  forecast cloud/precipitation/visibility. Thresholds and weights are heuristics, not validated
  safety criteria. Road curvature between 1 km samples, windshield/visor geometry are ignored.
- The terrain check is **approximate**: bare-earth AWS Terrain Tiles (~30 m), at most 6 points per
  glare window and 60 rays per plan, near field (first 100 m) skipped, 30 km ray length. Buildings,
  trees and road cuts are not modeled. Missing or failed data yields **"unknown"/"not checked",
  never "blocked"**. Its terrain-adjusted glare is a separate number and never changes the main
  score, KPIs, advice severity or optimizer.
- The terrain view's hillshade follows the sun azimuth as visual shading only.

## Views and location

- The 3D chase and 3D terrain views are **simulated playback of the planned route**, not
  navigation; the clock is not re-timed to actual progress.
- GPS follow is optional (off until clicked) and **tested only with Chrome's emulated geolocation**;
  real-device GPS is UNVERIFIED. The weather/glare shown remain the planned forecast; the heading
  between GPS fixes is not used for glare.
- WebGL (3D terrain) is verified **only with SwiftShader** in headed Chrome under Xvfb
  (`npm run test:visual`). Headless Chrome WebGL crashes on the build machine. Real GPUs, mobile
  browsers and physical phones are UNVERIFIED (only emulated viewports/touch). A known SwiftShader
  flake: `Framebuffer is not complete` after a simulated context loss (see `docs/TESTING.md`).
- The 3D terrain view needs WebGL plus online DEM/building/map tiles even in synthetic demo mode;
  without them it falls back to the Canvas chase preview.

## Services and data

- Weather is Open-Meteo **model forecast** (about 16 days; the planner allows ~13 days), less
  reliable further out; outside the window values are "no forecast", never filled in.
- All services are public and free (Open-Meteo, Valhalla FOSSGIS, OSRM demo, OSM tiles,
  OpenFreeMap, AWS Terrain Tiles, NYC Open Data, INDOT). They may be slow, rate-limited or change
  without notice; recorded snapshots exist for when they fail.
- US only. Web app only (no native app, no PWA).

## Intelligence and safety

- **No LLM or generative AI at runtime.** Advice comes from a deterministic, explainable rules
  engine (`src/lib/advice.js`); the optimizer is a transparent heuristic, not a crash-risk model.
- **Planning aid, not a safety system.** Road signs, official alerts and the driver's judgment
  take priority.
