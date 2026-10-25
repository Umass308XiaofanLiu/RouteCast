// Traffic-aware routing adapters. All provider responses are MOCKED from the documented formats
// (TomTom calculateRoute, HERE Routing v8, Mapbox Directions driving-traffic); no real API call is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeFlexible } from '../../src/lib/traffic/flexpolyline.js';
import { routeWithTraffic, trafficMode, MODE_LABEL } from '../../src/lib/traffic/index.js';
import { parseTomTom, tomtomUrl } from '../../src/lib/traffic/tomtom.js';
import { parseHere, hereUrl } from '../../src/lib/traffic/here.js';
import { parseMapbox, mapboxUrl, MAPBOX_MAX_AHEAD_MS } from '../../src/lib/traffic/mapbox.js';
import { cumTimeFromAnchors, cumulativeDistance, scaleCumTime } from '../../src/lib/traffic/common.js';
import { buildTripModel } from '../../src/lib/planner.js';
import { evaluateTrip } from '../../src/lib/trip.js';

const places = JSON.parse(readFileSync(new URL('../../src/data/us_places.json', import.meta.url)));
const snap = JSON.parse(readFileSync(new URL('../../public/fixtures/albany-boston.json', import.meta.url)));
const H = 3600e3;
const NOW = snap.capturedAt;
const DEP = snap.departureUtc; // well over 30 min after capturedAt -> predictive
const KEY = 'FAKE-KEY-123';

// --- mock builders (documented response shapes) ---
function tomtomBody(coords, { delaySec = 1800, noTraffic = snap.route.totalSec, withInstr = true } = {}) {
  const n = coords.length;
  const a = Math.floor(n * 0.4);
  const b = Math.floor(n * 0.6);
  const ff = snap.route.cumTime;
  const tAt = (i) => ff[i] + (i <= a ? 0 : i >= b ? delaySec : (delaySec * (i - a)) / (b - a));
  const step = Math.max(1, Math.floor(n / 20));
  const instructions = [];
  for (let i = 0; i < n - 1; i += step) instructions.push({ routeOffsetInMeters: Math.round(snap.route.cumDist[i]), travelTimeInSeconds: Math.round(tAt(i)), pointIndex: i, roadNumbers: i < n / 2 ? ['I-90'] : [], street: 'Mass Pike' });
  instructions.push({ routeOffsetInMeters: Math.round(snap.route.totalDistM), travelTimeInSeconds: Math.round(noTraffic + delaySec), pointIndex: n - 1, street: '' });
  return {
    formatVersion: '0.0.12',
    routes: [{
      summary: { lengthInMeters: Math.round(snap.route.totalDistM), travelTimeInSeconds: Math.round(noTraffic + delaySec), trafficDelayInSeconds: delaySec, trafficLengthInMeters: 12000, departureTime: new Date(DEP).toISOString(), arrivalTime: new Date(DEP + (noTraffic + delaySec) * 1000).toISOString(), noTrafficTravelTimeInSeconds: Math.round(noTraffic), historicTrafficTravelTimeInSeconds: Math.round(noTraffic + delaySec), liveTrafficIncidentsTravelTimeInSeconds: Math.round(noTraffic + delaySec) },
      legs: [{ summary: {}, points: coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon })) }],
      sections: [
        { startPointIndex: 0, endPointIndex: n - 1, sectionType: 'TRAVEL_MODE', travelMode: 'car' },
        { startPointIndex: a, endPointIndex: b, sectionType: 'TRAFFIC', simpleCategory: 'JAM', effectiveSpeedInKmh: 20, delayInSeconds: delaySec, magnitudeOfDelay: 3, tec: { causes: [{ mainCauseCode: 1 }], effectCode: 4 } },
      ],
      guidance: withInstr ? { instructions } : undefined,
    }],
  };
}

// Flexible polyline encoder (test helper only) — the decoder itself is checked against the official example.
const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function encUnsigned(v) {
  let s = '';
  while (v > 0x1f) {
    s += TABLE[(v & 0x1f) | 0x20];
    v = Math.floor(v / 32);
  }
  return s + TABLE[v];
}
const encSigned = (v) => encUnsigned(v < 0 ? -2 * v - 1 : 2 * v);
function encodeFlexible(coords, precision = 5) {
  let out = encUnsigned(1) + encUnsigned(precision);
  let pa = 0;
  let pb = 0;
  const f = 10 ** precision;
  for (const [a, b] of coords) {
    const A = Math.round(a * f);
    const B = Math.round(b * f);
    out += encSigned(A - pa) + encSigned(B - pb);
    pa = A;
    pb = B;
  }
  return out;
}

function mockFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    for (const [re, fn] of routes) {
      if (re.test(url)) {
        const r = fn(url);
        if (r instanceof Error) throw r;
        return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
      }
    }
    throw new TypeError('unexpected url');
  };
  f.calls = calls;
  return f;
}
const forecastRoute = [/api\.open-meteo/, (url) => {
  const q = new URL(url).searchParams;
  const lats = q.get('latitude').split(',').map(Number);
  const lons = q.get('longitude').split(',').map(Number);
  // Nearest recorded checkpoint for each requested point (route sampling can differ with traffic timing).
  const near = (la, lo) => snap.forecasts.reduce((best, x) => ((x.lat - la) ** 2 + (x.lon - lo) ** 2 < (best.lat - la) ** 2 + (best.lon - lo) ** 2 ? x : best));
  return { body: lats.map((la, i) => near(la, lons[i])).map((x) => ({ latitude: x.lat, longitude: x.lon, timezone: x.timezone, hourly: { time: x.times.map((t) => t / 1000), temperature_2m: x.temperature, precipitation: x.precipitation, rain: x.rain, snowfall: x.snowfall, precipitation_probability: x.precipProbability, weather_code: x.weatherCode, cloud_cover: x.cloudCover, visibility: x.visibility, wind_speed_10m: x.windSpeed, wind_direction_10m: x.windDirection, wind_gusts_10m: x.windGusts } })) };
}];
const osrmBody = () => {
  const c = snap.route.coords;
  const d = c.slice(1).map((_, i) => snap.route.cumTime[i + 1] - snap.route.cumTime[i]);
  return { routes: [{ duration: snap.route.totalSec, geometry: { coordinates: c.map(([a, b]) => [b, a]) }, legs: [{ annotation: { duration: d }, steps: [] }] }] };
};
const monotonic = (a) => a.every((t, i) => i === 0 || t >= a[i - 1]);

// --- flexible polyline ---
test('flexible polyline: decodes the official HERE example exactly', () => {
  const d = decodeFlexible('BFoz5xJ67i1B1B7PzIhaxL7Y');
  assert.equal(d.precision, 5);
  assert.equal(d.thirdDim, 0);
  assert.deepEqual(d.polyline, [[50.10228, 8.69821], [50.10201, 8.69567], [50.10063, 8.6915], [50.09878, 8.68752]]);
  assert.throws(() => decodeFlexible('CFoz5x'), /version/);
  assert.throws(() => decodeFlexible('BFoz5xJ67i1B1'), /incomplete|Truncated/);
  const round = decodeFlexible(encodeFlexible(snap.route.coords.slice(0, 50)));
  round.polyline.forEach(([a, b], i) => assert.ok(Math.abs(a - snap.route.coords[i][0]) < 1e-5 && Math.abs(b - snap.route.coords[i][1]) < 1e-5));
});

// --- semantics ---
test('mode: > 30 min ahead is predictive, near-now is live; labels never call manual delays traffic', () => {
  assert.equal(trafficMode(NOW + 31 * 60e3, NOW), 'predictive');
  assert.equal(trafficMode(NOW + 10 * 60e3, NOW), 'live');
  assert.equal(trafficMode(NOW, NOW), 'live');
  assert.match(MODE_LABEL.predictive, /historical\/typical traffic for that departure time/);
  assert.equal(MODE_LABEL.live, 'live traffic');
  const tt = parseTomTom(tomtomBody(snap.route.coords), { departureUtc: NOW + 5 * 60e3, nowMs: NOW });
  assert.equal(tt.traffic.mode, 'live');
  assert.match(tomtomUrl(snap.origin, snap.dest, { departureUtc: NOW + 5 * 60e3, apiKey: 'k', nowMs: NOW }), /departAt=now/);
  assert.match(tomtomUrl(snap.origin, snap.dest, { departureUtc: DEP, apiKey: 'k', nowMs: NOW }), /departAt=2026-[\d-]+T[\d%A:]+Z/);
});

// --- TomTom ---
test('TomTom: per-instruction cumulative times, delay, free-flow, monotonic cumTime', () => {
  const r = parseTomTom(tomtomBody(snap.route.coords), { departureUtc: DEP, nowMs: NOW, retrievedAt: NOW });
  assert.equal(r.engine, 'TomTom');
  assert.equal(r.coords.length, snap.route.coords.length);
  assert.ok(monotonic(r.cumTime));
  assert.equal(r.traffic.provider, 'TomTom');
  assert.equal(r.traffic.mode, 'predictive');
  assert.equal(r.traffic.trafficDelaySec, 1800);
  assert.equal(r.traffic.freeFlowSec, Math.round(snap.route.totalSec));
  assert.equal(r.traffic.timing, 'per-instruction cumulative times');
  assert.ok(Math.abs(r.totalSec - (Math.round(snap.route.totalSec) + 1800)) < 1);
  // Delay sits in the jam section: early points unchanged, late points +30 min.
  const n = r.cumTime.length;
  assert.ok(Math.abs(r.cumTime[Math.floor(n * 0.2)] - snap.route.cumTime[Math.floor(n * 0.2)]) < 120);
  assert.ok(Math.abs(r.cumTime[Math.floor(n * 0.8)] - snap.route.cumTime[Math.floor(n * 0.8)] - 1800) < 120);
  assert.ok(r.roads.some((x) => x.name === 'I-90'));
});

test('TomTom: without instructions the delay is placed on the TRAFFIC section', () => {
  const r = parseTomTom(tomtomBody(snap.route.coords, { withInstr: false }), { departureUtc: DEP, nowMs: NOW });
  assert.match(r.traffic.timing, /per traffic section/);
  assert.ok(monotonic(r.cumTime));
  const n = r.cumTime.length;
  const ffRate = (Math.round(snap.route.totalSec)) / r.totalDistM;
  const i = Math.floor(n * 0.2);
  assert.ok(Math.abs(r.cumTime[i] - ffRate * r.cumDist[i]) < 1, 'no delay before the section');
  const j = Math.floor(n * 0.9);
  assert.ok(Math.abs(r.cumTime[j] - ffRate * r.cumDist[j] - 1800) < 1, 'full delay after the section');
});

// --- HERE ---
function hereBody(coords, { spans = true, delay = 1200 } = {}) {
  const ff = snap.route.cumTime;
  const n = coords.length;
  const sp = [];
  const step = Math.max(1, Math.floor(n / 25));
  for (let i = 0; i < n - 1; i += step) {
    const j = Math.min(n - 1, i + step);
    const extra = i >= n / 2 && i < n / 2 + step ? delay : 0;
    sp.push({ offset: i, duration: Math.round(ff[j] - ff[i]) + extra, length: Math.round(snap.route.cumDist[j] - snap.route.cumDist[i]) });
  }
  const duration = sp.reduce((a, s) => a + s.duration, 0);
  return {
    routes: [{
      id: 'r0',
      sections: [{
        id: 's0', type: 'vehicle',
        departure: { time: new Date(DEP).toISOString(), place: { type: 'place', location: { lat: coords[0][0], lng: coords[0][1] } } },
        arrival: { time: new Date(DEP + duration * 1000).toISOString(), place: { type: 'place', location: { lat: coords[n - 1][0], lng: coords[n - 1][1] } } },
        summary: { duration, length: Math.round(snap.route.totalDistM), baseDuration: duration - delay, typicalDuration: duration - 300 },
        travelSummary: { duration, length: Math.round(snap.route.totalDistM), baseDuration: duration - delay },
        polyline: encodeFlexible(coords),
        spans: spans ? sp : undefined,
        transport: { mode: 'car' },
      }],
    }],
  };
}

test('HERE: flexible polyline + per-span durations; delay = duration − baseDuration', () => {
  const body = hereBody(snap.route.coords);
  const r = parseHere(body, { departureUtc: DEP, nowMs: NOW });
  assert.equal(r.engine, 'HERE');
  assert.equal(r.coords.length, snap.route.coords.length);
  assert.ok(monotonic(r.cumTime));
  assert.equal(r.traffic.trafficDelaySec, 1200);
  assert.equal(r.traffic.timing, 'per-span durations');
  assert.equal(r.totalSec, body.routes[0].sections[0].summary.duration);
  const n = r.cumTime.length;
  assert.ok(r.cumTime[Math.floor(n * 0.9)] - snap.route.cumTime[Math.floor(n * 0.9)] > 1100);
  assert.ok(Math.abs(r.cumTime[Math.floor(n * 0.2)] - snap.route.cumTime[Math.floor(n * 0.2)]) < 60);
  const noSpan = parseHere(hereBody(snap.route.coords, { spans: false }), { departureUtc: DEP, nowMs: NOW });
  assert.equal(noSpan.traffic.timing, 'scaled total, not per-segment');
  assert.ok(monotonic(noSpan.cumTime));
  assert.match(hereUrl(snap.origin, snap.dest, { departureUtc: DEP, apiKey: 'k', nowMs: NOW }), /departureTime=.*return=polyline%2Csummary%2CtravelSummary.*spans=duration%2Clength|return=polyline%2Csummary%2CtravelSummary.*spans=duration%2Clength.*departureTime=/);
  assert.doesNotMatch(hereUrl(snap.origin, snap.dest, { departureUtc: NOW + 60e3, apiKey: 'k', nowMs: NOW }), /departureTime/);
});

// --- Mapbox ---
function mapboxBody(coords, { annotations = true } = {}) {
  const ff = snap.route.cumTime;
  const n = coords.length;
  const dur = coords.slice(1).map((_, i) => (ff[i + 1] - ff[i]) * 1.1);
  const total = dur.reduce((a, b) => a + b, 0);
  return {
    code: 'Ok',
    routes: [{
      duration: total, duration_typical: total - 240, distance: snap.route.totalDistM, weight_name: 'auto', weight: total,
      geometry: { type: 'LineString', coordinates: coords.map(([a, b]) => [b, a]) },
      legs: [{ duration: total, duration_typical: total - 240, distance: snap.route.totalDistM, summary: 'I 90', steps: [{ name: 'Massachusetts Turnpike', ref: 'I 90', distance: snap.route.totalDistM, duration: total }], annotation: annotations ? { duration: dur, distance: coords.slice(1).map((_, i) => snap.route.cumDist[i + 1] - snap.route.cumDist[i]) } : undefined }],
    }],
    waypoints: [],
  };
}

test('Mapbox: per-segment annotation durations; depart_at only for predictive; window enforced', () => {
  const r = parseMapbox(mapboxBody(snap.route.coords), { departureUtc: DEP, nowMs: NOW });
  assert.equal(r.engine, 'Mapbox');
  assert.equal(r.traffic.timing, 'per-segment durations');
  assert.ok(monotonic(r.cumTime));
  assert.ok(Math.abs(r.totalSec - snap.route.totalSec * 1.1) < 1);
  assert.equal(r.traffic.freeFlowSec, null);
  assert.equal(r.traffic.trafficDelaySec, null, 'predictive Mapbox duration is historical: no delay figure invented');
  const live = parseMapbox(mapboxBody(snap.route.coords), { departureUtc: NOW, nowMs: NOW });
  assert.ok(Math.abs(live.traffic.trafficDelaySec - 240) < 1e-6);
  const scaled = parseMapbox(mapboxBody(snap.route.coords, { annotations: false }), { departureUtc: DEP, nowMs: NOW });
  assert.equal(scaled.traffic.timing, 'scaled total, not per-segment');
  assert.match(mapboxUrl(snap.origin, snap.dest, { departureUtc: DEP, apiKey: 'k', nowMs: NOW }), /driving-traffic\/.*depart_at=\d{4}-\d\d-\d\dT\d\d%3A\d\d%3A\d\dZ/);
  assert.doesNotMatch(mapboxUrl(snap.origin, snap.dest, { departureUtc: NOW - 60e3, apiKey: 'k', nowMs: NOW }), /depart_at/, 'past/near-now never sends depart_at');
  assert.throws(() => mapboxUrl(snap.origin, snap.dest, { departureUtc: NOW + MAPBOX_MAX_AHEAD_MS + H, apiKey: 'k', nowMs: NOW }), /too far ahead/);
});

test('helpers: anchors interpolate by distance and never run backwards; scale keeps shape', () => {
  const coords = [[0, 0], [0, 0.01], [0, 0.02], [0, 0.03]];
  const cd = cumulativeDistance(coords);
  const ct = cumTimeFromAnchors(cd, [{ idx: 0, t: 0 }, { idx: 2, t: 100 }, { idx: 3, t: 90 }]);
  assert.ok(monotonic(Array.from(ct)));
  assert.ok(Math.abs(ct[1] - 50) < 1e-6);
  assert.deepEqual(scaleCumTime([0, 10, 30], 60), [0, 20, 60]);
});

// --- errors ---
for (const [status, re] of [[401, /invalid or missing key/], [403, /forbidden/], [429, /rate limit or free-tier quota/]]) {
  test(`errors: HTTP ${status} -> friendly message without the key; planner falls back to free-flow with a warning`, async () => {
    const f = mockFetch([[/api\.tomtom\.com/, () => ({ status, body: { error: { description: `bad key=${KEY}` }, detailedError: { message: 'x' } } })]]);
    await assert.rejects(routeWithTraffic(snap.origin, snap.dest, { provider: 'tomtom', departureUtc: DEP, apiKey: KEY, fetchImpl: f, nowMs: NOW }), (e) => re.test(e.message) && !e.message.includes(KEY));
    const f2 = mockFetch([[/api\.tomtom\.com/, () => ({ status, body: {} })], [/project-osrm/, () => ({ body: osrmBody() })], [/valhalla/, () => new TypeError('offline')], forecastRoute]);
    const model = await buildTripModel({ origin: snap.origin, dest: snap.dest, departureUtc: DEP, places, fetchImpl: f2, nowMs: NOW, traffic: { provider: 'tomtom', apiKey: KEY } });
    assert.equal(model.route.engine, 'OSRM');
    assert.equal(model.source.traffic.mode, 'none');
    assert.match(model.source.traffic.error, re);
    assert.ok(model.warnings.some((w) => /Traffic-aware routing failed/.test(w) && re.test(w) && !w.includes(KEY)));
  });
}

test('no key / provider none: behaves exactly as before (no traffic request, no traffic provenance)', async () => {
  const f = mockFetch([[/valhalla/, () => new TypeError('offline')], [/project-osrm/, () => ({ body: osrmBody() })], forecastRoute]);
  const m = await buildTripModel({ origin: snap.origin, dest: snap.dest, departureUtc: DEP, places, fetchImpl: f, nowMs: NOW, traffic: { provider: 'tomtom', apiKey: '' } });
  assert.equal(m.source.traffic, null);
  assert.ok(!f.calls.some((u) => u.includes('tomtom')));
});

// --- propagation into evaluateTrip ---
test('traffic timing propagates into evaluateTrip arrival times, forecast hours and sun; manual delay stacks on top', async () => {
  const ffF = mockFetch([[/valhalla/, () => new TypeError('offline')], [/project-osrm/, () => ({ body: osrmBody() })], forecastRoute]);
  const ff = await buildTripModel({ origin: snap.origin, dest: snap.dest, departureUtc: DEP, places, fetchImpl: ffF, nowMs: NOW });
  const tf = mockFetch([[/api\.tomtom\.com/, () => ({ body: tomtomBody(snap.route.coords, { delaySec: 2700 }) })], forecastRoute]);
  const tm = await buildTripModel({ origin: snap.origin, dest: snap.dest, departureUtc: DEP, places, fetchImpl: tf, nowMs: NOW, traffic: { provider: 'tomtom', apiKey: KEY } });
  assert.ok(tf.calls[0].includes('api.tomtom.com') && tf.calls[0].includes('traffic=true') && tf.calls[0].includes('sectionType=traffic'));
  assert.equal(tm.route.engine, 'TomTom');
  assert.equal(tm.source.traffic.mode, 'predictive');
  const a = evaluateTrip(ff, DEP);
  const b = evaluateTrip(tm, DEP);
  assert.ok(Math.abs((b.arrivalUtc - a.arrivalUtc) / 1000 - 2700) < 5, 'arrival is later by the traffic delay');
  const hourChanged = tm.pointIdx.filter((i) => Math.floor(b.rows[i].t / H) !== Math.floor(a.rows[i].t / H)).length;
  assert.ok(hourChanged > 0, 'some forecast checkpoints move to a different hour');
  const last = b.rows.length - 1;
  assert.notEqual(b.rows[last].sun.altitude, a.rows[last].sun.altitude);
  assert.equal(b.delay.extraSec, 0, 'traffic is not reported as a manual delay');
  const c = evaluateTrip(tm, DEP, { delay: { minutes: 30, where: 'end' } });
  assert.ok(Math.abs((c.arrivalUtc - b.arrivalUtc) / 1000 - 1800) < 1, 'manual delay is added on top of traffic timing');
});
