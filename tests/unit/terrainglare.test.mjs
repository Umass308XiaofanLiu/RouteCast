// Terrain-adjusted expected glare (src/lib/terrainglare.js): separate from geometric (r.glare) and
// cloud-adjusted (r.expected) glare. No network: synthetic samplers + recorded DEM fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { terrainAdjustedGlare, terrainAdjustedLine, terrainKpiNote, TERRAIN_LABEL } from '../../src/lib/terrainglare.js';
import { checkGlareWindows, MAX_TOTAL_RAYS } from '../../src/lib/terraincheck.js';
import { createDemSampler } from '../../src/lib/demsampler.js';
import { fixtureFetchTile, FIXTURE_DIR } from '../../scripts/horizon-probe.mjs';

// n rows one minute apart, all strong glare (geometric 3, cloud-adjusted 2) except row 0.
function trip({ n = 11, lat = 40, lon = -100, dLon = -0.002, sunAlt = 2, sunAz = 270, expected = 2 } = {}) {
  const samples = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    samples.push({ lat, lon: lon + i * dLon, heading: 270 });
    rows.push({ t: i * 60000, sun: { altitude: sunAlt, azimuth: sunAz }, glare: { severity: i === 0 ? 0 : 3 }, expected: i === 0 ? 0 : expected });
  }
  return { model: { samples }, ev: { rows } };
}
const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
};
const win = (a, b, verdicts) => ({ a, b, checked: Object.keys(verdicts).length, samples: Object.entries(verdicts).map(([i, verdict]) => ({ i: Number(i), verdict })) });

test('checked blocked → 0 "terrain likely hides the sun"; visible/unknown unchanged; ev never mutated', () => {
  const { ev } = trip();
  deepFreeze(ev); // any write to r.glare / r.expected would throw
  const adj = terrainAdjustedGlare(ev, [win(0, 10, { 2: 'blocked', 5: 'visible', 8: 'unknown' })]);
  assert.equal(adj.ev, ev);
  assert.deepEqual(adj.bySample.get(2), { verdict: 'blocked', source: 'checked', expected: 0, label: 'terrain likely hides the sun' });
  assert.equal(adj.bySample.get(5).expected, 2);
  assert.equal(adj.bySample.get(5).verdict, 'visible');
  assert.deepEqual(adj.bySample.get(8), { verdict: 'unknown', source: 'checked', expected: 2, label: TERRAIN_LABEL.unknown });
  assert.equal(TERRAIN_LABEL.unknown, 'not checked');
  assert.equal(adj.bySample.has(0), false, 'no-glare row is not part of the result');
  assert.equal(ev.rows[2].expected, 2);
  assert.equal(ev.rows[2].glare.severity, 3);
});

test('interpolation only between agreeing neighbours inside the window; otherwise unknown', () => {
  const { ev } = trip({ n: 13 });
  const adj = terrainAdjustedGlare(ev, [win(1, 12, { 2: 'blocked', 5: 'blocked', 8: 'visible', 11: 'unknown' })]);
  for (const i of [3, 4]) assert.deepEqual([adj.bySample.get(i).verdict, adj.bySample.get(i).source, adj.bySample.get(i).expected], ['blocked', 'interpolated', 0]);
  for (const i of [6, 7]) assert.equal(adj.bySample.get(i).verdict, 'unknown', `disagreeing neighbours at ${i}`);
  for (const i of [9, 10]) assert.equal(adj.bySample.get(i).verdict, 'unknown', `neighbour unknown at ${i}`);
  assert.equal(adj.bySample.get(1).verdict, 'unknown', 'only one checked neighbour (right)');
  assert.equal(adj.bySample.get(12).verdict, 'unknown', 'only one checked neighbour (left)');
  for (const i of [6, 7, 9, 10, 1, 12]) assert.equal(adj.bySample.get(i).expected, ev.rows[i].expected, 'unknown keeps cloud-adjusted glare');
});

test('two windows do not interpolate across each other', () => {
  const { ev } = trip({ n: 13 });
  const adj = terrainAdjustedGlare(ev, [win(1, 5, { 4: 'blocked' }), win(6, 12, { 8: 'blocked' })]);
  assert.equal(adj.bySample.get(5).verdict, 'unknown');
  assert.equal(adj.bySample.get(6).verdict, 'unknown');
});

test('window minutes, card line and KPI note', () => {
  const { ev } = trip(); // rows 1..10 strong; window [0,10] → 10 strong minutes ([t_i, t_i+1), i < b)
  const adj = terrainAdjustedGlare(ev, [win(0, 10, { 1: 'blocked', 3: 'blocked', 5: 'blocked', 7: 'visible', 9: 'visible' })]);
  const w = adj.windows.get(0);
  assert.equal(w.strongMin, 9); // rows 1..9 (row 0 has no glare)
  assert.equal(w.hiddenMin, 5); // rows 1..5
  assert.equal(w.unknownMin, 1); // row 6 (blocked | visible)
  assert.equal(w.terrainStrongMin, 4);
  assert.equal(terrainAdjustedLine(w), 'Terrain-adjusted strong glare: 4 of 9 min (1 min not checked, left unchanged)');
  assert.equal(terrainKpiNote(adj), '(terrain check: hills may hide ~5 of 9 strong min)');
  assert.equal(terrainKpiNote(null, { failed: true }), '(terrain check: unavailable)');
  const open = terrainAdjustedGlare(ev, [win(0, 10, { 1: 'visible', 9: 'visible' })]);
  assert.equal(terrainAdjustedLine(open.windows.get(0)), 'Terrain-adjusted strong glare: 9 of 9 min');
  assert.equal(terrainKpiNote(open), '(terrain check: no hills in the way at checked points)');
  const none = terrainAdjustedGlare(ev, [win(0, 10, { 1: 'unknown' })]);
  assert.equal(terrainKpiNote(none), '(terrain check: inconclusive)');
  assert.equal(terrainAdjustedLine(none.windows.get(0)), "", "nothing conclusive → no adjusted line");
});

test('ray cap: ≤ MAX_TOTAL_RAYS (60) horizon rays per evaluation over many windows', async () => {
  assert.equal(MAX_TOTAL_RAYS, 60);
  const { model, ev } = trip({ n: 241 });
  const descs = Array.from({ length: 24 }, (_, k) => ({ a: 1 + k * 10, b: 10 + k * 10, peak: 5 + k * 10 }));
  const res = await checkGlareWindows(model, ev, descs, { sampleElevation: async () => 50, maxTotalRays: 500 });
  const rays = res.reduce((n, r) => n + r.checked, 0);
  assert.ok(rays <= 60 && rays >= 48, `${rays} rays`);
  assert.ok(res.every((r) => r.checked >= 1), 'every window gets at least one ray while the budget allows');
  const many = Array.from({ length: 80 }, (_, k) => ({ a: 1 + k * 3, b: 3 + k * 3, peak: 2 + k * 3 }));
  const res2 = await checkGlareWindows(model, ev, many, { sampleElevation: async () => 50 });
  assert.equal(res2.reduce((n, r) => n + r.checked, 0), 60);
  assert.ok(res2.some((r) => r.capped && r.checked === 0), 'windows past the budget are marked capped, not guessed');
  const adj = terrainAdjustedGlare(ev, res2);
  const capped = res2.find((r) => r.capped && !r.checked);
  assert.equal(adj.bySample.get(capped.a).verdict, 'unknown');
});

test('abort stops the check (AbortError) and nothing is reported', async () => {
  const { model, ev } = trip();
  const ctrl = new AbortController();
  const slow = (lat, lon, { signal } = {}) => new Promise((res) => setTimeout(() => res(signal?.aborted ? null : 50), 5));
  const p = checkGlareWindows(model, ev, [{ a: 0, b: 10, peak: 5 }], { sampleElevation: slow, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 1);
  await assert.rejects(p, { name: 'AbortError' });
});

// Real recorded terrain (tests/fixtures/dem): I-90 Berkshires westbound (ridge ~2.8 km W) vs Ohio plain.
const fixtureSampler = () => createDemSampler({ zoom: 12, fetchTile: fixtureFetchTile(FIXTURE_DIR) });
const RAY = { maxDistM: 8000 };

test('recorded DEM: Berkshire ridge hides a 2° sun (terrain-adjusted 0); Ohio plain leaves it unchanged; cache reused', async () => {
  const sampler = fixtureSampler();
  const berk = trip({ n: 6, lat: 42.33, lon: -73.32, dLon: 0.0004, sunAz: 258, sunAlt: 2 });
  const desc = [{ a: 1, b: 5, peak: 3 }];
  const res = await checkGlareWindows(berk.model, berk.ev, desc, { sampleElevation: sampler, horizonOpts: RAY });
  assert.equal(res[0].status, 'terrain-may-hide');
  const adj = terrainAdjustedGlare(berk.ev, res);
  const blocked = [...adj.bySample.values()].filter((s) => s.verdict === 'blocked');
  assert.ok(blocked.length >= 3 && blocked.every((s) => s.expected === 0 && s.label === 'terrain likely hides the sun'));
  assert.ok(berk.ev.rows.every((r, i) => r.expected === (i === 0 ? 0 : 2)), 'cloud-adjusted glare untouched');
  // Re-evaluation of the same route: decoded tiles are reused, no new tile request.
  const requested = sampler.stats.requested;
  await checkGlareWindows(berk.model, berk.ev, desc, { sampleElevation: sampler, horizonOpts: RAY });
  assert.equal(sampler.stats.requested, requested, 'DEM cache reused');

  const ohio = trip({ n: 6, lat: 41.456, lon: -83.46, dLon: -0.0004, sunAz: 265, sunAlt: 2 });
  const r2 = await checkGlareWindows(ohio.model, ohio.ev, desc, { sampleElevation: fixtureSampler(), horizonOpts: { maxDistM: 10000 } });
  assert.equal(r2[0].status, 'open');
  const adj2 = terrainAdjustedGlare(ohio.ev, r2);
  assert.ok([...adj2.bySample.values()].every((s) => s.verdict === 'visible' && s.expected === 2));
  assert.equal(terrainAdjustedLine(adj2.windows.get(1)), 'Terrain-adjusted strong glare: 4 of 4 min');
});

test('missing DEM tiles → unknown (unchanged), never blocked', async () => {
  const { model, ev } = trip({ n: 6, lat: 10, lon: 10 }); // no fixture there
  const res = await checkGlareWindows(model, ev, [{ a: 1, b: 5, peak: 3 }], { sampleElevation: fixtureSampler() });
  const adj = terrainAdjustedGlare(ev, res);
  assert.ok([...adj.bySample.values()].every((s) => s.verdict === 'unknown' && s.expected === 2));
});
