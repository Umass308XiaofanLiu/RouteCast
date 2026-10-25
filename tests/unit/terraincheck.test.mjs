import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGlareWindows, pickSamples, windowStatus, terrainLine } from '../../src/lib/terraincheck.js';
import { createDemSampler } from '../../src/lib/demsampler.js';

// Synthetic westbound sunset stretch at 40°N, 100°W: 10 samples, sun low in the west.
function fixture({ n = 10, sunAlt = 3, sunAz = 270 } = {}) {
  const samples = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    samples.push({ lat: 40, lon: -100 - i * 0.01, heading: 270 });
    rows.push({ t: i * 60000, sun: { altitude: sunAlt, azimuth: sunAz }, glare: { severity: i === 0 ? 0 : 3, score: i === 5 ? 9 : 2, offset: 0 } });
  }
  const model = { samples };
  const ev = { rows, windows: { glare: [[0, n - 1]] } };
  const desc = { a: 0, b: n - 1, peak: 5 };
  return { model, ev, desc };
}
const flat = async () => 50;
// North–south ridge ~900 m above the plain, 2.5–10 km west of the samples (lon −100.12…−100.16).
const ridgeWestOf = () => async (lat, lon) => (lon < -100.12 && lon > -100.16 ? 950 : 50);

test('pickSamples: glare ≥ 1 only, bounded, includes the peak', () => {
  const { ev, desc } = fixture({ n: 30 });
  const p = pickSamples(ev, { ...desc, peak: 17 }, 6);
  assert.ok(p.length <= 6 && p.length >= 5);
  assert.ok(p.includes(17));
  assert.ok(!p.includes(0), 'sample with glare 0 is skipped');
});

test('ridge west of a westbound sunset route → terrain-may-hide', async () => {
  const { model, ev, desc } = fixture();
  const [r] = await checkGlareWindows(model, ev, [desc], { sampleElevation: ridgeWestOf(model) });
  assert.equal(r.status, 'terrain-may-hide');
  assert.ok(r.blocked >= 1 && r.blocked / r.checked >= 0.5);
  assert.match(terrainLine(r), /hills likely hide the low sun/);
});

test('same ridge does not block a sun in the east (ridge behind)', async () => {
  const { model, ev, desc } = fixture({ sunAz: 90 });
  const [r] = await checkGlareWindows(model, ev, [desc], { sampleElevation: ridgeWestOf(model) });
  assert.equal(r.status, 'open');
});

test('flat terrain → open', async () => {
  const { model, ev, desc } = fixture();
  const [r] = await checkGlareWindows(model, ev, [desc], { sampleElevation: flat });
  assert.equal(r.status, 'open');
  assert.equal(r.visible, r.checked);
  assert.match(terrainLine(r), /open horizon toward the sun/);
});

test('all-null elevation → unknown, never blocked; throwing sampler also unknown', async () => {
  const { model, ev, desc } = fixture();
  for (const s of [async () => null, async () => { throw new Error('x'); }]) {
    const [r] = await checkGlareWindows(model, ev, [desc], { sampleElevation: s });
    assert.equal(r.status, 'unknown');
    assert.equal(r.blocked, 0);
    assert.match(terrainLine(r), /unavailable/);
  }
});

test('abort rejects with AbortError and stops sampling', async () => {
  const { model, ev, desc } = fixture();
  const ctrl = new AbortController();
  let calls = 0;
  const slow = async () => {
    calls++;
    if (calls === 5) ctrl.abort();
    await new Promise((r) => setTimeout(r, 1));
    return 50;
  };
  await assert.rejects(checkGlareWindows(model, ev, [desc], { sampleElevation: slow, signal: ctrl.signal }), { name: 'AbortError' });
  const after = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls <= after + 4, 'no further rays after abort');
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(checkGlareWindows(model, ev, [desc], { sampleElevation: flat, signal: pre.signal }), { name: 'AbortError' });
});

test('concurrency is bounded to ≤ 4 rays', async () => {
  const { model, ev, desc } = fixture({ n: 40 });
  let inflight = 0;
  let max = 0;
  const s = async () => {
    inflight++;
    max = Math.max(max, inflight);
    await new Promise((r) => setTimeout(r, 0));
    inflight--;
    return 50;
  };
  const res = await checkGlareWindows(model, ev, [desc, { ...desc }], { sampleElevation: s, maxSamplesPerWindow: 6, concurrency: 16 });
  assert.ok(max <= 4 && max >= 2, `max in flight ${max}`);
  assert.equal(res.length, 2);
});

test('glare severity, scores and windows are untouched', async () => {
  const { model, ev, desc } = fixture();
  const before = JSON.stringify(ev);
  await checkGlareWindows(model, ev, [desc], { sampleElevation: ridgeWestOf(model) });
  assert.equal(JSON.stringify(ev), before);
});

test('windowStatus aggregation rules', () => {
  assert.equal(windowStatus({ checked: 4, blocked: 2, visible: 2, unknown: 0 }), 'terrain-may-hide');
  assert.equal(windowStatus({ checked: 4, blocked: 1, visible: 3, unknown: 0 }), 'partly');
  assert.equal(windowStatus({ checked: 4, blocked: 0, visible: 4, unknown: 0 }), 'open');
  assert.equal(windowStatus({ checked: 4, blocked: 0, visible: 0, unknown: 4 }), 'unknown');
  assert.equal(windowStatus({ checked: 0, blocked: 0, visible: 0, unknown: 0 }), 'unknown');
});

test('demsampler: decodes terrarium, de-dups in-flight tiles, failures → null, LRU bound', async () => {
  // 100 m everywhere: r*256 + g + b/256 − 32768 = 100 → r=128, g=100, b=0.
  const tile = new Uint8ClampedArray(256 * 256 * 4);
  for (let o = 0; o < tile.length; o += 4) tile.set([128, 100, 0, 255], o);
  let fetches = 0;
  const s = createDemSampler({ zoom: 12, maxTiles: 2, fetchTile: async () => (fetches++, tile) });
  const v = await Promise.all([s(40, -100), s(40.0001, -100.0001), s(40, -100)]);
  assert.deepEqual(v, [100, 100, 100]);
  assert.equal(fetches, 1);
  await s(41, -101);
  await s(42, -102);
  await s(40, -100); // evicted (maxTiles 2) → refetched
  assert.equal(fetches, 4);
  const bad = createDemSampler({ fetchTile: async () => { throw new Error('offline'); } });
  assert.equal(await bad(40, -100), null);
  assert.equal(await bad(NaN, 0), null);
  const empty = createDemSampler({ fetchTile: async () => null });
  assert.equal(await empty(40, -100), null);
});
