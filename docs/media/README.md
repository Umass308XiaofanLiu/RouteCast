# GlarePilot demo video

| File | What it is |
| --- | --- |
| `glarepilot-demo.mp4` | Screen recording, 2:09 (128.77 s), 1440×900, H.264, 30 fps, no audio, 10.9 MB (10,858,434 bytes) |
| `glarepilot-demo.en.srt` | The same English captions as a sidecar file (18 cues) |
| `glarepilot-demo-poster.png` | Poster frame (Amherst → Chicago real-data plan, map with condition icons) taken from the video |
| `recording-log.json` | Machine log of the run: provenance text per scene, delay-card text, 3D HUD text, caption timings |

**Not yet public.** The human still needs to upload the MP4 (and optionally the SRT) to a public video host and link it in the submission. Nothing was uploaded by the recording script.

## Capture

- Captured 2026-10-24, about 6:51–6:53 PM EDT, by `node scripts/record-demo.mjs` against the live GitHub Pages site <https://umass308xiaofanliu.github.io/glarepilot/> (deployed build 8ad2b12).
- Headless system Chrome (`--no-sandbox --disable-gpu`) with a fresh temporary profile; frames via the DevTools screencast, rebuilt to constant 30 fps with ffmpeg.
- The page viewport is 1440×810; captions sit in a separate 90 px bar under the page, so they never cover the app.
- The script overlays a small round pointer so viewers can see clicks. The app's code and data were not changed.
- The earlier phone-layout and units scenes were dropped in this version to keep the video short.

## Scenes and data source

| Time | Scene | Data |
| --- | --- | --- |
| 0:00–0:09 | Empty state, pitch, Real-data / Manual-demo mode switch | — |
| 0:09–0:43 | Real-data planning, Amherst → Chicago, 8:00 AM Sun Oct 25: provenance strip ("Valhalla route and Open-Meteo forecast retrieved Sat 6:51 PM EDT, Oct 24 … Each point uses conditions at its projected arrival time"), KPIs (14h 24m, arrive 9:24 PM CDT), map with condition icons; then an assumed +1 h mid-route delay → delay card (arrival 9:24 → 10:24 PM CDT, 17 of 34 checkpoints move to a different forecast hour) | Live (badge "Live forecast · Valhalla route"); the delay is the user's assumption, not traffic data |
| 0:43–0:52 | "When should I leave?" departure optimizer | Same live result |
| 0:52–1:59 | Manual demo scenarios: "Delay shifts the weather" (assumed 75 min delay, delay card + map icons), "Heavy rain + crosswind" (rain/wind icons), "Westbound sunset glare" → 3D chase preview: scroll-ahead (HUD "Previewing ahead: +14 min · 15 mi"), return to playback position, Play ~5 s and pause; then the Animation toggle → "Animation: off" | Synthetic (hand-set weather/delay on a recorded real Valhalla route; badge "Manual demo · synthetic data"; no weather/route API calls) |
| 1:59–2:09 | Closing caption: data sources, "Manual demos use hand-set synthetic data. Planning aid, not a safety system. Built with Kiro." | — |

The recorded-snapshot fallback was not needed. Numbers in the real-data captions are read from the app's UI during the recording; re-running the script uses that moment's live forecast, so they can change.
