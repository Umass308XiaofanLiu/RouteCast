# GlarePilot — demo video script (target 2:40, hard limit < 3:00)

## Before recording

- Clean browser window at ~1440 px wide, zoom 100 %, no unrelated tabs or notifications.
- Scene 1 uses live data, so numbers differ from run to run: describe what is on screen rather than quoting values. If public services are down, use `?snapshot=chicago-sunset` and say "recorded real data" instead of "live".
- Manual demo scenarios are reproducible: their weather and delay are hand-set synthetic values on a recorded real route. Say "synthetic" on camera at least once.
- Audio: voice only or none. No third-party music, logos or trademarks. Upload as **Public** and check playback while logged out.

## Scenes

| Time | Screen and exact clicks | Narration |
|---|---|---|
| 0:00–0:12 | Open https://umass308xiaofanliu.github.io/glarepilot/. Show the header, the **Real-data planning / Manual demo scenarios** switch and the "Plan a drive" card. | "On a long drive, what matters is the weather and the sun where you'll be hours from now. GlarePilot plans that — free, no login, no keys." |
| 0:12–0:35 | Under "Try a demo trip", click **Amherst → New York** (tomorrow 3:30 PM). Point to the provenance strip: "Real-data plan … retrieved [time]", then the projected departure and arrival. | "This is real forecast planning: a live Valhalla route and the Open-Meteo forecast, retrieved just now. Each point uses the forecast for its projected arrival time — departure plus routed drive time. It is not a current-conditions dashboard." |
| 0:35–0:55 | In the form, set **Extra time = +1 h**, **Where = Mid-route**, press **See my drive**. Scroll to the card **"What the assumed delay changes"**. | "There's no live or predictive traffic feed — the free routers return free-flow times. So delay is my own assumption. Add an hour mid-route and every later point is reached later: its forecast hour and sun angle are recomputed, and this card shows what changes." |
| 0:55–1:20 | Click **Manual demo scenarios**. Click **Delay shifts the weather** (`congestion-shift`). Show the strip "Manual demo scenario — synthetic data", the delay card (arrival later, wet minutes up, after dark up) and the pink delay icons on the map. | "Manual demo scenarios use hand-set synthetic weather on a recorded real route — no weather, routing or traffic API, only map tiles. Here, an assumed 75-minute delay pushes the New York arrival into the rain band and into darkness." |
| 1:20–1:40 | Click **Heavy rain + crosswind** (`storm-crosswind`). Zoom the map into the middle of the route; point to a rain icon and a wind icon in the condition legend and on the route. | "Storm and crosswind: icons appear only where that condition is projected at your arrival time, and they're thinned as you zoom. The vehicle is a van, so the crosswind limit is stricter." |
| 1:40–2:15 | Click **Westbound sunset glare** (`sunset-glare`), then **3D chase preview**. Press **Play**, then **Pause** near the Lake Erie glare. Scroll the mouse wheel to preview ahead, then behind; click **Return to playback position**. Press **+** once (Far). Switch to **2D overview**. | "The 3D chase preview projects the actual route from behind a simulated playback position — it's not GPS, and there's no terrain. Sky, sun, clouds and night come from that point's projected conditions. Scrolling previews ahead without moving the playback; Return brings it back. Both views share the same selected time." |
| 2:15–2:28 | Click **Animation: on** so it reads **Animation: off**; click again to turn it on. | "Animations are slow and never flash. You can switch them off, and they're off by default if your system asks for reduced motion." |
| 2:28–2:40 | Show the footer attributions, then briefly the GitHub repo's `.kiro/` folder. | "Weather is forecast, sun and glare are computed, arrival times are free-flow estimates, delays are assumptions, and nothing is live. It's a planning aid, not a safety system — built spec-first with Kiro." |

Total ≈ 2:40, leaving 20 s of margin under 3:00. If running long, shorten the storm-crosswind scene.

## 30-second live pitch

"Weather apps show a city; route apps show weather right now. On a long drive what matters is the weather and the sun where you'll be hours from now. GlarePilot routes your trip, projects when you reach every kilometer, and pulls the forecast for that place and time. It computes the sun against your heading to find glare, flags rain, snow, crosswinds and darkness, and lets you add an assumed traffic delay to see what shifts — because no free traffic forecast exists. Synthetic demo scenarios are labeled as synthetic, and a 3D chase preview replays the plan. Free, keyless, built spec-first in Kiro."
