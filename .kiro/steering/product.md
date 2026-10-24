# GlarePilot product steering

GlarePilot is a pre-trip planning aid for long-distance US drivers. It answers:
"What weather and sun glare will I meet at the places and times I will actually be there?"

## Non-negotiable honesty rules
- Forecasts are model forecasts (Open-Meteo), never "observations". Label them as forecasts.
- Drive times come from OSRM free-flow routing (no live traffic, no stops unless the user adds breaks). Never present a straight-line estimate as a routed time. If routing fails, show an error, not a fake route.
- Recorded demo snapshots must be labeled "Recorded snapshot" with their capture time everywhere they are shown.
- The guidance engine is deterministic and rule-based. Never call it generative AI, an LLM or a chatbot. Every recommendation shows the data that triggered it.
- Never promise safety. GlarePilot is a planning aid; road signs, official alerts and the driver's judgment take priority.
- Missing data (beyond the forecast horizon, null values) is shown as missing, never filled with invented values.

## Users
Drivers planning trips of 1–15 hours, e.g. Amherst MA → New York or Chicago. Typical questions:
when to leave, where the sunset glare hits, whether rain/snow/gusty crosswinds overlap the drive, and
whether the arrival is after dark.

## Tone
Concise, specific and actionable: where, when, what, why. US units by default (°F, mph, mi), metric toggle.
