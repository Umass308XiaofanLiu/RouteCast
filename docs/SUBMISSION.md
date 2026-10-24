# GlarePilot — Hackachusetts 2026 submission pack

Copy-paste material for the SundAI form. Items marked **TODO (human)** must be completed by the team; nothing here is submitted automatically. A GitHub push alone is not a submission — the SundAI form must be submitted before **8:00 PM ET on 2026-10-24**.

## Project name

GlarePilot

## Tagline (≤ 120 characters)

Forecast weather and sun glare for the places and times you will actually be on a long US drive.

## Short description (~50 words)

GlarePilot plans long US drives: it routes the trip, projects when you reach each kilometer, and shows the forecast and sun glare for that place and time. Add an assumed traffic delay and see what changes. Animated condition icons, a 2D map and a 3D chase preview; synthetic demo scenarios are labeled.

## Full description of features and functionality

GlarePilot answers one question before a long drive: what weather and sun glare will I meet at the places and times I will actually be there?

It has two clearly labeled modes. **Real-data planning** retrieves a live route and forecast now and evaluates every point at its projected future arrival time; it is not a current-conditions dashboard, and recorded real-data snapshots are labeled with their retrieval time. **Manual demo scenarios** (storm-crosswind, sunset-glare, snow-fog-night, congestion-shift) lay deliberately hand-set synthetic weather and delay on a recorded real route; they call no weather, routing or traffic API (only map tiles load).

The user searches a US origin and destination (Open-Meteo geocoding) or picks a demo trip, then enters the departure in the origin's time zone. Valhalla on the FOSSGIS server (OSRM fallback) provides the route and routed times; no straight line is ever substituted. The route is resampled every 1 km, and each sample's arrival time includes optional breaks and an optional assumed delay. No live or predictive traffic source is connected (the free routers return free-flow times), so delay is the user's explicit assumption, spread over a chosen stretch; every later point's forecast hour and sun angle are recomputed.

Up to 40 checkpoints share one Open-Meteo request; each sample uses the forecast valid at its arrival time, and missing values stay missing. SunCalc sun position against the heading scores forward glare, low sun behind, twilight and night; clouds, rain and fog lower expected glare. Gusts become crosswind, with stricter limits for vans, trucks, RVs and motorcycles; rain, snow, ice, fog and thunderstorms are flagged.

A departure optimizer compares −3 h … +3 h with a transparent score, and a deterministic rules engine — not generative AI — gives prioritized advice with when, where, why and actions. The UI shows KPIs, a 2D Leaflet map with original animated condition icons (reduced-motion aware), a Canvas 3D chase preview of the planned route (simulated playback, not GPS), a timeline, compass and table. GlarePilot is a planning aid, not a safety system.

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
| Manual demo scenario (synthetic) | https://umass308xiaofanliu.github.io/glarepilot/?demo=congestion-shift |
| Manual demo scenario in 3D chase preview | https://umass308xiaofanliu.github.io/glarepilot/?demo=sunset-glare&view=3d |
| Demo video (< 3 min, public) | **TODO (human)** — upload the release video [glarepilot-demo.mp4](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts) and paste the public YouTube/Vimeo URL |

## Testing instructions for judges

No login, no account, no API key and no cost.

1. Open https://umass308xiaofanliu.github.io/glarepilot/.
2. Under "Try a demo trip", click a preset. Presets use live route and forecast data for **tomorrow**:
   - **Albany → Boston**, 6:45 AM — eastbound into the sunrise.
   - **Amherst → Chicago**, 8:00 AM — westbound, crosses from Eastern to Central time.
   - **Amherst → New York**, 3:30 PM — afternoon run south-west into the low sun.
3. Or type your own US origin and destination, set the departure (shown in the origin's time zone, up to 13 days ahead) and press **See my drive**.
4. If a public service is slow or down, click **Offline? Open a recorded snapshot** (or the button on the error card), or open a `?snapshot=` link: `chicago-sunset`, `boston-sunrise`, `nyc-evening`. Snapshots are labeled "Recorded real data — not current" with their retrieval time (2026-10-24 ~4:12 PM EDT, departures on 2026-10-25).
5. **Traffic delay assumption:** in the form, set Extra time to **+1 h** and Where to **Mid-route**, then press **See my drive**. The card **"What the assumed delay changes"** compares arrival, wet roads, glare, after-dark, crosswind and snow minutes with and without the delay. No traffic data is used — it is your assumption.
6. **Manual demo scenarios:** click **Manual demo scenarios** at the top of the side panel (or open `?demo=congestion-shift`). Pick one of the four scenarios. The strip says "Manual demo scenario — synthetic data"; weather and delay are hand-set, and only map tiles load. In **Delay shifts the weather**, the assumed 75 min delay pushes the New York arrival into the hand-set rain band and darkness.
7. **3D chase preview:** above the map, click **3D chase preview** (or open `?demo=sunset-glare&view=3d`). Press **Play**; scroll the mouse wheel, swipe sideways or use the arrow keys to look ahead or behind, then click **Return to playback position**. Use − / + for Close / Near / Far / Wide camera. Switch back to **2D overview** — both views share the selected time. It is a simulated playback of the plan, not GPS.
8. Click **Animation: on** to turn icon animations off; with the OS "reduce motion" setting they are off by default.

What to look at:

- The KPI strip and the provenance strip (live: "Real-data plan" with retrieval time and projected departure/arrival; snapshot: "Recorded real data — not current"; scenario: "Manual demo scenario — synthetic data").
- Map layers **Sun glare / Weather / Daylight**, the legend and the condition icons (placed only where a condition is projected).
- "Your drive, hour by hour": drag the scrubber and watch the moment card and the **Sun vs. your heading** compass.
- "What to expect & what to do": click a recommendation to highlight it on the map and timeline; each shows when, where and why.
- "When should I leave?": bars for −3 h … +3 h; **Try this departure** re-plans with the suggested time.
- Units toggle (°F·mi / °C·km), vehicle type (try Motorcycle for lower crosswind limits) and break plan.
- Arrival times for points in Central time are shown in CDT.

Local run and tests: see the [README](../README.md#quick-start) (`npm ci`, `npm run dev`, `npm test`, `npm run test:e2e`).

## How Kiro was used

**Tools.** GlarePilot was built in **Kiro CLI 2.34.0** (`kiro-cli chat`, the terminal agent) with the model claude-opus-5.5 at xhigh effort. The Kiro session also created the GitHub repository, connected it and pushed code using the GitHub CLI (`gh`), after the human approved the device-flow login. Kiro's native subagents (crew) ran an independent read-only review/test stage and parallel documentation and demo-video stages. The reviewer ran both test suites and reported four major and thirteen minor findings — for example a long severe sunset-glare stretch ranked below a one-minute glare blip, one geocoder label inserted into HTML without escaping, and unknown `?snapshot=` ids silently opening a different trip. The main agent fixed them and added regression tests. After the two data modes, the assumed-delay model, condition icons and the 3D chase preview were added, a **second independent Kiro subagent review of the deployed build** found no blockers; its majors were fixed — the "no network requests" wording for demo scenarios was false because OpenStreetMap map tiles still load, the mobile 3D HUD overlapped, and forecast wording appeared in synthetic mode. Parallel subagents were again used for the documentation and the demo video.

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
| Demo video < 3 min, public on YouTube/Vimeo/Facebook Video/Youku, shows the project working, no unlicensed music/trademarks | Narrated + captioned recording, the release video [glarepilot-demo.mp4](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts) (2:50, H.264 + AAC synthetic narration, no music), script [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md) | Human action needed (upload publicly, paste link) |
| Public GitHub repo with all source, assets and instructions | https://github.com/Umass308XiaofanLiu/glarepilot, [README](../README.md) | Done |
| `/.kiro` directory at repo root, not gitignored | `.kiro/steering/`, `.kiro/specs/`; `.gitignore` lists only `node_modules/`, `dist/`, `.env*`, `*.log`, `.DS_Store` | Done |
| Write-up on how Kiro was used | "How Kiro was used" above | Done (paste into form) |
| Working project access for judges, free of charge | https://umass308xiaofanliu.github.io/glarepilot/ (no login/keys) + recorded snapshots + manual demo scenarios (`?demo=`) | Done |
| Tests pass | 35 unit (`npm test`) and 13 E2E (`npm run test:e2e`) | Done |
| Honest data labeling | Two modes labeled; no live/predictive traffic claimed; 3D preview labeled "not GPS" | Done |

## Remaining human-only items

1. Log in to SundAI and open the Hackachusetts submission form.
2. Add team members (max 4) — also fill the Team section in the README.
3. Select the track (recommended: Civic Action, V3; the human decides).
4. Upload the demo video as **public** to YouTube or Vimeo — the release video [glarepilot-demo.mp4](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts) or your own narrated recording following [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md) — and check it plays while logged out.
5. Paste the repo, live demo and video links, the description and the Kiro write-up into the form; add the video link to the README.
6. Press **Submit** before 8:00 PM ET and confirm the submission appears on SundAI.
7. Optional: choose a project license and add a `LICENSE` file.
8. Optional: log in to Cloudflare if a Cloudflare Pages mirror is wanted (not required; GitHub Pages is live).
