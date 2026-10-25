# GlarePilot demo video

> **Renamed 2026-10-25:** the project is now RouteCast; the repository is https://github.com/Umass308XiaofanLiu/RouteCast and the live demo is https://umass308xiaofanliu.github.io/RouteCast/. The `/glarepilot/` demo links below are the historical ones and no longer resolve.

| File | What it is |
| --- | --- |
| `the GitHub release asset (https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts)` (not in the repo) | Narrated screen recording, 2:50 (169.90 s), 1440×900 H.264 30 fps + AAC stereo 48 kHz (128 kbps target), 15,875,943 bytes. The main agent publishes it as a GitHub release asset; MP4s are not committed. |
| `glarepilot-demo.en.srt` | English captions, 22 cues — the same text that is burned into the video |
| `TRANSCRIPT.md` | Plain narration transcript with timestamps |
| `glarepilot-demo-poster.png` | Poster frame (1440×900): live Amherst → Chicago plan, "Live forecast · Valhalla route" badge, map with condition icons |
| `youtube.md` | YouTube title, description, attributions and exact upload steps |
| `recording-log.json` | Machine log: provenance text, delay-card text, 3D HUD text, caption and narration-cue timings |

**Not yet public.** The human still needs to upload the video to YouTube (see `youtube.md`) and put the link into SundAI and the README. Nothing was uploaded by the recording script.

## Capture

- Recorded 2026-10-24, 7:01–7:04 PM EDT, by `node scripts/record-demo.mjs` against the live GitHub Pages site <https://umass308xiaofanliu.github.io/glarepilot/> (deployed build 8ad2b12). The new "3D terrain" view is not part of this recording.
- Headless system Chrome (`--no-sandbox --disable-gpu`) with a fresh temporary profile; frames via the DevTools screencast, rebuilt to constant 30 fps with ffmpeg.
- Page viewport 1440×810; captions sit in a separate 90 px bar under the page, so they never cover the app. A small round pointer is overlaid by the script; the app's code and data are unchanged.
- Timing: each caption cue is spoken; the script waits until a cue's audio has ended (+0.45 s) before starting the next cue, so narration lines never overlap. The audio is the per-cue WAVs placed at their caption start times, mixed, loudness-normalized (−16 LUFS), AAC 128 kbps. No music.
- Check: overall mean volume −20.1 dB, max −1.0 dB (ffmpeg volumedetect); speech present at 0–10 s, 100–110 s and 165–170 s.

## Narration voice

- Engine: Piper TTS `piper-tts` 1.3.0 (offline, installed in a temporary venv; GPL-3.0-or-later — the engine license applies to the software, not to generated audio).
- Voice: `en_US-ljspeech-medium` from <https://huggingface.co/rhasspy/piper-voices> (repository license: MIT). Model card: trained from scratch on the LJ Speech dataset, dataset license "public domain" (<https://keithito.com/LJ-Speech-Dataset/>). Single generic US English female voice; not an imitation of any specific person.
- The narration is disclosed as a synthetic TTS voice in `TRANSCRIPT.md` and `youtube.md`.

## Scenes and data source

| Time | Scene | Data |
| --- | --- | --- |
| 0:00–0:21 | Problem statement, pitch, Real-data / Manual-demo mode switch | — |
| 0:21–0:59 | Real-data planning, preset Amherst → Chicago, 8:00 AM Sun Oct 25: provenance strip ("Valhalla route and Open-Meteo forecast retrieved Sat 7:01 PM EDT, Oct 24 … Each point uses conditions at its projected arrival time"), KPIs (14h 24m, arrive 9:24 PM CDT), map colored by glare with condition icons; assumed +1 h mid-route delay → delay card (arrival 9:24 → 10:24 PM CDT, 17 of 34 checkpoints move to a different forecast hour) | Live (badge "Live forecast · Valhalla route"); the delay is the user's assumption, not traffic data |
| 0:59–1:22 | Advice cards ("What to expect & what to do") and "When should I leave?" optimizer, best option marked | Same live result |
| 1:22–2:05 | Manual demo scenarios: "Delay shifts the weather" (+75 min), "Heavy rain + crosswind", "Snow, fog and night" | Synthetic (hand-set weather/delay on a recorded real route; badge "Manual demo · synthetic data"; no weather/route API calls) |
| 2:05–2:31 | "Westbound sunset glare" → 3D chase preview: wheel preview (HUD "Previewing ahead: +14 min · 15 mi"), Return to playback position, Play ~4.5 s and pause | Synthetic; simulated playback, not GPS |
| 2:31–2:50 | Closing: data sources; "A planning aid, not a safety system. Manual demos use hand-set data. Built with Kiro for Hackachusetts 2026." | — |

Live numbers come from the app's UI at recording time; re-running the script uses that moment's forecast, so they can change. If the live request fails, the script now stops instead of narrating "retrieved live" over a snapshot.

Earlier captions-only version (no audio, 128.8 s, recorded 6:51 PM before the latest small UI fixes): `glarepilot-demo-captions-only.mp4` in the [v1.0-hackachusetts release](https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts).
