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

## Not in the recording build
- 3D terrain view: code on branch `terrain-preview`, build + tests pass, WebGL rendering NOT visually verified (headless WebGL crashes on this machine) → not deployed.
- Buildings: not started. Terrain solar occlusion: not implemented (est. 2–4 h for a bounded, tested DEM-horizon approximation).
- Live/predictive traffic: no credentials; delay assumptions instead. GPS: not implemented.

## Human-only actions
1. Upload the video publicly (YouTube/Vimeo) — file and text in release `v1.0-hackachusetts` and `docs/media/youtube.md`.
2. SundAI: log in, add team members, choose track (recommended Civic Action V3), paste repo/demo/video links + text from `docs/SUBMISSION.md`, Submit before 8 PM, confirm it shows as submitted.
3. Optional: license choice.

## Choices made by the agent (not explicit human decisions)
Linear delay spread over a chosen route quarter; the four scenario designs and values; Canvas perspective instead of a WebGL map for the shipped 3D view; GitHub Pages (no Cloudflare credentials); Civic Action V3 recommendation; no license; video published as a release asset to avoid repo bloat.
