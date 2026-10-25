# Tasks

- [x] 1. Timezone utilities (wall time in IANA zone ↔ UTC, DST gap/overlap) — R1.2, R3.3
- [x] 2. Geometry: bearing, polyline6 decode, 1 km resampling with routed time and smoothed heading — R2.1, R4.1
- [x] 3. Providers: Open-Meteo geocoding, Valhalla + OSRM fallback, Open-Meteo multi-point hourly forecast, timeouts and honest errors — R1.1, R2, R3.1
- [x] 4. Forecast lookup with hourly semantics and horizon nulls — R3.1, R3.2
- [x] 5. Sun model: compass azimuth, light phase, geometric glare, cloud adjustment, rear sun — R4
- [x] 6. Weather implications: crosswind/headwind, snow/ice/rain/fog/storm flags, vehicle profiles — R5.1, R5.2
- [x] 7. Trip evaluation, breaks, windows and totals — R2.1, R4.5
- [x] 8. Departure optimizer (±3 h, exposure score) — R5.4
- [x] 9. Rules engine with where/when/why/actions — R5.3
- [x] 10. UI: form + combobox, presets, KPIs, map layers + legend, timeline + scrubber, compass, moment card, optimizer, table, provenance — R6
- [x] 11. Recorded snapshots for offline demo and tests — R6.3
- [x] 12. Unit, integration and property-based tests (node:test + fast-check)
- [x] 13. Browser E2E tests with screenshots (normal, glare/no-glare, night, invalid input, service failure, route change, mobile)
- [x] 14. Independent review (Kiro subagent) and fixes: glare priority/muting, short-blip filtering, KPI wording, XSS escape, snapshot ids, abort races, horizon margin, a11y live region, mobile order
- [x] 15. Public demo deployment (GitHub Pages) and submission pack (README, docs/SUBMISSION.md, docs/DEMO_SCRIPT.md, demo video)

## Post-hackathon (integration branch, 2026-10-24; not deployed)
- [x] 16. 3D terrain view (MapLibre GL + AWS Terrain Tiles), OpenFreeMap buildings, context-loss handling, Canvas fallback — PH1
- [x] 17. Terrain-view weather/light/wind effects — PH1
- [x] 18. Shared view state, control parity and transitions across 2D / chase / terrain — PH2
- [x] 19. Terrain occlusion library validated on real tiles; on-demand terrain check; separate terrain-adjusted glare; opt-in auto — PH3
- [x] 20. Optional GPS follow with hysteresis, accuracy circle, pause/return (emulated tests) — PH4
- [x] 21. Keyless NYC DOT / INDOT overlays on click; XSS-escaped tooltips — PH5
- [x] 22. Experimental provider-key traffic adapters behind `?experimental=traffic` (mock tests) — PH6
- [x] 23. Fix G4-BUG-1; `npm run test:visual` (Xvfb + SwiftShader); docs (TESTING, ARCHITECTURE, LIMITATIONS, CHANGELOG) — 122 unit / 37 E2E pass at 816df5c
- [ ] 24. Deploy after review (GitHub Pages or Cloudflare with human login) — PH7
- [ ] 25. Real GPU / phone / GPS hardware verification — PH8
- [ ] 26. Real provider traffic validation with user keys — PH9
