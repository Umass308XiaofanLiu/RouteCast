> **Superseded for post-hackathon work** — current status and evidence: `CHANGELOG.md`, `docs/TESTING.md`, and the maintainer's progress tracker kept outside this repository. The section below records the contest-night state.

# GlarePilot — project status (2026-10-24 ~7:15 PM ET)

**Recording / submission build (frozen):** https://umass308xiaofanliu.github.io/glarepilot/ — app code = commit `8ad2b12` (main also has docs-only commits after it). Do not redeploy visible UI until the human finishes recording.

## Done and verified (live build)
- Real forecast planning: live Valhalla/OSRM route + Open-Meteo forecast, each point evaluated at its projected future arrival time (departure + routed time + breaks + assumed delay); provenance strip with retrieval time.
- Recorded real-data snapshots (`?snapshot=…`) and four API-free manual demo scenarios (`?demo=…`, hand-set synthetic data, labelled).
- Delay assumptions propagate to every downstream arrival time, forecast hour, sun position and glare; "What the assumed delay changes" card.
- Animated original SVG condition icons (glare, sun-aligned, rain, snow, fog, wind, night, assumed delay), legend, Animation on/off, prefers-reduced-motion.
- 2D north-up overview ↔ Canvas 3D chase preview (simulated playback, not GPS; no terrain/buildings) sharing one time state; wheel/swipe/keys preview, Return to playback position, Close/Near/Far/Wide, Play/Pause.
- Tests at freeze: 35 unit + 13 E2E pass; independent subagent reviews twice, findings fixed; live smoke checks (desktop, mobile, reduced motion, zero weather/route API calls in demo mode).
- Narrated (synthetic Piper voice, LJ Speech public domain) + captioned 2:50 video, SRT, transcript: GitHub release `v1.0-hackachusetts`.

## Branch work (pushed, NOT deployed, not in the recording build) — 7:33 PM
- `terrain-preview` @ 6d7c728: MapLibre GL 4.7.1 3D terrain (AWS Terrain Tiles, hillshade = visual only) + OpenFreeMap 3D buildings, WebGL fallback to the Canvas chase. Visually verified with real Chrome + SwiftShader under Xvfb (screenshots docs/qa/terrain-*.png on that branch); not checked on a real GPU. 35 unit + 14 E2E pass on the branch.
- `occlusion-prototype` @ 8faf2e4: pure terrain-horizon library (`src/lib/horizon.js`), tests (45 unit pass), real-tile probe, `docs/OCCLUSION.md`. NOT wired into glare; missing data → 'unknown', never 'blocked'. Integration estimate ≈ 3–4 focused days.
- `gps-follow` @ 8047b48: optional "Use my location" (explicit click, HTTPS, denial/off-route handling, nothing stored or sent), snaps to the planned route; 37 unit + 17 E2E pass on the branch. Tested with emulated geolocation only.
- Live/predictive traffic: still no credentials (TomTom/HERE/Google-class APIs need keys); delay assumptions instead. Cloudflare: no credentials.
- Merging any branch into the live site is a visible production change: only after the human says recording is finished, and note the contest rule that the submission may not be changed after the submission period.

## Human-only actions
1. Upload the video publicly (YouTube/Vimeo) — file and text in release `v1.0-hackachusetts` and `docs/media/youtube.md`.
2. SundAI: log in, add team members, choose track (recommended Civic Action V3), paste repo/demo/video links + text from `docs/SUBMISSION.md`, Submit before 8 PM, confirm it shows as submitted.
3. Optional: license choice.

## Choices made by the agent (not explicit human decisions)
Linear delay spread over a chosen route quarter; the four scenario designs and values; Canvas perspective instead of a WebGL map for the shipped 3D view; GitHub Pages (no Cloudflare credentials); Civic Action V3 recommendation; no license; video published as a release asset to avoid repo bloat.
