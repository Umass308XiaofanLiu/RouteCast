# Design — route-time weather and sun-glare planning

## Architecture
Static single-page app (Vite build, no backend). The browser calls free, keyless, CORS-enabled APIs directly.

```
place search ──► Open-Meteo Geocoding (name, state, IANA timezone)
route ─────────► Valhalla (FOSSGIS)  ──fallback──► OSRM demo server
                 normalized: coords[], cumDist[], cumTime[] (routed seconds), road names
resample 1 km ─► samples: {distM, lat, lon, driveSec, heading (±300 m smoothed)}
checkpoints ───► ≤40 points (~every 30 min / 45 km) ──► ONE Open-Meteo multi-location hourly request
evaluate(dep) ─► per sample: t = dep + elapsed(driveSec, breaks)
                 SunCalc altitude/azimuth → glare geometry → cloud-adjusted severity
                 forecast value valid at t → hazards, crosswind/headwind
aggregate ─────► totals, windows (glare, rear sun, wet, snow, wind, low vis, night, missing)
optimizer ─────► re-evaluate dep −3 h … +3 h (no extra network) → exposure score
rules engine ──► prioritized recommendations with where / when / why / actions
UI ────────────► KPIs, Leaflet map (glare / weather / daylight layers), SVG timeline + scrubber,
                 sun-vs-heading compass, moment card, optimizer bars, checkpoint table
```

## Key decisions
- **Valhalla first**: on Amherst→Chicago it returns 14.4 h vs 17.6 h from the OSRM demo profile; ~14 h matches common navigation estimates. OSRM remains a labeled fallback. No straight-line fallback.
- **Forecast semantics**: `timeformat=unixtime` removes timezone ambiguity. Instantaneous variables are interpolated between hours; precipitation, probability and gusts use the hour bin ending after the arrival time; direction and weather code use the nearest hour. Outside the returned window → `null` ("no forecast").
- **Sun conventions**: SunCalc azimuth (from south, positive west) converted to compass degrees. Visible sun: altitude > −0.833°. Glare zone: altitude ≤ 25° and within ±30° of heading; score = lowness × centering, severity thresholds 0.3 / 0.55. Clouds ≥ 85 % (or precipitation/fog) reduce expected severity by 2 levels, ≥ 60 % by 1; geometric severity is kept and shown.
- **Recorded snapshots** (`public/fixtures/*.json`) store normalized route + forecast series with `capturedAt`; the UI labels them everywhere. Used for offline demo and deterministic tests.
- **Wind**: meteorological FROM direction; crosswind = gust × |sin(from − heading)|. Advisory limits: 40 mph crosswind gust (car), 25 mph (high-profile vehicle, motorcycle). These are planning heuristics, not official thresholds.
