# GlarePilot — demo video script (target 2:30, hard limit < 3:00)

## Before recording

- Use a clean browser window at ~1440 px wide, zoom 100 %. Close unrelated tabs and notifications.
- **Recommended:** record from recorded snapshots so the numbers match this script and do not depend on public servers:
  - https://umass308xiaofanliu.github.io/glarepilot/?snapshot=boston-sunrise
  - https://umass308xiaofanliu.github.io/glarepilot/?snapshot=chicago-sunset
  The banner will say "Recorded snapshot — not current conditions"; keep it visible and say so once.
- Scene 1 shows the live preset buttons once. Live results change with each forecast run, so for live footage describe what is on screen rather than reading the numbers below.
- Values quoted below come from the recorded snapshots (captured 2026-10-24 ~4:12 PM EDT, departures on 2026-10-25).
- Audio: voice only, or no music at all. Do not add third-party music, logos or trademarks. Upload as **Public** on YouTube or Vimeo and check playback while logged out.

## Scenes

| Time | Screen and exact clicks | Narration |
|---|---|---|
| 0:00–0:12 | Open https://umass308xiaofanliu.github.io/glarepilot/. Show the header and the "Plan a drive" card; hover the three "Try a demo trip" presets. | "Low sun in your eyes and weather you drive into later are predictable. GlarePilot shows the forecast and the sun for where and when you'll actually be on a long US drive. It's free, no login, no keys." |
| 0:12–0:35 | Open `?snapshot=boston-sunrise` (Albany → Boston, Sun 6:45 AM EDT). Point to the "Recorded snapshot" badge, then the KPI strip. | "Albany to Boston, leaving at 6:45 in the morning. This is a recorded snapshot, labeled with its capture time. The route and drive times come from Valhalla routing; the weather is the Open-Meteo forecast for each point's arrival time." |
| 0:35–0:55 | In "What to expect & what to do", click the top card **"ESE-bound sunrise glare 11 mi from Pittsfield, MA"** (7:19–8:35 AM EDT). The map highlights the stretch; the timeline jumps there. | "Heading east-southeast at sunrise, the sun sits low and almost straight ahead for over an hour. Every recommendation says when, where and why — sun altitude, angle to your heading, cloud cover — and what to do." |
| 0:55–1:10 | Drag the timeline scrubber through the glare band. Show the moment card and the **Sun vs. your heading** compass moving. | "Scrubbing the drive, the compass shows the sun against my heading at each kilometer. Inside 30 degrees and under 25 degrees high counts as glare; lower and more centered is worse." |
| 1:10–1:30 | Open `?snapshot=chicago-sunset` (Amherst → Chicago, 8:00 AM EDT). Point to KPIs: Drive 14h 24m, Arrive 9:24 PM CDT. Scroll the timeline to its end: EDT then CDT labels. | "Now a 14-hour drive west. Arrival is 9:24 PM Central time — each point is shown in its own time zone, and arrival is departure plus routed driving time, not a straight line." |
| 1:30–1:50 | Click map layer **Weather**, then **Daylight**, then back to **Sun glare**. Click the **"WSW-bound sunset glare 13 mi from Lorain, OH"** card. | "Map layers switch between glare, weather and daylight. Westbound in Ohio the sun is low ahead in the afternoon, but forecast clouds soften it — the geometric risk stays visible next to the expected glare. Over three hours of this drive are after dark." |
| 1:50–2:10 | Scroll to **"When should I leave?"**; show the −3 h … +3 h bars. Back in the advice list, click **Try this departure** on "Leave 1 h 30 min earlier: Sun 6:30 AM EDT". KPIs update (arrival 7:54 PM CDT). | "The optimizer re-runs the same route for departures three hours earlier to three hours later with a transparent weighted score. Leaving at 6:30 cuts the exposure and gets in at 7:54. It's a heuristic for comparing departures, not a crash-risk model." |
| 2:10–2:20 | Switch to a phone-sized view (browser device toolbar, 390 px) and scroll the stacked layout. Optionally flip units to **°C · km** and vehicle to **Motorcycle**. | "It works on a phone, in US or metric units, with stricter crosswind limits for vans and motorcycles." |
| 2:20–2:30 | Return to desktop; show the footer attributions, then the GitHub repo `.kiro/` folder briefly. | "The guidance is a deterministic rules engine, not generative AI, and it's a planning aid, not a safety system. Built with Kiro from a spec and steering docs, with property-based tests. Code and live demo are linked below." |

Total ≈ 2:30, leaving 30 s of margin under 3:00. If running long, drop the units/vehicle toggle in the mobile scene.

## 30-second live pitch

"Weather apps show a city; route apps show weather right now. But on a long drive, what matters is the weather and the sun where you'll be hours from now. GlarePilot routes your trip, works out when you reach every kilometer, and pulls the forecast for that place and time. It computes the sun against your heading to find sunrise and sunset glare, flags rain, snow, crosswinds and darkness, and tells you when, where and why — with a better departure time when one exists. It's free, runs in any browser, uses a deterministic rules engine instead of AI, and was built spec-first in Kiro."
