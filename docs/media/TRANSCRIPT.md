# GlarePilot demo — narration transcript

Narration is a synthetic text-to-speech voice (Piper, `en_US-ljspeech-medium`). Captions show the same words; a few on-screen captions use written forms (for example “8:00 AM”, “−3 h … +3 h”, “(synthetic)”).

- [00:00] Long drives go wrong in predictable ways: low sun in your eyes, a storm at the wrong hour, or darkness arriving before you do.
- [00:09] GlarePilot checks weather and sun glare where, and when, you will actually be driving.
- [00:14] It has two clearly separated modes: real data planning, and manual demo scenarios.
- [00:21] Real data planning first. We pick a preset: Amherst to Chicago, leaving at eight A.M. tomorrow.
- [00:28] The route and the forecast are retrieved live, right now. Each point is evaluated at its projected arrival time.
- [00:36] The trip summary shows the drive time and the expected arrival.
- [00:40] On the map, the route is colored by sun glare, and animated icons mark forecast trouble spots.
- [00:47] Traffic is not predicted. Instead, you state a delay. Here we assume one extra hour.
- [00:53] The delay card shows the new arrival, and every later point is re-timed against the forecast.
- [00:59] Advice cards turn the conditions along the route into short, specific recommendations.
- [01:05] When should I leave? compares the same route with departures from three hours earlier to three hours later, using a transparent exposure score.
- [01:14] Lower bars mean less glare, wet road, wind and after-dark exposure. The best option is marked.
- [01:22] Next, manual demo scenarios. They use hand-set synthetic weather on a recorded real route, with no weather or route API calls.
- [01:33] Delay shifts the weather. An assumed seventy-five minute delay pushes the arrival into rain and darkness.
- [01:43] Heavy rain and crosswind. Rain and wind icons appear where the hand-set squall crosses the route.
- [01:53] Snow, fog and night. Hand-set snow over the Berkshires and freezing fog near Worcester, all after dark.
- [02:05] Westbound sunset glare. Now we switch from the 2D overview to the 3D chase preview.
- [02:11] The chase preview is a simulated playback of the planned route. It is not GPS.
- [02:17] Scrolling the wheel previews the road ahead. Return jumps back to the playback position.
- [02:22] Play runs a simulated drive along the planned route.
- [02:30] GlarePilot uses free, keyless data: Open-Meteo forecasts, Valhalla and OSRM routing, and SunCalc for sun position.
- [02:39] It is a planning aid, not a safety system. Manual demos use hand-set data. Built with Kiro for Hackachusetts 2026.
