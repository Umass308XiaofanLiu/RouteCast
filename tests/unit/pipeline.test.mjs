import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookupForecast, pickForecastPoints, assignSamplesToPoints, normalizeOpenMeteo } from '../../src/lib/forecast.js';
import { geocode, getRoute, fetchForecasts, forecastHorizonEnd, ProviderError } from '../../src/lib/providers.js';
import { fromSnapshot, buildTripModel } from '../../src/lib/planner.js';
import { evaluateTrip, elapsedWithBreaks, BREAK_PLANS, findWindows } from '../../src/lib/trip.js';
import { optimizeDeparture, exposureScore } from '../../src/lib/optimizer.js';
import { buildAdvice } from '../../src/lib/advice.js';
import { makeFormatter } from '../../src/lib/units.js';

const places = JSON.parse(readFileSync(new URL('../../src/data/us_places.json', import.meta.url)));
const snap = (name) => JSON.parse(readFileSync(new URL(`../../public/fixtures/${name}`, import.meta.url)));
const H = 3600e3;
const T0 = Date.UTC(2026, 9, 25, 12);

function series(n = 6) {
  const times = Array.from({ length: n }, (_, i) => T0 + i * H);
  return {
    times,
    temperature: times.map((_, i) => 10 + i),
    precipitation: [0, 0, 1, 2, 0, 0],
    rain: [0, 0, 1, 2, 0, 0],
    snowfall: [0, 0, 0, 0, 0, 0],
    precipProbability: [0, 10, 60, 80, 20, 0],
    weatherCode: [0, 1, 61, 63, 3, 0],
    cloudCover: [0, 20, 100, 100, 80, 40],
    visibility: [24000, 24000, 9000, 6000, 20000, 24000],
    windSpeed: [10, 20, 30, 40, 30, 20],
    windDirection: [0, 90, 180, 270, 0, 90],
    windGusts: [15, 30, 45, 60, 45, 30],
  };
}

test('forecast: instantaneous values interpolate; preceding-hour values use the hour ending after t', () => {
  const s = series();
  const v = lookupForecast(s, T0 + 2.25 * H);
  assert.ok(Math.abs(v.temperature - 12.25) < 1e-9);
  assert.equal(v.precipitation, 2); // bin (14:00Z, 15:00Z]
  assert.equal(v.windGusts, 60);
  assert.equal(v.weatherCode, 61); // nearest hour
  assert.equal(v.windDirection, 180);
  const exact = lookupForecast(s, T0 + 2 * H);
  assert.equal(exact.precipitation, 1);
});

test('forecast: outside the window returns null instead of a guess', () => {
  const s = series();
  assert.equal(lookupForecast(s, T0 - 2 * H), null);
  assert.equal(lookupForecast(s, T0 + 7 * H), null);
  assert.equal(lookupForecast({ times: [] }, T0), null);
  assert.equal(lookupForecast(undefined, T0), null);
});

test('forecast: normalizeOpenMeteo converts unix seconds and keeps nulls', () => {
  const n = normalizeOpenMeteo({ latitude: 1, longitude: 2, timezone: 'America/Chicago', hourly: { time: [1761393600], temperature_2m: [null], precipitation: [0], rain: [0], snowfall: [0], precipitation_probability: [null], weather_code: [0], cloud_cover: [5], visibility: [null], wind_speed_10m: [3], wind_direction_10m: [10], wind_gusts_10m: [9] } });
  assert.equal(n.times[0], 1761393600000);
  assert.equal(n.temperature[0], null);
  assert.equal(n.timezone, 'America/Chicago');
  assert.throws(() => normalizeOpenMeteo({}), /hourly/);
});

test('breaks: elapsed time adds completed breaks but none at arrival', () => {
  assert.equal(elapsedWithBreaks(3600, 20000, BREAK_PLANS.short), 3600);
  assert.equal(elapsedWithBreaks(7300, 20000, BREAK_PLANS.short), 7300 + 900);
  assert.equal(elapsedWithBreaks(14400, 14400, BREAK_PLANS.short), 14400 + 900); // break at 2 h, not at the 4 h arrival
  assert.equal(elapsedWithBreaks(5000, 5000, BREAK_PLANS.none), 5000);
});

test('windows: consecutive matches group with gap tolerance', () => {
  const rows = [1, 1, 0, 1, 0, 0, 0, 1].map((x) => ({ x }));
  assert.deepEqual(findWindows(rows, (r) => r.x === 1, 1), [[0, 3], [7, 7]]);
  assert.deepEqual(findWindows(rows, (r) => r.x === 1, 0), [[0, 1], [3, 3], [7, 7]]);
});

function mockFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [re, handler] of routes) {
      if (re.test(url)) {
        const r = await handler(url);
        if (r instanceof Error) throw r;
        return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
      }
    }
    throw new TypeError('network down');
  };
  fn.calls = calls;
  return fn;
}

test('providers: geocode filters by state abbreviation and maps timezone', async () => {
  const f = mockFetch([[/geocoding-api/, () => ({ body: { results: [
    { id: 1, name: 'Amherst', admin1: 'New York', admin2: 'Erie', latitude: 42.98, longitude: -78.8, timezone: 'America/New_York' },
    { id: 2, name: 'Amherst', admin1: 'Massachusetts', admin2: 'Hampshire', latitude: 42.37, longitude: -72.52, timezone: 'America/New_York' },
  ] } })]]);
  const r = await geocode('Amherst, MA', { fetchImpl: f });
  assert.equal(r.length, 1);
  assert.equal(r[0].label, 'Amherst, MA');
  assert.equal(r[0].timezone, 'America/New_York');
  assert.deepEqual(await geocode('A', { fetchImpl: f }), []);
});

test('providers: routing falls back from Valhalla to OSRM and never fabricates a straight line', async () => {
  const osrm = { routes: [{ duration: 200, geometry: { coordinates: [[-72, 42], [-71.9, 42], [-71.8, 42]] }, legs: [{ annotation: { duration: [150, 50] }, steps: [{ name: 'Main St', ref: 'I 90', distance: 16560 }] }] }] };
  const f = mockFetch([[/valhalla/, () => ({ status: 503, body: { error: 'busy' } })], [/project-osrm/, () => ({ body: osrm })]]);
  const { route, warnings } = await getRoute({ lat: 42, lon: -72 }, { lat: 42, lon: -71.8 }, { fetchImpl: f });
  assert.equal(route.engine, 'OSRM');
  assert.deepEqual(route.cumTime, [0, 150, 200]);
  assert.equal(route.roads[0].name, 'I 90');
  assert.match(warnings[0], /busy/);
  const dead = mockFetch([]);
  await assert.rejects(getRoute({ lat: 42, lon: -72 }, { lat: 42, lon: -71.8 }, { fetchImpl: dead }), (e) => e instanceof ProviderError && /No driving route/.test(e.message));
});

test('providers: forecast request clamps to the horizon and rejects trips beyond it', async () => {
  const now = Date.UTC(2026, 9, 24, 20);
  let seen = '';
  const f = mockFetch([[/api\.open-meteo/, (url) => {
    seen = url;
    return { body: [{ latitude: 42, longitude: -72, timezone: 'America/New_York', hourly: { time: [], temperature_2m: [] } }, { latitude: 41, longitude: -87, timezone: 'America/Chicago', hourly: { time: [], temperature_2m: [] } }] };
  }]]);
  const out = await fetchForecasts([{ lat: 42, lon: -72 }, { lat: 41, lon: -87 }], now + H, now + 40 * 864e5, { fetchImpl: f, nowMs: now });
  assert.equal(out.length, 2);
  assert.equal(out[1].timezone, 'America/Chicago');
  assert.match(seen, /timeformat=unixtime/);
  assert.match(seen, new RegExp(`end_date=${new Date(forecastHorizonEnd(now)).toISOString().slice(0, 10)}`));
  await assert.rejects(fetchForecasts([{ lat: 42, lon: -72 }], now + 30 * 864e5, now + 31 * 864e5, { fetchImpl: f, nowMs: now }), /horizon/);
  const down = mockFetch([]);
  await assert.rejects(fetchForecasts([{ lat: 42, lon: -72 }], now, now + H, { fetchImpl: down, nowMs: now }), /unreachable/);
});

test('planner: buildTripModel wires route -> samples -> one multi-point forecast request', async () => {
  const s = snap('albany-boston.json');
  const valhallaLike = null; // use the recorded normalized route through an OSRM-shaped mock
  void valhallaLike;
  const coords = s.route.coords;
  const durations = coords.slice(1).map((_, i) => s.route.cumTime[i + 1] - s.route.cumTime[i]);
  const osrm = { routes: [{ duration: s.route.totalSec, geometry: { coordinates: coords.map(([a, b]) => [b, a]) }, legs: [{ annotation: { duration: durations }, steps: s.route.roads.map((r) => ({ name: r.name, distance: r.toM - r.fromM })) }] }] };
  const f = mockFetch([
    [/valhalla/, () => new TypeError('offline')],
    [/project-osrm/, () => ({ body: osrm })],
    [/api\.open-meteo/, (url) => {
      const n = new URL(url).searchParams.get('latitude').split(',').length;
      return { body: s.forecasts.slice(0, n).map((x) => ({ latitude: x.lat, longitude: x.lon, timezone: x.timezone, hourly: { time: x.times.map((t) => t / 1000), temperature_2m: x.temperature, precipitation: x.precipitation, rain: x.rain, snowfall: x.snowfall, precipitation_probability: x.precipProbability, weather_code: x.weatherCode, cloud_cover: x.cloudCover, visibility: x.visibility, wind_speed_10m: x.windSpeed, wind_direction_10m: x.windDirection, wind_gusts_10m: x.windGusts } })) };
    }],
  ]);
  const model = await buildTripModel({ origin: s.origin, dest: s.dest, departureUtc: s.departureUtc, places, fetchImpl: f, nowMs: s.capturedAt });
  assert.equal(model.route.engine, 'OSRM');
  assert.equal(model.warnings.length, 1);
  assert.equal(f.calls.filter((u) => u.includes('api.open-meteo')).length, 1);
  assert.equal(model.forecasts.length, model.pointIdx.length);
  const ev = evaluateTrip(model, s.departureUtc);
  assert.equal(ev.totals.missingMin, 0);
});

test('snapshot: Amherst -> Chicago crosses into Central time and arrival = departure + routed time', () => {
  const s = snap('amherst-chicago.json');
  const model = fromSnapshot(s, places);
  const ev = evaluateTrip(model, s.departureUtc);
  assert.ok(Math.abs((ev.arrivalUtc - ev.departureUtc) / 1000 - model.route.totalSec) < 1, 'arrival = departure + routed drive time');
  assert.equal(ev.rows[0].timezone, 'America/New_York');
  assert.equal(ev.rows[ev.rows.length - 1].timezone, 'America/Chicago');
  assert.ok(ev.rows.every((r, i) => i === 0 || r.t >= ev.rows[i - 1].t), 'arrival times increase along the route');
  assert.equal(ev.totals.missingMin, 0);
  // Westbound into the late-October sunset: glare near sunset, darkness at the end.
  const glare = ev.windows.glare.map(([a]) => ev.rows[a]);
  assert.ok(glare.some((r) => r.sun.azimuth > 200), 'a westbound sunset glare window exists');
  assert.equal(ev.rows[ev.rows.length - 1].phase, 'night');
  const withBreaks = evaluateTrip(model, s.departureUtc, { breakPlan: BREAK_PLANS.short });
  assert.equal(withBreaks.arrivalUtc - ev.arrivalUtc, 7 * 900e3); // 14.4 h of driving -> 7 breaks
});

test('snapshot: Albany -> Boston eastbound sunrise produces a sunrise glare recommendation', () => {
  const s = snap('albany-boston.json');
  const model = fromSnapshot(s, places);
  const opt = optimizeDeparture(model, s.departureUtc, {}, { nowMs: s.capturedAt });
  const recs = buildAdvice(model, opt.base, { optimizer: opt, unitsFmt: makeFormatter('us') });
  const glare = recs.find((r) => r.kind === 'glare');
  assert.ok(glare, 'glare recommendation');
  assert.match(glare.title, /sunrise/);
  assert.match(glare.why, /above the horizon/);
  assert.ok(recs.every((r) => r.title && r.why && Array.isArray(r.actions)));
  assert.ok(!recs.some((r) => /AI|LLM/.test(r.title + r.why)), 'rules engine does not claim to be generative AI');
});

test('optimizer: candidates in the past are unavailable; scores are deterministic', () => {
  const s = snap('amherst-chicago.json');
  const model = fromSnapshot(s, places);
  const opt = optimizeDeparture(model, s.departureUtc, {}, { nowMs: s.departureUtc - 60 * 60e3 });
  const past = opt.candidates.filter((c) => !c.available).map((c) => c.offsetMin);
  assert.ok(past.includes(-180) && past.includes(-90));
  assert.ok(opt.candidates.find((c) => c.offsetMin === 0).available);
  assert.equal(opt.baseScore, exposureScore(evaluateTrip(model, s.departureUtc)));
  assert.ok(opt.best.score <= opt.current.score);
});

test('advice: synthetic snow/wind/night trip triggers the expected rules', () => {
  const s = snap('albany-boston.json');
  const model = fromSnapshot(s, places);
  const stormy = model.forecasts.map((f) => ({ ...f, snowfall: f.times.map(() => 1.2), precipitation: f.times.map(() => 1.5), temperature: f.times.map(() => -3), weatherCode: f.times.map(() => 75), windGusts: f.times.map(() => 90), windDirection: f.times.map(() => 0), cloudCover: f.times.map(() => 100) }));
  const m2 = { ...model, forecasts: stormy };
  const night = Date.UTC(2026, 9, 26, 2); // 10 PM EDT
  const ev = evaluateTrip(m2, night, { vehicle: 'high-profile' });
  const recs = buildAdvice(m2, ev, { vehicle: 'high-profile', unitsFmt: makeFormatter('us') });
  const kinds = new Set(recs.map((r) => r.kind));
  for (const k of ['snow', 'wind', 'night']) assert.ok(kinds.has(k), `has ${k}`);
  assert.ok(!kinds.has('glare'), 'no glare at night');
  assert.equal(recs[0].priority, 'high');
});

test('review fixes: long severe sunset window outranks short blips and is not called "softened"', () => {
  const s = snap('amherst-chicago.json');
  const model = fromSnapshot(s, places);
  const opt = optimizeDeparture(model, s.departureUtc, {}, { nowMs: s.capturedAt });
  const recs = buildAdvice(model, opt.base, { optimizer: opt, unitsFmt: makeFormatter('us') });
  const glare = recs.filter((r) => r.kind === 'glare');
  assert.ok(glare.length >= 1);
  const top = glare[0];
  const mins = (r) => (opt.base.rows[r.range[1]].t - opt.base.rows[r.range[0]].t) / 60000;
  assert.ok(glare.every((g) => mins(g) <= mins(top) || g.priority !== top.priority), 'longest/most exposed glare window first');
  for (const g of glare) {
    if (g.severity >= 2) assert.ok(!/soften this/.test(g.actions.join(' ')), 'strong expected glare keeps full glare actions');
    assert.ok(g.priority === 'high' ? g.severity >= 2 : true);
  }
});

test('review fixes: cloud reason names the real cause', async () => {
  const { cloudAdjustedSeverity } = await import('../../src/lib/sun.js');
  assert.match(cloudAdjustedSeverity(3, { cloudCover: 20, precipitation: 1 }).reason, /precipitation/);
  assert.match(cloudAdjustedSeverity(3, { cloudCover: 20, precipitation: 0, visibility: 500 }).reason, /fog/);
  assert.equal(cloudAdjustedSeverity(2, { cloudCover: null, precipitation: 0 }).reason, 'cloud cover unknown');
});
