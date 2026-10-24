# GlarePilot demo video

| File | What it is |
| --- | --- |
| `glarepilot-demo.mp4` | Screen recording, 2:45 (165.33 s), 1440×900, H.264 High, 30 fps, no audio, 14.1 MB |
| `glarepilot-demo.en.srt` | The same English captions as a sidecar file (24 cues) |
| `glarepilot-demo-poster.png` | Poster frame (Albany → Boston, glare map layer) taken from the video |
| `recording-log.json` | Machine log of the run: provenance badge and KPI text per scene, caption timings |

**Not yet public.** The human still needs to upload the MP4 (and optionally the SRT) to a public video host and link it in the submission. Nothing was uploaded by the recording script.

## Capture

- Captured 2026-10-24, about 4:50–4:53 PM EDT, by `node scripts/record-demo.mjs` against the live GitHub Pages site <https://umass308xiaofanliu.github.io/glarepilot/>.
- Headless system Chrome with a fresh temporary profile; frames via the DevTools screencast, rebuilt to constant 30 fps with ffmpeg.
- The page viewport is 1440×810; captions sit in a separate 90 px bar under the page, so they never cover the app.
- The script overlays a small round pointer so viewers can see clicks. The app's code and data were not changed.

## Scenes and data source

All three trip runs used **live data**: the app showed the badge "Live forecast · Valhalla route", for departures on Sun Oct 25, 2026. The recorded-snapshot fallback was not needed, so no scene shows snapshot data.

| Time | Scene | Data |
| --- | --- | --- |
| 0:00–0:17 | Empty state, pitch, demo-trip list | — |
| 0:17–0:57 | Albany → Boston, 6:45 AM (eastbound sunrise): KPIs (2h 49m, arrive 9:34 AM EDT, 35 min sun glare), top sunrise-glare recommendation, glare map layer, timeline scrub, sun-vs-heading compass ("Severe glare") | Live |
| 0:57–1:59 | Amherst → Chicago, 8:00 AM (westbound sunset): KPIs (14h 24m, arrive 9:24 PM CDT), Sun glare → Weather → Daylight layers, sunset-glare recommendation highlighted on the map, departure optimizer, "Try this departure" (leave 1 h earlier: after dark 3h 14m → 2h 9m, arrive 8:24 PM CDT), checkpoint table | Live |
| 1:59–2:06 | Units switch to °C · km and back | (same live result) |
| 2:06–2:35 | Phone layout, 390×844: Amherst → Chicago run again on a phone viewport | Live |
| 2:35–2:45 | Closing caption: data sources, "Planning aid, not a safety system. Built with Kiro." | (same live result) |

The numbers in the captions are read from the app's UI during the recording. Re-running the script produces a new video with that day's live forecast, so those numbers can change.
