# YouTube upload kit — GlarePilot demo

> **Renamed 2026-10-25:** the project is now RouteCast; the repository is https://github.com/Umass308XiaofanLiu/RouteCast and the live demo is https://umass308xiaofanliu.github.io/RouteCast/. The `/glarepilot/` demo links below are the historical ones and no longer resolve.

File to upload: `glarepilot-demo.mp4` from the GitHub release https://github.com/Umass308XiaofanLiu/glarepilot/releases/tag/v1.0-hackachusetts.
Subtitles: `docs/media/glarepilot-demo.en.srt` (English). Thumbnail (optional): `docs/media/glarepilot-demo-poster.png`.

## Title (≤ 100 characters)

GlarePilot — weather & sun glare where and when you'll actually drive (Hackachusetts 2026 demo)

## Description

GlarePilot is a free, keyless trip planner that checks weather and sun glare along your route at the time you will actually reach each point.

Live demo: https://umass308xiaofanliu.github.io/glarepilot/
Source code: https://github.com/Umass308XiaofanLiu/glarepilot

What the video shows
- Real-data planning: a live Valhalla/OSRM route and a live Open-Meteo forecast, retrieved at recording time; every point along the route is evaluated at its projected arrival time.
- Explicit delay assumptions: traffic is not predicted — you state a delay (here +1 h) and later points are re-timed.
- Advice cards and "When should I leave?" (same route, departures −3 h … +3 h, transparent exposure score).
- Manual demo scenarios — clearly labelled "Manual demo · synthetic data": hand-set synthetic weather on a recorded real route, with no weather or route API calls.
- 2D map overview and a 3D chase preview, which is simulated playback of the planned route, not GPS.

Disclosures
- Manual demo scenarios use hand-set synthetic data, not real forecasts.
- GlarePilot is a planning aid, not a safety system.
- The narration is a synthetic text-to-speech voice (Piper TTS, en_US-ljspeech-medium voice), not a recording of a person.

Data and attributions
- Weather data by Open-Meteo.com (CC BY 4.0)
- Map data © OpenStreetMap contributors
- Routing: Valhalla (FOSSGIS public instance) and OSRM
- Sun position: SunCalc

Built with Kiro for Hackachusetts 2026.

## Upload steps

1. Go to https://studio.youtube.com → Create → Upload videos → select `glarepilot-demo.mp4`.
2. Details: paste the title and description above. Optionally upload `glarepilot-demo-poster.png` as the thumbnail (custom thumbnails require a verified account).
3. Audience: select "No, it's not made for kids".
4. Show more → "Altered content": the narration is an AI-generated (synthetic) voice, but it does not imitate a real person and the video does not depict realistic events that did not happen; the app screen is a real recording. Under YouTube's guidance this kind of use does not strictly require the label; selecting "Yes" is the conservative choice and is acceptable — either way the description already discloses the synthetic voice.
5. Show more → Language: English. Subtitles: Add → Upload file → "With timing" → choose `glarepilot-demo.en.srt`, language English → Done.
6. Video elements / Checks: no action needed; wait for the copyright check to finish.
7. Visibility: Public → Publish.
8. Copy the video URL (https://youtu.be/…) and paste it into the SundAI submission and into the README hero link (main agent / human; this kit does not change the README).
