// Unit tests for keyless live overlays: freshness / time scope / route matching / delay suggestion.
// Fixtures in tests/fixtures/overlays/ are REAL recorded samples (NYC DOT i4gi-tjb9 and INDOT WZDx,
// recorded 2026-10-25 ~01:30Z); see the _note field in each file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { fromSnapshot } from '../../src/lib/planner.js';
import { evaluateTrip } from '../../src/lib/trip.js';
import {
  buildRouteIndex, distToRoute, matchGeometry, parseAsOf, parseNycRows, parseLinkPoints, speedScope, isSlow, isHighway,
  matchSlowLinks, suggestDelay, nycPortion, nycUrl, parseWzdx, activeAt, matchWorkZones, feedsForRoute, fetchOverlays, evaluateOverlays,
  NEAR_TERM_MS, MAX_AGE_MS,
} from '../../src/lib/traffic/overlays/index.js';

const places = JSON.parse(readFileSync(new URL('../../src/data/us_places.json', import.meta.url)));
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const NYC_ROWS = json('../fixtures/overlays/nycdot-speeds-sample.json').rows;
const INDOT = json('../fixtures/overlays/indot-wzdx-sample.json');
const snapNyc = json('../../public/fixtures/amherst-nyc.json');
const snapChi = json('../../public/fixtures/amherst-chicago.json');
const live = (snap) => {
  const m = fromSnapshot(snap, places);
  m.source = { ...m.source, kind: 'live' };
  return m;
};

test('parseAsOf: Socrata floating timestamp is NYC local time (EDT = UTC-4)', () => {
  assert.equal(new Date(parseAsOf('2026-10-24T19:57:07.000')).toISOString(), '2026-10-24T23:57:07.000Z');
  assert.equal(new Date(parseAsOf('2026-01-15T08:00:00')).toISOString(), '2026-01-15T13:00:00.000Z'); // EST
  assert.equal(parseAsOf('garbage'), null);
});

test('parseLinkPoints drops the truncated trailing pair', () => {
  assert.deepEqual(parseLinkPoints('40.1,-73.9 40.2,-73.8 40.75104,-'), [[40.1, -73.9], [40.2, -73.8]]);
});

test('parseNycRows on the real sample: newest per link, latest snapshot window only', () => {
  const p = parseNycRows(NYC_ROWS);
  assert.equal(new Date(p.asOf).toISOString(), '2026-10-24T23:57:07.000Z');
  assert.ok(p.links.length > 50);
  assert.equal(new Set(p.links.map((l) => l.id)).size, p.links.length);
  assert.ok(p.links.every((l) => l.asOf >= p.asOf - 15 * 60e3));
});

test('speedScope: only real plans, departure within 60 min, data <= 20 min old', () => {
  const now = Date.UTC(2026, 9, 25, 0, 0);
  const base = { sourceKind: 'live', departureUtc: now + 10 * 60e3, nowMs: now };
  assert.equal(speedScope({ ...base, asOf: now - 5 * 60e3 }).use, true);
  assert.equal(speedScope({ ...base, sourceKind: 'synthetic', asOf: now }).reason, 'not-real');
  assert.equal(speedScope({ ...base, sourceKind: 'snapshot', asOf: now }).reason, 'not-real');
  assert.equal(speedScope({ ...base, departureUtc: now + NEAR_TERM_MS + 1, asOf: now }).reason, 'future-departure');
  assert.equal(speedScope({ ...base, departureUtc: now + 24 * 3600e3, asOf: now }).reason, 'future-departure');
  assert.equal(speedScope({ ...base, asOf: now - MAX_AGE_MS - 1 }).reason, 'stale');
  assert.equal(speedScope({ ...base, asOf: now - MAX_AGE_MS }).use, true);
  assert.equal(speedScope({ ...base, hasNyc: false }).reason, 'no-nyc');
  assert.equal(speedScope({ ...base, asOf: now + 30 * 60e3 }).reason, 'no-data', 'future timestamp is not trusted');
  // property: any departure more than 60 min ahead is never in scope, however fresh the data
  fc.assert(fc.property(fc.integer({ min: NEAR_TERM_MS + 1, max: 14 * 864e5 }), fc.integer({ min: 0, max: MAX_AGE_MS }), (ahead, age) => !speedScope({ ...base, departureUtc: now + ahead, asOf: now - age }).use));
});

test('isSlow: < 50% of free-flow reference, or < 15 mph on highways; 0 mph = no reading', () => {
  assert.equal(isHighway('CBE W MORRIS AVE - GWB W AMSTERDAM AVE'), true);
  assert.equal(isHighway('12th Ave S 57th St - 45th St'), false);
  assert.equal(isSlow({ name: 'LIE E 84TH ST - 108TH ST', speedMph: 16.77 }), true); // < 25 (50% of 50)
  assert.equal(isSlow({ name: 'LIE WB LITTLE NECK PKWY', speedMph: 34.17 }), false);
  assert.equal(isSlow({ name: '12th Ave S 57th St - 45th St', speedMph: 14.9 }), true); // < 15 (50% of 30)
  assert.equal(isSlow({ name: '12th Ave S 57th St - 45th St', speedMph: 20 }), false);
  assert.equal(isSlow({ name: 'Westside Hwy N 57th St - GWB', speedMph: 0 }), false);
});

test('route index: distance to line matches haversine for points offset from a segment', () => {
  const idx = buildRouteIndex([[41, -74], [41, -73.99]]);
  const d = distToRoute(idx, 41.001, -73.995); // ~111 m north of the segment
  assert.ok(Math.abs(d - 111.3) < 1, String(d));
  assert.equal(distToRoute(idx, 42, -73), Infinity);
  // a crossing road with a single vertex near the route does not match; a parallel one does
  assert.equal(matchGeometry(idx, [[40.99, -73.995], [41.0002, -73.995], [41.01, -73.995]]), null);
  assert.ok(matchGeometry(idx, [[41.0005, -73.998], [41.0005, -73.994], [41.0005, -73.991]]));
});

test('NYC DOT real sample on the Amherst->NYC route: matched slow links and a delay suggestion', () => {
  const m = live(snapNyc);
  const ev = evaluateTrip(m, snapNyc.departureUtc);
  assert.ok(nycPortion(m.route.coords), 'route enters NYC');
  assert.equal(nycPortion(live(snapChi).route.coords), null, 'Chicago route never enters NYC');
  const { links } = parseNycRows(NYC_ROWS);
  const slow = matchSlowLinks(links, buildRouteIndex(m.route.coords), m, ev);
  assert.deepEqual(slow.map((l) => l.name), ['West St S Spring St - BBT Manhattan Portal outbound']);
  assert.ok(slow[0].distM <= 150);
  const sug = suggestDelay(slow, m.samples.length);
  assert.equal(sug.minutes, 15);
  assert.equal(sug.where, 'end');
  assert.equal(suggestDelay([], m.samples.length), null);
});

test('nycUrl asks for the newest rows only (no key)', () => {
  const u = new URL(nycUrl());
  assert.equal(u.origin + u.pathname, 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json');
  assert.equal(u.searchParams.get('$order'), 'data_as_of DESC');
  assert.ok(!/key|token/i.test(u.search));
});

test('WZDx: parse real INDOT sample, time overlap and route matching on the Chicago route', () => {
  const p = parseWzdx(INDOT, 'INDOT');
  assert.equal(new Date(p.feedTime).toISOString(), '2026-10-25T01:28:01.815Z');
  assert.equal(p.zones.length, INDOT.features.filter((f) => f.properties.core_details.event_type === 'work-zone').length);
  assert.equal(activeAt({ start: 10, end: 20 }, 15), true);
  assert.equal(activeAt({ start: 10, end: 20 }, 25), false);
  assert.equal(activeAt({ start: 10, end: null }, 25), true);
  const m = live(snapChi);
  const idx = buildRouteIndex(m.route.coords);
  assert.deepEqual(feedsForRoute(idx.bbox).map((f) => f.agency), ['INDOT']);
  assert.deepEqual(feedsForRoute(buildRouteIndex(m.route.coords.slice(0, 50)).bbox), [], 'MA-only route -> no Indiana feed');
  const ev = evaluateTrip(m, snapChi.departureUtc); // Oct 25 trip
  const z = matchWorkZones(p.zones, idx, m, ev);
  assert.ok(z.length >= 3, `matched ${z.length}`);
  assert.ok(z.every((x) => x.distM <= 150 && activeAt(x, x.arrivalUtc)));
  assert.ok(z.some((x) => /I-80 Toll/.test(x.road)));
  assert.ok(!z.some((x) => x.id === 'CARSy-2277'), 'IN 51 gas-main work starts Nov 2: not active on Oct 25');
  // a departure on Nov 3 makes that zone active at the projected arrival
  const later = matchWorkZones(p.zones, idx, m, evaluateTrip(m, snapChi.departureUtc + 9 * 864e5));
  assert.ok(later.some((x) => x.id === 'CARSy-2277'));
});

test('fetchOverlays: no network for synthetic/snapshot; tomorrow -> no NYC fetch; failures become notes', async () => {
  const calls = [];
  const okFetch = async (url) => {
    calls.push(url);
    const body = url.includes('cityofnewyork') ? NYC_ROWS : INDOT;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const snapModel = fromSnapshot(snapNyc, places);
  await fetchOverlays(snapModel, { departureUtc: Date.now(), fetchImpl: okFetch });
  await fetchOverlays({ ...snapModel, source: { kind: 'synthetic' } }, { departureUtc: Date.now(), fetchImpl: okFetch });
  assert.equal(calls.length, 0);

  const m = live(snapNyc);
  const asOf = parseAsOf('2026-10-24T19:57:07.000');
  const tomorrow = await fetchOverlays(m, { departureUtc: asOf + 864e5, nowMs: asOf + 60e3, fetchImpl: okFetch });
  assert.equal(calls.length, 0, 'NYC route, departure tomorrow: nothing to fetch');
  assert.equal(tomorrow.nyc, null);

  const near = await fetchOverlays(m, { departureUtc: asOf + 10 * 60e3, nowMs: asOf + 5 * 60e3, fetchImpl: okFetch });
  assert.equal(calls.length, 1);
  const ev = evaluateTrip(m, asOf + 10 * 60e3);
  const res = evaluateOverlays(near, m, ev, { nowMs: asOf + 5 * 60e3 });
  assert.equal(res.speed.slow.length, 1);
  const stale = evaluateOverlays(near, m, ev, { nowMs: asOf + 25 * 60e3 });
  assert.equal(stale.speed, null);
  assert.equal(stale.speedNote.kind, 'stale');

  const bad = await fetchOverlays(live(snapChi), { departureUtc: Date.now(), fetchImpl: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.match(bad.wzErrors[0].error, /not JSON/);
  const slow = await fetchOverlays(live(snapChi), { departureUtc: Date.now(), timeoutMs: 30, fetchImpl: (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  assert.match(slow.wzErrors[0].error, /timed out/);
  const ctrl = new AbortController();
  const p = fetchOverlays(live(snapChi), { departureUtc: Date.now(), signal: ctrl.signal, fetchImpl: (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('x')))) });
  ctrl.abort();
  await assert.rejects(p, { name: 'AbortError' });
});
