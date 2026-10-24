# GlarePilot 🌅

A US long-distance driving companion that shows you the **forecast weather for where and *when* you'll actually be** — not just the current weather along the route. Its key differentiator is **sun-glare prediction**: it computes the sun's position relative to your driving direction at each point's arrival time, flagging classic **eastbound-sunrise** and **westbound-sunset** glare.

Built for Hackachusetts (Oct 24, 2026).

## What it does

Given an **origin, destination, and departure time**, GlarePilot:

1. Computes the driving route and per-segment travel times.
2. Estimates your **ETA at waypoints** along the route.
3. Pulls the **forecast** (not current) weather at each waypoint for its arrival time: temperature, rain/snow, wind speed + direction.
4. Computes the **sun's azimuth and altitude** at each waypoint/time and compares it to your driving heading to score **glare severity (0–3)**.
5. Generates a grounded, rule-based **driving briefing** with actionable guidance.

## The sun-glare method

Using [SunCalc](https://github.com/mourner/suncalc):
- Get sun **altitude** (height above horizon) and **azimuth** (compass direction) at `(lat, lon, time)`.
- Compute the **driving bearing** from consecutive route points.
- **Glare risk is high** when the sun is **low** (≤ ~25° altitude, worst ≤ 10°) **and ahead** of the driver (within ~±45°, worst ≤ ±20°).
- Eastbound at sunrise and westbound at sunset are called out explicitly.

See `src/glare.js`.

## Stack & APIs

| Concern | Choice | Key? | Cost |
|---|---|---|---|
| Routing + geometry + duration | OSRM demo server | No | Free |
| Forecast weather (hourly) | [Open-Meteo](https://open-meteo.com/) | No | Free |
| Sun position | SunCalc (local) | No | Free |
| Map | Leaflet + OpenStreetMap tiles | No | Free |
| Briefing | Local rule-based generator | No | Free |

**$0 and zero required API keys** for a working demo. If a network service is unreachable, the app falls back to clearly-labeled **simulated demo data** (never presented as real).

## Run it

```bash
npm install
npm run dev
```

Open the printed local URL. Try **Amherst, MA → New York, NY** or **Amherst, MA → Chicago, IL** with an early-morning or late-afternoon departure to see glare alerts.

## Challenge-track fit (verified)

Hackachusetts 2026 has four areas: **Biotech & Healthcare, Robotics & Hardware, Energy & Climate Tech, Civic Action** (source: cics.umass.edu).

GlarePilot is pitched primarily to **Civic Action** — sun glare is a documented crash factor, and this is a public-good road-safety tool. A secondary **climate-adaptation** narrative (travel resilience under weather) can bridge to Energy & Climate Tech, but the safety framing is the honest best fit.

## Data honesty

Observations and forecasts are kept distinct, and any simulated/demo values are explicitly labeled in the UI and briefing.
