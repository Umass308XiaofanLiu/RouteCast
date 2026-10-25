# Testing GlarePilot

All suites run locally without API keys. Unit and E2E tests never touch the real network; the visual
suite loads only `?demo=` scenarios but fetches public map/terrain/building tiles.

Measured on 2026-10-24 at 816df5c (integration branch): `npm test` 122/122 pass (12 files,
~0.7 s of test time); `npm run test:e2e` 37/37 pass (8 files, ~105 s including the build). `npm run
test:visual` (with `PORT=4297 OUT=/tmp/b4_visual`): 13/13 shots clean, ~7 min, no
`Framebuffer is not complete` in that run.

| Command | Runtime | Covers |
| --- | --- | --- |
| `npm test` | Node, ~1 s | Unit/property tests in `tests/unit/*.test.mjs`: sun/glare math, trip evaluation, optimizer, planner pipeline, scenarios, snapshot round-trip, horizon/occlusion, terrain check + terrain-adjusted glare, terrain FX, GPS follow, keyless overlays (NYC DOT, INDOT), traffic adapters (TomTom/HERE/Mapbox parsing, errors, key redaction). |
| `npm run test:e2e` | Headless Chrome, a few min | `tests/e2e/*.test.mjs` against a fresh `vite build` served by `vite preview` on 127.0.0.1 (port 4180, next free). Routing, forecast and geocoding are replayed from `public/fixtures`; tiles get a blank PNG; anything else is aborted and recorded. Covers the planner UI, demo modes, errors/fallbacks, overlays, GPS (emulated), terrain check, view switching, and the flag-hidden provider traffic path with a fake TomTom key. Rewrites `docs/qa/e2e-*.png`. |
| `npm run test:visual` | Headed Chrome + SwiftShader under Xvfb, ~6 min | `scripts/test-visual.sh`: builds, serves on 127.0.0.1:4197 (`PORT=`), runs `tests/e2e/terrain-visual.mjs` under `xvfb-run -a -s "-screen 0 1600x1000x24"`, writes PNGs + `summary.json` to `/tmp/glarepilot-visual` (`OUT=`), stops the server. Exits non-zero on page errors, failed view-parity checks, HUD overlaps, HUD boxes outside the view, or a missing WebGL canvas. `ONLY=<regex>` limits shots. Inspect the PNGs by eye; the gate does not judge rendering quality. |

Requirements: Google Chrome at `/opt/google/chrome/chrome` (or `CHROME_PATH`), and `/usr/bin/xvfb-run`
for the visual suite. Headless Chrome WebGL is unreliable on this machine, which is why the 3D
terrain view is only checked by the visual suite.

Screenshots: `npm run test:e2e` always rewrites `docs/qa/e2e-*.png` (there is no `UPDATE_SHOTS`
switch in `tests/e2e/helpers.mjs`). After running it in a working copy you do not intend to change,
restore them with `git checkout -- docs/qa`. The visual suite writes only to `OUT` (default
`/tmp/glarepilot-visual`) and never touches `docs/`.

Test files: unit — `gps`, `gpsmatch`, `horizon`, `math`, `occlusion-real`, `overlays`, `pipeline`,
`scenarios`, `terraincheck`, `terrainfx`, `terrainglare`, `traffic`; E2E — `app`, `gps`, `modes`,
`overlays`, `terrain`, `terraincheck`, `traffic`, `views` (plus the non-`node --test` script
`terrain-visual.mjs` used by `npm run test:visual`).

## Known issues / TODOs

- Visual suite, `nyc-close-desktop`: the simulated GPU reset (`WEBGL_lose_context`) sometimes
  raises `Error: Framebuffer is not complete` from MapLibre under SwiftShader after the context is
  restored (seen 1 of 2 runs on 2026-10-24; not seen in a third run later that day). The view's own lost-context message and recovery
  checks pass. Real-GPU behaviour is unverified.
- G4-BUG-1 (fixed 2026-10-24): the fake-TomTom E2E failed in about half of the runs on Chrome 149
  with the minified build because V8 Maglev let an optimizer candidate overwrite the base plan's
  numeric fields. See `tripResult()` in `src/lib/trip.js`. If it reappears, check with
  `CHROME_PATH` pointing to a wrapper that adds `--js-flags=--no-maglev`.

## Not verifiable here

- Real GPUs, mobile browsers and physical phones (only SwiftShader and emulated viewports/touch).
- Real GPS hardware (follow mode is tested with emulated positions).
- Real provider traffic APIs (TomTom/HERE/Mapbox): adapters are tested only against responses
  reconstructed from documentation; no keys are used.
- Live routing/forecast/geocoding services in E2E (replayed fixtures only). Live NYC DOT / INDOT
  feeds are exercised only through recorded or mocked responses.
