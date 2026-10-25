# Terrain sun-occlusion — prototype assessment

Status (2026-10-24, branch b1-occlusion-real, local only): the horizon library is wired into an
ON-DEMAND, separate "terrain check" line on each glare recommendation card. It is still NOT part of
the glare score. Real-tile validation (below) and sampler robustness were added on this branch.
The original prototype assessment follows the integration section.

## Validation on real AWS terrarium z12 tiles (2026-10-24)
Recorded 12 real tiles (1.3 MB) into `tests/fixtures/dem/` (`node scripts/horizon-probe.mjs --record lat lon az maxDistM`);
`tests/unit/occlusion-real.test.mjs` replays them offline through `createDemSampler` with a Node PNG
decoder (`fixtureFetchTile` in the probe script). Rays use the app defaults (eye 1.5 m, refraction 0.13,
`minDistM` 100 m) with a shortened `maxDistM` so 2–4 tiles suffice. Observer points were chosen near
the highway alignment from coordinates I estimated, not snapped to a road map (UNVERIFIED road position).

| Case | Point / azimuth / maxDist | Observer | Horizon | Max-angle sample | Result |
|---|---|---|---|---|---|
| (a1) I-90 between Lee and West Stockbridge MA, westbound | 42.330, −73.320 / 258° / 8 km | 281.8 m | **5.34°** | 547.8 m at 2.82 km (42.3247, −73.3536) | 3° sun → blocked, 8° → visible |
| (a2) I-90 near Westfield MA interchange, Berkshire escarpment | 42.165, −72.760 / 258° / 10 km | 81.7 m | **1.89°** | 287.7 m at 6.11 km (42.1536, −72.8325) | 1° → blocked, 3° → visible |
| (b) Ohio Turnpike I-80/90 near Fremont, NW Ohio plain | 41.456, −83.460 / 265° / 10 km | 200.6 m | **0.03°** | 203.1 m at 1.54 km | 1° → visible, 0.2° → unknown (±0.5° margin) |
| (c) Springfield MA, I-91 by the Connecticut River | 42.101, −72.590 / 258° / 8 km | 19.4 m | **0.87°** | 24.2 m at 219 m (river bank) | 2° → visible |

- (a1) profile along 258°: 282 m (0–265 m) → 319 m at 825 m → 315 m at 1.76 km → 434 m at 2.57 km →
  **548 m at 2.82 km** → 291 m at 3.75 km (valley behind) → 388 m at 5.5 km → 521 m at 8 km. A
  narrow ~270 m-high ridge 2.8 km west: atan((547.8 − 283.3 − 0.5)/2824) = 5.34°, consistent with
  the reported horizon. In late October the sun at az ≈ 258° is ~2–4° up, so the model says the
  ridge hides it there. Plausible for the Berkshire hills around West Stockbridge; I did not identify
  the ridge's name or compare against a photo/observation.
- Summit cross-check: Mount Greylock tile (12/1215/1510), max within ±6 px of 42.6375, −73.1658 =
  **1064.0 m**; published summit 1,064 m (3,491 ft). Point sample at the coordinate: 1061.6 m.
- (b) is flat as expected (< 3 m relief in 10 km). (c) the 0.87° comes from a 5 m rise 219 m away
  (bank / embankment); the hills ~8 km west are only 0.36°. Buildings in downtown Springfield are
  NOT in the DEM, so an urban horizon is under-estimated — this case shows the bare-earth limit,
  not a real urban skyline.
- Near-field: without `minDistM`, several on-road points gave 9–30° "horizons" from samples 30–260 m
  away (road cuts, embankments, a hillside pixel next to the road). `checkGlareWindows` now defaults
  to `minDistM: 100` (`DEFAULT_HORIZON_OPTS`), which removes the 30–60 m cases; some 100–300 m
  artefacts can remain (e.g. 42.17, −72.81 gave 29.9° at 262 m — a hillside beside the highway).
  This is the main remaining false-"blocked" risk.

## Browser decode path (verified 2026-10-24)
Headless Chrome (`/opt/google/chrome/chrome`, `--no-sandbox --disable-gpu`, fresh temp profile) loaded a
page from 127.0.0.1:4195 (temp dir, removed afterwards) importing copies of `demsampler.js`/`horizon.js`,
and called the default `browserFetchTile` (fetch → createImageBitmap → OffscreenCanvas → getImageData)
on the live AWS tile 12/1213/1515 (CORS OK). All 256×256×4 bytes equal the Node decode of the recorded
fixture (weighted checksum equal); 6 probed pixels decode to identical elevations (e.g. 325.426 m,
286.969 m, 305.539 m); `createDemSampler()` with the browser default returned 547.84 m at the (a1)
ridge point, same as Node. `createImageBitmap` is now called with `premultiplyAlpha: 'none'` and
`colorSpaceConversion: 'none'` so RGB-encoded elevations cannot be color-managed. Not verified: other
browsers (Safari/Firefox), real phones, browsers without OffscreenCanvas (DOM-canvas branch).

## Sampler robustness (demsampler.js)
- Memory: LRU of ≤ `maxTiles` (default 64) decoded tiles × 256 KiB RGBA = **≤ 16 MiB**, plus ≤ 6
  in-flight decodes. Failed tiles are cached as missing (small) so they are not re-requested.
- Concurrency: ≤ `maxConcurrent` tile fetches (default 6, hard cap 6); extra requests queue.
  `checkGlareWindows` additionally runs ≤ 4 rays at once.
- Retry: one retry on a network error or timeout; none on HTTP errors (`noRetry`) or empty tiles.
- Timeout: `timeoutMs` per attempt (default 10 s), enforced even if `fetchTile` ignores its signal.
- AbortSignal: `sampleElevation(lat, lon, { signal })`; `checkGlareWindows` passes its signal through.
  An aborted caller gets `null` at once; if every waiter of a tile aborted, the fetch is aborted and
  the tile is not remembered as missing. `sampleElevation` never throws; `checkGlareWindows` still
  rejects with `AbortError` on abort (main.js relies on that).
- Unit-tested with synthetic fetchTile (`occlusion-real.test.mjs`): peak concurrency ≤ 6, retry counts,
  timeout, abort/refetch, shared-waiter survival, LRU size.

## Integrated terrain check (what is wired now)
- `src/lib/demsampler.js`: `createDemSampler({ zoom = 12, fetchTile, maxTiles = 64 })` →
  `sampleElevation(lat, lon)` (meters or `null`). Loads AWS terrarium z12 tiles
  (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`) via fetch → blob →
  createImageBitmap → OffscreenCanvas/canvas `getImageData`; LRU cache of ≤ 64 decoded tiles with
  in-flight de-dup; failed tiles are cached as missing (no retry storm) and never throw.
- `src/lib/terraincheck.js`: `checkGlareWindows(model, ev, descs, { sampleElevation, maxSamplesPerWindow = 6, signal })`
  picks ≤ 6 samples per displayed glare window (geometric glare ≥ 1, always the peak), casts one
  `terrainHorizon` ray toward the sun azimuth at that sample's arrival time (`ev.rows[i].sun`),
  classifies with `sunBlocked`, ≤ 4 rays at once, abortable (AbortError). Per window:
  `terrain-may-hide` (blocked ≥ 1 and ≥ 50 % of checked) · `partly` (some blocked) · `open` (all
  checked visible) · `unknown` (otherwise; missing data never counts as blocked).
- UI (`src/main.js`): each glare card shows a "Check terrain (approximate)" button; one click checks
  all displayed glare windows, shows "Checking terrain…", then one line per card:
  "hills likely hide the low sun for part of this stretch" / "may hide … at some points" /
  "open horizon toward the sun" / "inconclusive …" / "Terrain check unavailable (elevation tiles did
  not load)", with the note "Bare-earth elevation (AWS Terrain Tiles, ~30 m); buildings, trees and
  road cuts are not modeled". A new evaluation (trip, departure, vehicle, delay…) aborts and resets it.
  Glare severity, KPIs, exposure score and optimizer are untouched (unit + e2e asserted).
- Why on demand, not automatic: DEM tiles are a separate online dependency (in real, snapshot AND
  synthetic modes — synthetic mode still makes no weather/route/traffic calls, but the terrain check
  does fetch elevation tiles). Existing e2e tests assert that a planned trip makes no unknown-host
  requests, and a user click keeps that network use explicit. Switching to automatic is a one-line
  call to `runTerrainCheck()` after `evaluate()` once those test expectations are revisited.
- Tests: `tests/unit/terraincheck.test.mjs` (synthetic ridge blocks westbound sunset → terrain-may-hide,
  ridge behind → open, flat → open, null/throwing sampler → unknown, abort, ≤ 4 concurrent rays,
  ev untouched, sampler decode/de-dup/LRU/failure). `tests/e2e/terraincheck.test.mjs`: sunset demo,
  no DEM request before the click, "unavailable" after (test browser aborts DEM hosts), KPIs identical,
  no page errors. A one-off local check (not committed) served a generated flat terrarium PNG for every DEM URL
  in the sunset demo: 55 tile requests, cards showed "open horizon" twice and "inconclusive" once
  (sun within ±0.5° of the horizon), KPIs unchanged, no page errors. Real AWS tile decode in a browser is
  now verified (section above); still not verified: the "hills" line in the rendered UI (unit-tested only).


## Three different layers (do not conflate)
- A. Terrain rendering: drawing hills in the 2D/3D views. Cosmetic; says nothing about glare.
- B. Visual lighting/shadows: shading the 3D chase preview. Cosmetic; also not a glare signal.
- C. Geographic line-of-sight: "is the sun geometrically below the terrain horizon from this road
  point?" Only this layer may ever inform glare, and only as a separate, labelled hint.

## What the prototype does (layer C only)
- `decodeTerrarium`, `tileXY`/`tileXYFloat`/`pixelLookup`, `metersPerPixel` for 256 px Web-Mercator tiles.
- `terrainHorizon(...)` marches along the sun azimuth (great-circle `destinationPoint`), up to 30 km;
  default ~60 geometric samples (dense near the car), or uniform `stepM`. Elevation angle =
  atan((h − h0 − eyeHeight − drop)/d), drop = d²/2R·(1 − 0.13). Sampler is injected (sync or async).
- `sunBlocked(...)` → `blocked | visible | unknown`. `unknown` when observer elevation is missing,
  coverage < 0.9, no data, or the sun is within ±0.5° of the horizon. Missing data never yields `blocked`.
- Tests (`tests/unit/horizon.test.mjs`): flat → −0.04° horizon, 2° sun visible; 300 m ridge at 3 km →
  ≈5.67°, blocks a 3° sun, not 8°; ridge behind does not block; missing data → unknown; decode values;
  fast-check property: raising any sample never lowers the horizon.
- `scripts/horizon-probe.mjs` (PROBE; `--network` default, `--record`, `--fixtures` offline): fetched 6 real z12 AWS tiles for Amherst, MA at az 290°
  → horizon 0.73° at 23.7 km, coverage 1. Decoder sanity: Mt Greylock summit sample = 1064.0 m
  (published summit 1,064 m).

## Data sources (checked 2026-10-24 with curl)
- AWS Terrain Tiles (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`): HTTP 200,
  256 px PNG, ~120 KB per z12 tile. z12 ≈ 38.2 m/px at the equator, ≈ 29.3 m/px at 40°N (the
  "38 m at 40°N" figure in the brief was wrong). Attribution is required (mixed sources; see the
  AWS open-data registry page — I did not re-read its licence text today).
- Mapterhorn (`tiles.mapterhorn.com/{z}/{x}/{y}.webp`, tilejson verified): terrarium encoding,
  512 px WebP tiles, HTTP 200. Site states code BSD-3; terrain data "various open-data sources",
  per-source list at mapterhorn.com/attribution (not reviewed in detail). WebP needs a decoder
  (browser canvas is fine; Node would need a dependency).

## Cost if wired in
- Only for route samples with geometric glare ≥ 1 and sun altitude below ~15° (above that, terrain
  rarely matters within 30 km): one ray of 30–60 lookups per sample, pure arithmetic once tiles load.
- A 30 km ray crosses ~5–6 z12 tiles (probe: 6). Consecutive samples share most tiles.
- Amherst→Chicago (~1,500 km): low-sun glare windows are typically one or two stretches of
  ~100–250 km. Rough estimate: 40–120 unique z12 tiles ≈ 5–15 MB per evaluation, cacheable
  (IndexedDB / HTTP cache). This is an estimate, not measured on a real route.
- Re-evaluating departure-time alternatives reuses the same tiles (azimuth changes, corridor does not).

## What it cannot see
Buildings, trees, noise walls, road cuts, overpasses, bridges, tunnels; DEM smoothing at ~30 m/px
(near-field terrain within ~100 m is unreliable); the car's own pitch; vertical datum/road-height
offsets; refraction variability near the horizon (±0.5° is realistic). It answers "might terrain
hide the sun", never "the road is in shade".

## How to show results
- Separate label, e.g. "Terrain may hide the sun here (≈ low confidence)", with the horizon angle and
  the margin. Show `unknown` as "terrain not checked", not as safe.
- Never silently lower or zero the glare score. If ever combined, keep the geometric score visible
  and present the terrain hint beside it.

## Remaining effort (realistic)
- Browser tile fetch + canvas decode + cache + rate limits/attribution: 0.5–1 day.
- Wire into trip evaluation as a separate field (async, off the main path, cancellable): 0.5 day.
- UI label + legend + accessibility text: 0.5 day.
- Tests: recorded tiles for e2e replay (helpers abort unknown hosts), unit cases at real ridges,
  route-level sanity checks vs a known valley sunset: 1 day.
- Review/validation against real observations: 0.5–1 day. Total ≈ 3–4 focused days; not hackathon-safe
  before the demo.
