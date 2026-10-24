# GlarePilot — Hackachusetts 2026 submission pack

Copy-paste material for the SundAI form. Items marked **TODO (human)** must be completed by the team; nothing here is submitted automatically. A GitHub push alone is not a submission — the SundAI form must be submitted before **8:00 PM ET on 2026-10-24**.

## Project name

GlarePilot

## Tagline (≤ 120 characters)

Forecast weather and sun glare for the places and times you will actually be on a long US drive.

## Short description (~50 words)

GlarePilot is a free web app for planning long US drives. It routes your trip, works out when you will reach each kilometer, and shows the forecast weather and sun position for that place and time. It flags sunrise/sunset glare, rain, snow, wind and darkness, explains why, and suggests a better departure time.

## Full description of features and functionality

GlarePilot answers one question before a long drive: what weather and sun glare will I meet at the places and times I will actually be there?

The user searches a US origin and destination (Open-Meteo geocoding) or picks a demo trip, then enters the departure as wall-clock time in the origin's time zone. GlarePilot requests a driving route with per-segment routed travel times from Valhalla on the FOSSGIS public server, falling back to the OSRM demo server; it never substitutes a straight line. The route is resampled every 1 km with a smoothed heading, and each sample gets its arrival time, including an optional break plan.

Up to 40 checkpoints share one Open-Meteo multi-location hourly forecast request. Each sample uses the forecast valid at its arrival time; values outside the forecast window are shown as missing, never invented. SunCalc gives the sun's altitude and azimuth, which are compared with the heading to score forward glare (sun visible, at most 25° high and within 30° of the heading), low sun behind the driver, twilight and night. Forecast cloud cover, precipitation and fog lower the expected glare while the geometric risk stays visible. Wind direction and gusts become crosswind and headwind components, with stricter limits for vans, trucks, RVs and motorcycles. Rain, heavy rain, snow, ice, fog and thunderstorms are flagged along the route.

A departure optimizer re-evaluates the same route from three hours earlier to three hours later with a transparent weighted exposure score. A deterministic rules engine — not generative AI — turns all of this into prioritized recommendations, each with when, where, why (the triggering values) and concrete actions.

The interface shows KPIs, a Leaflet map with glare, weather and daylight layers, an hour-by-hour timeline with a scrubber, a sun-versus-heading compass, the optimizer, and a checkpoint table, with US/metric units and a mobile layout. Recorded snapshots, clearly labeled with their capture time, keep the demo working if public services are unavailable. GlarePilot is a planning aid, not a safety system.

## Track

**Recommended primary track: Civic Action — "V3 Safer and connected places" ("The last mile is a street, a bike, or a crash").** Final choice: **TODO (human)**.

Rationale:

- GlarePilot targets road safety on public streets and highways: it anticipates predictable conditions (low sun ahead, crosswinds, snow, darkness) and tells drivers when and where to expect them before they leave.
- It is free, needs no account or key, and runs in any browser, so it is accessible to the public.
- It also fits the Civic Action theme of community emergency readiness through clear severe-weather communication, while stating that it does not replace official alerts or instructions.

Why **Energy & Climate Tech** ("C1 Resilient communities in a changing climate") is a weaker fit: GlarePilot uses short-term weather forecasts for individual trip planning. It does not model climate change, emissions, energy use or long-term community resilience, so presenting it under that track would overstate its scope.

## Links

| Item | Value |
|---|---|
| Public GitHub repository | https://github.com/Umass308XiaofanLiu/glarepilot |
| Live demo (free, no login) | https://umass308xiaofanliu.github.io/glarepilot/ |
| Live demo trip | https://umass308xiaofanliu.github.io/glarepilot/?preset=chicago-sunset |
| Recorded snapshot (offline fallback) | https://umass308xiaofanliu.github.io/glarepilot/?snapshot=chicago-sunset |
| Demo video (< 3 min, public) | **TODO (human)** — upload [docs/media/glarepilot-demo.mp4](media/glarepilot-demo.mp4) and paste the public YouTube/Vimeo URL |

## Testing instructions for judges

No login, no account, no API key and no cost.

1. Open https://umass308xiaofanliu.github.io/glarepilot/.
2. Under "Try a demo trip", click a preset. Presets use live route and forecast data for **tomorrow**:
   - **Albany → Boston**, 6:45 AM — eastbound into the sunrise.
   - **Amherst → Chicago**, 8:00 AM — westbound, crosses from Eastern to Central time.
   - **Amherst → New York**, 3:30 PM — afternoon run south-west into the low sun.
3. Or type your own US origin and destination, set the departure (shown in the origin's time zone, up to 13 days ahead) and press **See my drive**.
4. If a public service is slow or down, click **Offline? Open a recorded snapshot** (or the button on the error card), or open a `?snapshot=` link: `chicago-sunset`, `boston-sunrise`, `nyc-evening`. Snapshots are labeled "Recorded snapshot" with their capture time (2026-10-24 ~4:12 PM EDT, departures on 2026-10-25).

What to look at:

- The KPI strip and the provenance badge ("Live forecast · Valhalla route" or "Recorded snapshot").
- Map layers **Sun glare / Weather / Daylight** and the legend.
- "Your drive, hour by hour": drag the scrubber and watch the moment card and the **Sun vs. your heading** compass.
- "What to expect & what to do": click a recommendation to highlight it on the map and timeline; each shows when, where and why.
- "When should I leave?": bars for −3 h … +3 h; **Try this departure** re-plans with the suggested time.
- Units toggle (°F·mi / °C·km), vehicle type (try Motorcycle for lower crosswind limits) and break plan.
- Arrival times for points in Central time are shown in CDT.

Local run and tests: see the [README](../README.md#quick-start) (`npm ci`, `npm run dev`, `npm test`, `npm run test:e2e`).

## How Kiro was used

**Tools.** GlarePilot was built in **Kiro CLI 2.34.0** (`kiro-cli chat`, the terminal agent) with the model claude-opus-5.5 at xhigh effort. The Kiro session also created the GitHub repository, connected it and pushed code using the GitHub CLI (`gh`), after the human approved the device-flow login. Kiro's native subagents (crew) ran an independent read-only review/test stage and parallel documentation and demo-video stages. The reviewer ran both test suites and reported four major and thirteen minor findings — for example a long severe sunset-glare stretch ranked below a one-minute glare blip, one geocoder label inserted into HTML without escaping, and unknown `?snapshot=` ids silently opening a different trip. The main agent fixed them and added regression tests.

**Spec-driven development vs. vibe coding.** The work followed a spec in `.kiro/specs/route-time-weather-glare/`:

- `requirements.md`: requirements R1–R6 (trip input, routed timing, time-aligned forecast, sun glare, driving implications and guidance, presentation) with numbered acceptance items such as R3.2 "times outside the forecast window are reported as no forecast" and R4.2 the glare geometry.
- `design.md`: the architecture pipeline and key decisions, for example choosing Valhalla over OSRM after measuring Amherst → Chicago at 14.4 h vs 17.6 h, forecast hour semantics with `timeformat=unixtime`, and sun-angle conventions.
- `tasks.md`: an implementation checklist with each task mapped to requirement IDs.

The spec gave the agent fixed acceptance targets (e.g. no straight-line route, no invented forecast values), which the unit and E2E tests check directly.

**Agent hooks.** Not used.

**Steering docs.** `.kiro/steering/product.md` sets honesty rules: label forecasts as forecasts, not observations; use routed times only; label recorded snapshots with capture time; never describe the rules engine as generative AI; never promise safety; show missing data as missing. `.kiro/steering/tech.md` fixes the stack, the UTC-milliseconds time convention, compass-angle and wind-direction conventions, and the testing approach (node:test + fast-check, puppeteer-core with an isolated profile and loopback server).

**MCP.** No MCP servers were used.

**Property-based testing.** `tests/unit/math.test.mjs` uses fast-check for: wall time → UTC → wall time round trips across 5 US time zones including DST transitions; `angleDiff` symmetry, bounds and full-turn invariance; glare severity never increasing as the sun moves away from the heading or climbs; crosswind never exceeding wind speed. A separate explicit DST unit test caught a real bug in spring-forward gap handling in `src/lib/time.js`, which was then fixed.

**Kiro powers.** Not used.

Also not used: Kiro IDE and Kiro Web. The `chat.enableWorkflows` and `chat.enableSubagent` preferences were saved, but the Workflows feature was not active in this session, so no workflows were used.

## Requirements checklist

| Official requirement | Evidence | Status |
|---|---|---|
| Submit on SundAI before 8 PM ET (GitHub push is not a submission) | SundAI form | Human action needed |
| Team members added (max 4) | SundAI form | Human action needed |
| Built with Kiro | `.kiro/` in repo; this write-up | Done |
| Identify one track | Recommendation above (Civic Action, V3) | Human action needed (select on form) |
| Text description of features/functionality | "Full description" above | Done (paste into form) |
| Demo video < 3 min, public on YouTube/Vimeo/Facebook Video/Youku, shows the project working, no unlicensed music/trademarks | Captioned recording [docs/media/glarepilot-demo.mp4](media/glarepilot-demo.mp4) (H.264, no audio/music), script [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Human action needed (upload publicly, paste link) |
| Public GitHub repo with all source, assets and instructions | https://github.com/Umass308XiaofanLiu/glarepilot, [README](../README.md) | Done |
| `/.kiro` directory at repo root, not gitignored | `.kiro/steering/`, `.kiro/specs/`; `.gitignore` lists only `node_modules/`, `dist/`, `.env*`, `*.log`, `.DS_Store` | Done |
| Write-up on how Kiro was used | "How Kiro was used" above | Done (paste into form) |
| Working project access for judges, free of charge | https://umass308xiaofanliu.github.io/glarepilot/ (no login/keys) + recorded snapshots | Done |

## Remaining human-only items

1. Log in to SundAI and open the Hackachusetts submission form.
2. Add team members (max 4) — also fill the Team section in the README.
3. Select the track (recommended: Civic Action, V3).
4. Upload [docs/media/glarepilot-demo.mp4](media/glarepilot-demo.mp4) (captioned screen recording of the live site, under 3 min, no audio) as **public** to YouTube or Vimeo — or record your own narrated version with [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md) — and check it plays while logged out.
5. Paste the repo, live demo and video links, the description and the Kiro write-up into the form; add the video link to the README.
6. Press **Submit** before 8:00 PM ET and confirm the submission appears.
7. Optional: choose a project license and add a `LICENSE` file.
8. Optional: log in to Cloudflare if a Cloudflare Pages mirror is wanted (not required; GitHub Pages is live).
