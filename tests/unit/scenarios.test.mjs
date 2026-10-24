import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromSnapshot } from '../../src/lib/planner.js';
import { evaluateTrip, makeDelay, congestionAt } from '../../src/lib/trip.js';
import { SCENARIOS, buildScenarioModel } from '../../src/lib/scenarios.js';
import { rowConditions, conditionCandidates } from '../../src/lib/conditions.js';
import { optimizeDeparture } from '../../src/lib/optimizer.js';

const places = JSON.parse(readFileSync(new URL('../../src/data/us_places.json', import.meta.url)));
const snap = (n) => JSON.parse(readFileSync(new URL(`../../public/fixtures/${n}`, import.meta.url)));

test('delay: accumulates linearly across the stretch and fully afterwards', () => {
  const d = makeDelay({ minutes: 60, where: 'middle' }, 100000);
  assert.equal(congestionAt(d, 30000), 0);
  assert.equal(congestionAt(d, 50000), 1800);
  assert.equal(congestionAt(d, 70000), 3600);
  assert.equal(congestionAt(makeDelay({ minutes: 0 }, 1e5), 9e4), 0);
});

test('delay propagates to EVERY downstream point: times, forecast hour, sun position, arrival', () => {
  const s = snap('amherst-chicago.json');
  const m = fromSnapshot(s, places);
  const base = evaluateTrip(m, s.departureUtc);
  const late = evaluateTrip(m, s.departureUtc, { delay: { minutes: 90, where: 'start' } });
  const quarter = m.samples.findIndex((x) => x.distM >= 0.25 * m.route.totalDistM);
  assert.equal(late.rows[0].t, base.rows[0].t, 'departure unchanged');
  for (let i = quarter + 1; i < m.samples.length; i++) {
    assert.equal(late.rows[i].t - base.rows[i].t, 90 * 60e3, `point ${i} shifted by the full delay`);
  }
  assert.equal(late.arrivalUtc - base.arrivalUtc, 90 * 60e3);
  const shifted = m.pointIdx.filter((i) => late.rows[i].wx && late.rows[i].wx.validTime !== base.rows[i].wx.validTime).length;
  assert.ok(shifted >= m.pointIdx.length * 0.6, `forecast hour changes at most checkpoints (${shifted}/${m.pointIdx.length})`);
  const end = m.samples.length - 1;
  assert.ok(late.rows[end].sun.altitude < base.rows[end].sun.altitude - 5, 'sun recomputed for the later arrival');
  assert.ok(late.totals.nightMin > base.totals.nightMin, 'more driving after dark');
  assert.deepEqual(late.windows.jam.length, 1);
  assert.ok(late.rows.some((r) => r.congested) && !base.rows.some((r) => r.congested));
  assert.deepEqual(late.rows.map((r) => r.wx === null), base.rows.map((r) => r.wx === null), 'within the fetched forecast window');
});

test('delay changes glare timing: sunset glare moves east along the route', () => {
  const s = snap('amherst-chicago.json');
  const m = fromSnapshot(s, places);
  const base = evaluateTrip(m, s.departureUtc);
  const late = evaluateTrip(m, s.departureUtc, { delay: { minutes: 60, where: 'start' } });
  const peak = (ev) => ev.rows.reduce((b, r, i) => (r.glare.score > ev.rows[b].glare.score ? i : b), 0);
  assert.ok(peak(late) < peak(base), 'with a delay the low sun is met earlier on the route (further east)');
});

test('future departure: optimizer uses the trip clock, not the present, in snapshot/scenario mode', () => {
  const s = snap('albany-boston.json');
  const m = fromSnapshot(s, places);
  const opt = optimizeDeparture(m, s.departureUtc, {}, { nowMs: s.capturedAt });
  assert.ok(opt.candidates.every((c) => c.available), 'departure is ~14 h in the future, all ±3 h options available');
  assert.ok(s.departureUtc - s.capturedAt > 10 * 3600e3, 'this is a future trip, not current conditions');
});

test('scenarios: synthetic, reproducible, labelled, and trigger their intended conditions', () => {
  const want = { 'storm-crosswind': ['rain', 'wind'], 'sunset-glare': ['glare', 'night'], 'snow-fog-night': ['snow', 'fog', 'night'], 'congestion-shift': ['jam', 'rain'] };
  for (const scn of SCENARIOS) {
    const sn = snap(scn.route);
    const a = buildScenarioModel(scn, sn, places);
    const b = buildScenarioModel(scn, sn, places);
    assert.deepEqual(a.model.forecasts, b.model.forecasts, `${scn.id} is deterministic`);
    assert.equal(a.model.source.kind, 'synthetic');
    assert.match(a.model.source.forecast, /synthetic/);
    const ev = evaluateTrip(a.model, a.departureUtc, { vehicle: scn.vehicle, delay: scn.delay });
    assert.equal(ev.totals.missingMin, 0, `${scn.id} fully covered`);
    const cats = new Set(ev.rows.flatMap(rowConditions));
    for (const c of want[scn.id]) assert.ok(cats.has(c), `${scn.id} shows ${c}`);
    const cands = conditionCandidates(ev);
    assert.ok(cands.every((c) => rowConditions(ev.rows[c.idx]).includes(c.cat)), `${scn.id} icons sit where the condition is projected`);
  }
});

test('scenario: assumed delay pushes the New York arrival into the rain band and darkness', () => {
  const scn = SCENARIOS.find((x) => x.id === 'congestion-shift');
  const { model, departureUtc } = buildScenarioModel(scn, snap(scn.route), places);
  const free = evaluateTrip(model, departureUtc, { delay: null });
  const late = evaluateTrip(model, departureUtc, { delay: scn.delay });
  assert.equal(late.arrivalUtc - free.arrivalUtc, 75 * 60e3);
  assert.ok(late.totals.wetMin > free.totals.wetMin + 30);
  assert.ok(late.totals.nightMin > free.totals.nightMin + 30);
  assert.equal(free.rows[free.rows.length - 1].phase === 'night', false);
  assert.equal(late.rows[late.rows.length - 1].phase, 'night');
});
