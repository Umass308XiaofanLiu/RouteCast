// tomtom.js — TomTom Routing API "Calculate Route" adapter (needs the user's own TomTom key).
// Docs: https://developer.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
//   GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lon:lat,lon}/json?key=…
//   traffic=true, departAt=now|<RFC 3339 dateTime> (must not be in the past), sectionType=traffic,
//   computeTravelTimeFor=all (adds noTrafficTravelTimeInSeconds / historicTrafficTravelTimeInSeconds /
//   liveTrafficIncidentsTravelTimeInSeconds to summary), instructionsType=coded (guidance.instructions
//   with pointIndex + travelTimeInSeconds = estimated time up to that instruction).
// Response: routes[0].summary { lengthInMeters, travelTimeInSeconds, trafficDelayInSeconds, departureTime,
//   arrivalTime, noTrafficTravelTimeInSeconds, … }, routes[0].legs[].points[{ latitude, longitude }],
//   routes[0].sections[{ startPointIndex, endPointIndex, sectionType: 'TRAFFIC', delayInSeconds,
//   magnitudeOfDelay, simpleCategory, effectiveSpeedInKmh }], routes[0].guidance.instructions[].
// Shapes reconstructed from the documentation; VERIFIED only against mocked responses (no real call made).
import { fetchJson, cumulativeDistance, cumTimeFromAnchors, normalizedRoute, isoSeconds, trafficMode, TrafficError, MODE_LABEL } from './common.js';

export const TOMTOM_HOST = 'https://api.tomtom.com';
const P = 'TomTom';

export function tomtomUrl(origin, dest, { departureUtc, apiKey, nowMs = Date.now() }) {
  const mode = trafficMode(departureUtc, nowMs);
  const params = new URLSearchParams({
    key: apiKey,
    traffic: 'true',
    travelMode: 'car',
    routeType: 'fastest',
    departAt: mode === 'live' ? 'now' : isoSeconds(departureUtc),
    sectionType: 'traffic',
    computeTravelTimeFor: 'all',
    routeRepresentation: 'polyline',
    instructionsType: 'coded',
  });
  return `${TOMTOM_HOST}/routing/1/calculateRoute/${origin.lat},${origin.lon}:${dest.lat},${dest.lon}/json?${params}`;
}

/** Parse a calculateRoute JSON body into the normalized route shape. */
export function parseTomTom(data, { departureUtc, nowMs = Date.now(), retrievedAt = nowMs } = {}) {
  const r = data?.routes?.[0];
  if (!r?.legs?.length) throw new TrafficError(P, 'parse', 'TomTom: no route found');
  const coords = [];
  // Single origin→destination request = one leg; TomTom point indices (sections, instructions) are route-wide.
  for (const leg of r.legs) for (const p of leg.points || []) coords.push([p.latitude, p.longitude]);
  const s = r.summary || {};
  const total = Number(s.travelTimeInSeconds);
  if (!(total > 0)) throw new TrafficError(P, 'parse', 'TomTom: response has no travel time');
  const cumDist = cumulativeDistance(coords);
  const n = coords.length;
  const traffSections = (r.sections || []).filter((x) => x.sectionType === 'TRAFFIC');
  const sectionDelay = traffSections.reduce((a, x) => a + (Number(x.delayInSeconds) || 0), 0);
  const instr = (r.guidance?.instructions || []).filter((x) => Number.isInteger(x.pointIndex) && Number.isFinite(x.travelTimeInSeconds));
  let cumTime;
  let timing;
  if (instr.length >= 2) {
    // Per-instruction cumulative (traffic-aware) times, distance-interpolated between instructions.
    cumTime = cumTimeFromAnchors(cumDist, [...instr.map((x) => ({ idx: x.pointIndex, t: x.travelTimeInSeconds })), { idx: n - 1, t: total }]);
    timing = 'per-instruction cumulative times';
  } else {
    // Per-section: no-delay time spread by distance, plus each TRAFFIC section's delay over its own span.
    const base = Math.max(0, total - sectionDelay);
    const D = cumDist[n - 1] || 1;
    const extra = new Float64Array(n);
    for (const sec of traffSections) {
      const a = Math.max(0, sec.startPointIndex | 0);
      const b = Math.min(n - 1, sec.endPointIndex | 0);
      const span = cumDist[b] - cumDist[a];
      const d = Number(sec.delayInSeconds) || 0;
      for (let i = a + 1; i < n; i++) extra[i] += i <= b ? (span > 0 ? (d * (cumDist[i] - cumDist[a])) / span : d) : d;
    }
    cumTime = Float64Array.from(cumDist, (x, i) => (base * x) / D + extra[i]);
    timing = traffSections.length ? 'per traffic section (delay placed on its section)' : 'scaled total, not per-segment';
  }
  const roads = [];
  for (let k = 0; k < instr.length; k++) {
    const x = instr[k];
    const next = instr[k + 1];
    const name = x.roadNumbers?.[0] || x.street;
    if (name && next && next.pointIndex > x.pointIndex) roads.push({ fromM: cumDist[x.pointIndex], toM: cumDist[next.pointIndex], name });
  }
  const mode = trafficMode(departureUtc, nowMs);
  const freeFlowSec = Number.isFinite(s.noTrafficTravelTimeInSeconds) ? s.noTrafficTravelTimeInSeconds : Number.isFinite(s.trafficDelayInSeconds) ? total - s.trafficDelayInSeconds : null;
  return normalizedRoute('TomTom', coords, cumDist, cumTime, roads, {
    provider: 'TomTom',
    mode,
    departureUtc,
    retrievedAt,
    totalSec: total,
    freeFlowSec,
    trafficDelaySec: Number.isFinite(s.trafficDelayInSeconds) ? s.trafficDelayInSeconds : freeFlowSec != null ? total - freeFlowSec : null,
    timing,
    trafficSections: traffSections.length,
    note: `${MODE_LABEL[mode]}; ${timing}. TomTom trafficDelayInSeconds is the delay from traffic incidents/jams on the route.`,
  });
}

export async function routeTomTom(origin, dest, { departureUtc, apiKey, fetchImpl = fetch, signal, nowMs = Date.now() } = {}) {
  if (!apiKey) throw new TrafficError(P, 'config', 'TomTom needs your own API key.');
  const data = await fetchJson(fetchImpl, tomtomUrl(origin, dest, { departureUtc, apiKey, nowMs }), P, { signal });
  return parseTomTom(data, { departureUtc, nowMs, retrievedAt: Date.now() });
}
