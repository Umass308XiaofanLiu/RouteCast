// mapbox.js — Mapbox Directions API, profile mapbox/driving-traffic (needs the user's own access token).
// Docs: https://docs.mapbox.com/api/navigation/directions/
//   GET https://api.mapbox.com/directions/v5/mapbox/driving-traffic/{lon,lat;lon,lat}?access_token=…
//   &geometries=geojson&overview=full&annotations=duration,distance&depart_at=YYYY-MM-DDThh:mm:ssZ
// Docs (checked 2026-10-24): with depart_at, "the travel time, returned in duration, is a prediction for
// travel time based on historical travel data"; without it, driving-traffic uses live traffic.
// routes[0].duration_typical = duration under typical conditions (not live). legs[].annotation.duration /
// .distance are per-segment (between consecutive coordinates). Limits: 300 requests/minute; 401 = missing/
// invalid token, 403 = account or URL-restricted token problem.
// The fetched docs page did NOT state an explicit depart_at future window (UNVERIFIED); this adapter
// enforces: never send a past depart_at (near-now departures omit it = live) and at most MAPBOX_MAX_AHEAD_MS
// ahead (the app's own forecast horizon). VERIFIED only against mocked responses (no real call made).
import { fetchJson, cumulativeDistance, normalizedRoute, isoSeconds, trafficMode, TrafficError, MODE_LABEL, scaleCumTime } from './common.js';

export const MAPBOX_HOST = 'https://api.mapbox.com';
export const MAPBOX_MAX_AHEAD_MS = 14 * 864e5;
const P = 'Mapbox';

export function mapboxUrl(origin, dest, { departureUtc, apiKey, nowMs = Date.now() }) {
  if (departureUtc - nowMs > MAPBOX_MAX_AHEAD_MS) throw new TrafficError(P, 'config', 'Mapbox: departure is too far ahead for a traffic prediction.');
  const params = new URLSearchParams({ access_token: apiKey, geometries: 'geojson', overview: 'full', annotations: 'duration,distance', steps: 'true' });
  if (trafficMode(departureUtc, nowMs) === 'predictive') params.set('depart_at', isoSeconds(departureUtc));
  return `${MAPBOX_HOST}/directions/v5/mapbox/driving-traffic/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?${params}`;
}

export function parseMapbox(data, { departureUtc, nowMs = Date.now(), retrievedAt = nowMs } = {}) {
  const r = data?.routes?.[0];
  if (!r?.geometry?.coordinates?.length) throw new TrafficError(P, 'parse', `Mapbox: ${data?.message || data?.code || 'no route found'}`);
  const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const n = coords.length;
  const cumDist = cumulativeDistance(coords);
  const dur = (r.legs || []).flatMap((l) => l.annotation?.duration || []);
  let cumTime;
  let timing;
  if (dur.length === n - 1) {
    cumTime = new Float64Array(n);
    for (let i = 1; i < n; i++) cumTime[i] = cumTime[i - 1] + Math.max(0, dur[i - 1]);
    timing = 'per-segment durations';
  } else {
    cumTime = scaleCumTime(cumDist, r.duration);
    timing = 'scaled total, not per-segment';
  }
  const roads = [];
  let d = 0;
  for (const st of (r.legs || []).flatMap((l) => l.steps || [])) {
    const name = st.ref || st.name;
    if (name && st.distance > 0) roads.push({ fromM: d, toM: d + st.distance, name: String(name).split(';')[0].trim() });
    d += st.distance || 0;
  }
  const mode = trafficMode(departureUtc, nowMs);
  const typ = Number.isFinite(r.duration_typical) ? r.duration_typical : null;
  return normalizedRoute('Mapbox', coords, cumDist, cumTime, roads, {
    provider: 'Mapbox',
    mode,
    departureUtc,
    retrievedAt,
    totalSec: r.duration,
    freeFlowSec: null, // Mapbox does not report a no-traffic duration
    typicalSec: typ,
    // Live: delay versus typical conditions. Predictive (depart_at): duration is itself historical, so no delay figure.
    trafficDelaySec: mode === 'live' && typ != null ? r.duration - typ : null,
    timing,
    note: `${MODE_LABEL[mode]}; ${timing}. Mapbox gives no free-flow time${mode === 'live' ? '; delay is versus typical conditions' : ''}.`,
  });
}

export async function routeMapbox(origin, dest, { departureUtc, apiKey, fetchImpl = fetch, signal, nowMs = Date.now() } = {}) {
  if (!apiKey) throw new TrafficError(P, 'config', 'Mapbox needs your own access token.');
  const data = await fetchJson(fetchImpl, mapboxUrl(origin, dest, { departureUtc, apiKey, nowMs }), P, { signal });
  return parseMapbox(data, { departureUtc, nowMs, retrievedAt: Date.now() });
}
