# Requirements — route-time weather and sun-glare planning

## R1 Trip input
- R1.1 User picks origin and destination by searching US places (autocomplete) or a preset scenario.
- R1.2 Departure date/time is entered as wall-clock time in the ORIGIN's timezone, and the timezone is shown.
- R1.3 Invalid input (same place, unknown place, departure in the past or beyond the forecast horizon) yields a clear inline error and no stale results.

## R2 Routed timing
- R2.1 Route geometry and per-segment travel durations come from a routing engine (Valhalla, OSRM fallback); arrival time at every sampled point is departure + cumulative routed duration (+ optional breaks).
- R2.2 Routing failure shows an error state; no straight-line substitute is presented as a route.

## R3 Time-aligned forecast
- R3.1 For points sampled along the route, fetch hourly forecasts and pick the value valid at that point's arrival time: temperature, precipitation (rain/snow), probability, weather code, cloud cover, visibility, wind speed, gusts and direction.
- R3.2 Times outside the returned forecast window are reported as "no forecast", never filled.
- R3.3 Each point is shown in its own local timezone (e.g. Eastern → Central).

## R4 Sun glare
- R4.1 Compute sun altitude/azimuth (SunCalc) at each ~1 km sample's arrival time and compare with the local driving heading.
- R4.2 Glare risk when the visible sun (altitude > −0.833°) is ≤ 25° high and within ±30° of the heading; severity grows as the sun gets lower and more centered.
- R4.3 Cloud cover from the forecast can reduce expected glare; geometric risk is still reported.
- R4.4 Detect low sun behind the driver (oncoming drivers/signals affected), twilight and night.
- R4.5 Group consecutive glare samples into glare windows with start/end time, place and peak severity.

## R5 Driving implications and guidance
- R5.1 Derive crosswind and headwind components (incl. gusts) from wind direction vs heading.
- R5.2 Flag rain, snow, freezing conditions, low visibility, thunderstorms, strong crosswind gusts, night driving and fatigue (long drives).
- R5.3 A deterministic rules engine produces prioritized recommendations, each with where/when/why and the triggering values. Personalize by vehicle type.
- R5.4 Departure optimizer: re-evaluate the same route for departures shifted −3 h…+3 h and recommend better windows with quantified tradeoffs.

## R6 Presentation
- R6.1 Map with route colored by condition and a legend; timeline chart (daylight/night, glare, precipitation, temperature, gusts); sun-vs-heading visual for a selected point; waypoint table.
- R6.2 Loading, error, empty and partial-data states; responsive down to 360 px; keyboard and screen-reader accessible.
- R6.3 Data provenance badge: Live forecast vs Recorded snapshot (with capture time).
