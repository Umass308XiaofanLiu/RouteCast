# Traffic-aware timing — source assessment (GlarePilot)

## Implementation status (2026-10-24, 22:05 EDT, branch b1-traffic-overlays)

- **Provider-key routing (TomTom/HERE/Mapbox)**: hidden behind `?experimental=traffic` / `localStorage glarepilot.experimental.traffic=1`, labelled "Experimental — not verified against real provider responses". Adapters are mock-tested only (UNVERIFIED against real responses; no keys used).
- **NYC DOT speeds (§2.1)**: implemented as an on-demand, near-term-only overlay (departure ≤ 60 min, `data_as_of` ≤ 20 min old). Re-probed 2026-10-25 01:30Z: HTTP 200 JSON, `Access-Control-Allow-Origin: *` (VERIFIED). Newest `data_as_of` was 19:57 local at 21:30 EDT, i.e. ~1.5 h old, so in practice the app usually shows "too old to use" (VERIFIED for that probe). `$where` comparisons on `data_as_of` returned `[]` in two probes (VERIFIED), and `link_points` is a text column, so the app requests `$order=data_as_of DESC&$limit=1000` and filters the route's NYC bounding box client-side. Free-flow references (50/30 mph) are GlarePilot assumptions; the feed has none.
- **WZDx (§2.2)**: registry re-checked 2026-10-25 01:30Z. Corridor states MA/NY/PA/OH/IN/IL: only Indiana DOT (`in.carsprogram.org/carsapi_v1/api/wzdx`) works keyless — HTTP 200 `application/json`, ACAO `*`, 1,136 features, `update_date` current (VERIFIED). NYSDOT `511ny.org/api/wzdx` (`needapikey=false`) still returns `text/html` (VERIFIED: not usable). MassDOT, PA Turnpike, Ohio DOT, Illinois Tollway and IDOT require keys (registry). Only INDOT is used.
- Real recorded samples of both feeds: `tests/fixtures/overlays/`.

Research date: 2026-10-24, 21:01–21:30 EDT. Scope: traffic-aware, cumulative per-segment timing that feeds GlarePilot's forecast / sun / glare / optimizer, for the demo corridors:

- **Amherst MA → New York**: I-91 (MA, CT) → I-95 (CT, NY/Bronx).
- **Amherst MA → Chicago**: I-90 Mass Pike (MA) → NYS Thruway I-90 (NY) → I-90 (PA, Erie) → Ohio Turnpike I-80/I-90 (OH) → Indiana Toll Road I-80/I-90 (IN) → I-90/I-94 (IL).

The corridor-to-state mapping is the route assumption described in the task brief. I did not re-derive it from a live route. Neither corridor passes through New Jersey.

Labels used below:

- **VERIFIED**: I read it on the cited page, or saw it in a probe response, on 2026-10-24.
- **UNVERIFIED**: it comes from a search-result snippet, memory, or inference, or the page could not be read (JS-only, 403 or 404).

No signups, keys, accounts or form submissions were used. Endpoint probes were anonymous `curl` requests sent with `Origin: http://127.0.0.1:5173` where CORS mattered.

## 1. The semantics gap (read first)

- Agency feeds (NYC DOT speeds, 511 events, OHGO delays, GoTime travel times) describe **conditions now**. They are only meaningful for a departure in the next few minutes, roughly up to an hour, and only for the first segments of a multi-hour trip. By the time the car reaches Ohio on the Chicago trip (about 8–10 h in), the congestion seen at departure has no predictive value.
- A trip **days ahead** needs either historical or predictive speed profiles for that day of week and time of day, or a provider ETA that accepts a future departure time and projects time along the route.
  - HERE states this explicitly: "1 hour along the route, map data is evaluated using a time value of 09:00". VERIFIED: https://docs.here.com/routing/docs/routing-v8-time-dependent-routing.md
  - Mapbox: "Live traffic is gently mixed with historical data when the value for depart_at is close to current time." VERIFIED: https://docs.mapbox.com/api/navigation/directions/
  - Google: "The farther ahead you set the departure time into the future, the more consideration is given to historical traffic conditions." VERIFIED: https://developers.google.com/maps/documentation/routes/config_trade_offs
- **UI rule for GlarePilot**:
  - Never present current congestion as a prediction for a distant departure.
  - Label every timing source as one of: `free-flow (Valhalla/OSRM)`, `provider forecast for <departAt>`, `live conditions as of <timestamp> (near-term only)`, or `manual delay assumption`.
  - Hide or grey out live overlays when the departure is more than a short horizon away (suggested 60 min; this is a product choice, not a source fact).
  - Always show the data timestamp. The NYC DOT feed was about 2 h 44 min behind wall-clock during this research (see §2.1).

## 2. Keyless official feeds

### 2.1 NYC DOT Traffic Speeds — NYC Open Data (Socrata) `i4gi-tjb9`

- **Owner**: NYC DOT. Rows carry `owner: "NYC-DOT-Region 10"` and `transcom_id`. VERIFIED (probe).
- **Provides**: per-link `speed` (mph), `travel_time` (s), `status`, `data_as_of`, `link_points`, `encoded_poly_line`, `borough`, `link_name`. VERIFIED by probe of `https://data.cityofnewyork.us/resource/i4gi-tjb9.json?$limit=1`, which returned HTTP 200 JSON.
- **Type**: near-real-time, plus a large archive. `count(*)` returned 112,989,663 rows, so the same endpoint also serves history. VERIFIED (probe).
- **Freshness**:
  - Dataset metadata `rowsUpdatedAt` was 2026-10-24 20:53 local. VERIFIED: `https://data.cityofnewyork.us/api/views/i4gi-tjb9.json`
  - At 21:06 EDT, the newest `data_as_of` returned was `2026-10-24T18:22:06` (a floating timestamp, presumably local), meaning the measurements lagged by about 2.7 h. VERIFIED (probe).
  - The app must check `data_as_of` and suppress stale data.
- **Departure-time support**: none. This is current data only. The archive could, in principle, be aggregated into a typical-speed table by link, day of week and hour. That is an offline job and was not tested.
- **Corridor coverage**: NYC only. Today's rows included Bronx/Queens expressway links such as `CBE W … I 95 S EXP LNS` (Cross Bronx = I-95), `MDE N RFK Bridge`, Whitestone, BQE. VERIFIED (probe). This covers only the final NYC portion of the New York corridor.
- **Access**: keyless. Socrata app tokens are optional and raise throttling limits (UNVERIFIED; not read today).
- **Browser use**: the response carries `Access-Control-Allow-Origin: *`. VERIFIED (probe headers). It can be called directly from the static site.
- **Terms**: dataset metadata returned no license or attribution field. VERIFIED (probe; `license: {}`). NYC Open Data terms of use were not read (UNVERIFIED).
- **Quota/cost**: free. Unauthenticated throttling limits are UNVERIFIED.
- **Legacy feed**: the old `http://207.251.86.229/nyc-links-cams/LinkSpeedQuery.txt` gave no response (curl code 000). VERIFIED: not usable.

### 2.2 USDOT WZDx Feed Registry and keyless state work-zone feeds

- **Registry**: USDOT, Socrata `data.transportation.gov/resource/69qe-yiui.json`. Keyless, HTTP 200, 43 feeds listed, with `needapikey` given per feed. VERIFIED (probe).
- **Corridor states in the registry**:
  - **Indiana DOT** `https://in.carsprogram.org/carsapi_v1/api/wzdx`
    - `needapikey: false`, WZDx 4.1. VERIFIED (registry).
    - Probe returned HTTP 200, `application/json`, `Access-Control-Allow-Origin: *`, a 4.2 MB FeatureCollection with 1,137 features, and `update_date` 2026-10-25T01:05:58Z (current). VERIFIED (probe).
    - Provides work zones, lane closures and restrictions. It does not provide speeds or travel times.
  - **NYSDOT** `https://511ny.org/api/wzdx`
    - `needapikey: false` per the registry. VERIFIED (registry).
    - The probe returned HTTP 200 **text/html** (the 511NY single-page app), not GeoJSON. VERIFIED (probe). The registry entry is stale or the URL has moved, so treat it as **not usable** as listed.
  - **Keyed in the registry** (free key, see §3):
    - Ohio DOT via OHGO
    - Pennsylvania Turnpike
    - Illinois Tollway
    - MassDOT (`api.massdot-swzm.com`, key from `api-app.massdot-swzm.com`)
    - IDOT (`wzad-idot.illinois.gov`)

    All VERIFIED (registry fields only; the feeds themselves were not called).
- **Semantics**: planned and active work zones are useful for both near-term and future trips when they carry start and end dates. They are closures and restrictions, not speeds, so they flag risk rather than giving a timing input.

### 2.3 Other keyless candidates checked

- **Travel Midwest (IDOT Gateway, IL/IN/WI)**
  - A search snippet of `https://www.travelmidwest.com/lmiga/policies.jsp` says traffic information is "available without charge … via periodic downloads of data in XML format". UNVERIFIED: the page is JS-only and I could not read it.
  - Whether a key or agreement is required is UNVERIFIED.
- **MassDOT "Highway data for developers"** (`https://www.mass.gov/info-details/highway-data-for-developers`): HTTP 403 to both the fetch tool and curl. VERIFIED (blocked). See §3.2 for the GoTime API, which I could read.
- **511NJ**: no public developer documentation found. A search turned up only an internal-looking ASP.NET help page. UNVERIFIED. NJ is not on either corridor anyway.
- **CT, PA, OH, NY 511 systems**: no keyless traffic API found. Each requires a key or approval (§3).

## 3. No-cost keyed or approval-based official feeds

All of these are free. A key here means registration, not payment.

| Source | Owner | Provides | Access | Limits / terms | Doc read | Status |
|---|---|---|---|---|---|---|
| **511NY developer API** | NYSDOT | Events, cameras, signs; travel times UNVERIFIED | Free key after 511NY account (UNVERIFIED) | "Throttling is enabled. 10 calls every 60 seconds." appears in a search snippet only | `https://511ny.org/developers/help` is JS-only (unreadable); snippet from `https://ny.ibi511.com/developers/help`, which failed to fetch | UNVERIFIED |
| **CTroads API** | CTDOT | Message signs, events, advisories (REST). Travel times are on the website list, but are not listed as an API resource | "Requires a developer key", `key` query param; account required before requesting a key | "Throttling is enabled. Ten calls every 60 seconds." | https://ctroads.org/developers/doc | VERIFIED |
| **OHGO Public API** | Ohio DOT | Construction, dangerous slowdowns, digital signs, incidents (with closure info), **travel delays**, weather sites, work zones (WZDx) | Free key via registration (email + password); key sent with every request | "free service"; example limit "25 requests per second for a single API Key (Subject to change)"; ODOT may revoke; data "considered public domain" | https://publicapi.ohgo.com/ and https://publicapitest.ohgo.com/docs/terms-of-use | VERIFIED (anonymous probe of `/api/v1/incidents` returned 401) |
| **MassDOT GoTime API** | MassDOT | Travel-time links, routes, signs, detectors; `/v1/status/links` and `/v1/status/routes` give "current (or historical) data" | Credentials (username, password, **secret key**); `/auth-token` with Basic auth, then a SHA-256 signature for each Bearer request | Not readable from the docs. The secret-key signing scheme **cannot safely run in a public static browser app** and needs a server-side proxy | https://data-api.massgotime.com/index.html (Swagger `swagger/v1/swagger.json`) | VERIFIED (scheme, endpoints; anonymous probes returned 401). How to request access: UNVERIFIED |
| **511PA / PennDOT data feeds** | PennDOT | Real-time and static feeds (RCRS road conditions, events, etc.); 511PA reports speeds on about 15,000 mi (search snippet; UNVERIFIED) | **Approval-based**: submit the Data Feed Request Form; PennDOT follows up | "There is no charge for using PennDOT data feeds"; public apps must acknowledge PennDOT as the source | https://www.pa.gov/services/penndot/request-access-to-transportation-related-data-feeds | VERIFIED |
| **511IN / Mass511** (Castle Rock platform) | INDOT / MassDOT | Event and speed layers on their maps | Developer pages are JS-only; anonymous `/api/v2/get/event` returned 200 but the content was not confirmed as data (likely the SPA shell) | Unknown | `https://511in.org/developers`, `https://www.mass511.com/developers/help` | UNVERIFIED |

What this means for a static public web app:

- A shared key embedded in client JavaScript is visible to every visitor.
- At 10 calls per 60 s (CTroads), one embedded key would be exhausted quickly by a handful of concurrent users.
- MassDOT GoTime's secret must never ship to the browser.

So in a static deployment, these keyed feeds suit either a user-supplied key or a future small proxy or cache. Adding a proxy would introduce a backend, which is out of scope today. OHGO's published example limit (25 rps) is the only one generous enough for direct browser use, and CORS for OHGO is UNVERIFIED.

## 4. Commercial routing with traffic and future departure time

| Provider | Future departure | Traffic model | Per-segment output usable for cumulative per-sample timing | Free tier / billing | Doc read |
|---|---|---|---|---|---|
| **TomTom Routing API** `calculateRoute` | `departAt` dateTime (default `now`); `arriveAt` is the alternative. VERIFIED | Uses "current traffic and the typical road speeds on the requested day of the week and time of day". `traffic=false` ignores current traffic, but "the effect of historic traffic on effective road speeds is still incorporated"; considers closures and road works "up to 60 days in the future". VERIFIED | **Best fit.** `extendedRouteRepresentation=travelTime` returns a `progress` array of `{pointIndex, travelTimeInSeconds, distanceInMeters}`, which can be interpolated by Haversine distance between entries. That is cumulative time per polyline point, directly. `sectionType=traffic` gives TRAFFIC sections with `simpleCategory`, `effectiveSpeedInKmh`, `delayInSeconds`, `magnitudeOfDelay`. `computeTravelTimeFor=all` adds `noTrafficTravelTimeInSeconds`, `historicTrafficTravelTimeInSeconds`, `liveTrafficIncidentsTravelTimeInSeconds`. VERIFIED | Pricing page: "Free monthly requests per API, no credit card needed"; Routing API "Free 20K monthly". VERIFIED | https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route ; https://developer.tomtom.com/pricing |
| **Mapbox Directions** `mapbox/driving-traffic` | `depart_at` (ISO 8601; origin timezone if no offset). VERIFIED | "Factors in current and historic traffic"; `duration` "is a prediction … based on historical travel data and live traffic". Areas without traffic coverage revert to `driving`. VERIFIED | **Very good.** `annotations=duration,speed,congestion` (needs `overview=full`) gives per-coordinate-pair duration (s) and speed (m/s); `congestion`/`congestion_numeric` apply only to driving-traffic. Legs and steps include `duration_typical`. VERIFIED | Directions API "Up to 100,000" monthly requests free, then $2.00/1,000. Limits: 300 req/min, 25 coordinates, 10,000 km. VERIFIED. Whether signup requires a card: UNVERIFIED | https://docs.mapbox.com/api/navigation/directions/ ; https://www.mapbox.com/pricing |
| **HERE Routing API v8** | `departureTime` / `arrivalTime`; `departureTime=any` is "planning mode" (free-flow plus long-term closures only). Time is projected along the route. VERIFIED | Live and historical traffic plus time-dependent restrictions; traffic is on by default for time-aware routes. VERIFIED | **Good.** `return=polyline&spans=…` with span attributes such as `dynamicSpeedInfo` (a new span whenever expected speed changes), plus `duration`/`length` metadata. Typical durations: see "Duration, baseDuration, typicalDuration". VERIFIED (span concept and attribute names); exact response fields not exercised | Auth uses `apiKey` query param (VERIFIED from doc example). Free-tier size and card requirement: UNVERIFIED (pricing page did not render) | https://docs.here.com/routing/docs/routing-v8-time-dependent-routing.md ; https://docs.here.com/routing/docs/routing-v8-traffic-in-routing.md ; https://docs.here.com/routing/docs/routing-v8-span.md |
| **Google Routes API** | `departureTime` must be in the future and is only meaningful with `TRAFFIC_AWARE` / `TRAFFIC_AWARE_OPTIMAL`. `TRAFFIC_UNAWARE` (the default) uses "average time-independent traffic conditions". VERIFIED | Live traffic weighted more near now, historical traffic further out. VERIFIED | Legs and steps carry durations (UNVERIFIED today). Per-interval speed categories (`speedReadingIntervals` via traffic-on-polyline) are UNVERIFIED: the doc URL I tried returned 404 | "you must enable billing on each of your projects" (VERIFIED). Traffic-aware requests bill as **Compute Routes Pro**: 5,000 free monthly events, then $10.00/1,000 at the first tier (VERIFIED) | https://developers.google.com/maps/documentation/routes/config_trade_offs ; https://developers.google.com/maps/documentation/routes/usage-and-billing ; https://developers.google.com/maps/billing-and-pricing/pricing |

Not verified for any provider today: browser CORS behaviour, key-restriction features (HTTP-referrer or URL restrictions), and display or attribution terms (for example, whether results may be shown on a non-provider basemap such as GlarePilot's MapLibre/OSM). Read each provider's terms before shipping.

## 5. Recommended phased plan

**Phase A — near-term departures only (keyless first).** Goal: show live conditions and closures, clearly labelled with "as of <time>". Do not feed them into forecasts for distant departures.

1. NYC DOT speeds (§2.1): keyless with CORS `*`.
   - Use only when the departure is within the near-term horizon and `data_as_of` is fresh. Suggested product thresholds: departure ≤ 60 min away, `data_as_of` ≤ 15 min old.
   - Optionally replace free-flow time on matched NYC links only, as a labelled live adjustment.
2. INDOT WZDx (§2.2): keyless with CORS `*`. Closure and work-zone overlay with date ranges, usable for future trips too as a "planned work zone" warning.
3. Optional, behind a user-supplied free key: OHGO (incidents, travel delays, WZDx), then CTroads events (10 calls/60 s per key).
4. Excluded from the static app:
   - MassDOT GoTime (needs a server-held secret)
   - 511PA (approval plus attribution)
   - 511NY (docs unreadable, throttle UNVERIFIED)

   Revisit these if a proxy is ever accepted.

**Phase B — provider-backed future ETA through a user-supplied key.** This is the only real answer for trips hours or days ahead.

- **First choice: TomTom Routing API**
  - `departAt` + `traffic=true` + `extendedRouteRepresentation=travelTime` gives per-point cumulative travel time aligned to the route polyline, which maps 1:1 onto GlarePilot's per-sample timing.
  - `computeTravelTimeFor=all` provides free-flow, historic and live breakdowns, enabling honest labelling.
  - `sectionType=traffic` adds delay sections.
  - Free 20K requests per month with "no credit card needed". All VERIFIED.
- **Second choice: Mapbox `driving-traffic`**
  - `depart_at` + `annotations=duration,speed`, with 100K free requests per month. VERIFIED.
  - The 25-coordinate cap and `overview=full` requirement are fine for two-waypoint trips.
- HERE is a viable third (spans with `dynamicSpeedInfo`; pricing UNVERIFIED).
- Google is last: billing must be enabled, and only a 5K free monthly Pro cap applies.
- Implementation notes:
  - Key entered by the user and stored only in `localStorage`, never committed.
  - Show "provider forecast for <departAt> (TomTom)".
  - Fall back automatically to free-flow plus manual delay on error or quota exhaustion.

**Phase C — fallback (already implemented).** Free-flow Valhalla/OSRM timing plus the explicit, labelled manual delay assumption. Keep it as the default whenever no provider key or fresh near-term data is available.

## 6. Human actions needed

Nothing was registered during this research.

- **To unlock Phase B (recommended)**:
  - Create a free TomTom developer account and API key at developer.tomtom.com. The pricing page states no credit card is needed (VERIFIED).
  - Optionally create a Mapbox account and token. Whether the signup asks for a card is UNVERIFIED.
- **Optional Phase A keys**:
  - OHGO: register at `https://publicapi.ohgo.com/accounts/registration` (email + password; free).
  - CTroads: create a ctroads.org account, then request a developer key on the API page.
- **Only if a backend/proxy is later approved**:
  - MassDOT GoTime credentials (the request process is UNVERIFIED; the mass.gov page returned 403).
  - PennDOT Data Feed Request Form (approval plus attribution).
  - 511NY developer key.
- **A key does not necessarily mean payment.**
  - TomTom, Mapbox, OHGO, CTroads and PennDOT keys are free at these volumes (VERIFIED for TomTom/Mapbox free tiers, OHGO "free service", CTroads key, PennDOT "no charge").
  - Google is the exception: billing must be enabled even to use the free monthly cap.
  - Never commit any key to the repo.
