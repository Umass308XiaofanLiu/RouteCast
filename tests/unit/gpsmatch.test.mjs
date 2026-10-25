// snapFix: GPS fix → planned-route sample with hysteresis (synthetic fix sequences, no devices).
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapFix } from '../../src/lib/geo.js';

// Straight east→west route: 200 samples ~0.83 km apart along lat 42.
const samples = Array.from({ length: 200 }, (_, i) => ({ lat: 42, lon: -72 - i * 0.01 }));
const at = (i, { dLat = 0, accuracy = 20 } = {}) => ({ lat: 42 + dLat, lon: -72 - i * 0.01, accuracy });

/** Feed a sequence of fixes, returning every result. */
function run(fixes, prev = null) {
  const out = [];
  let state = prev;
  for (const f of fixes) {
    const r = snapFix(samples, f, state);
    out.push(r);
    state = r.state;
  }
  return out;
}

test('forward drive follows each fix monotonically', () => {
  const r = run([0, 3, 7, 12, 20, 40].map((i) => at(i)));
  assert.deepEqual(r.map((x) => x.index), [0, 3, 7, 12, 20, 40]);
  assert.ok(r.every((x) => x.status === 'ok' && !x.held && !x.wrongWay));
});

test('jitter around a position never moves it backwards', () => {
  // ~0.3 sample of along-track noise either way, plus small lateral noise
  const idx = [50, 49.6, 50.4, 49.7, 50.2, 49.8, 51, 50.6, 52].map((v, k) => at(v, { dLat: (k % 2 ? 1 : -1) * 0.0004 }));
  const r = run(idx);
  for (let k = 1; k < r.length; k++) assert.ok(r[k].index >= r[k - 1].index - 2, `step ${k}: ${r[k - 1].index}→${r[k].index}`);
  for (let k = 1; k < r.length; k++) assert.ok(r[k].index >= r[k - 1].index, 'held, not moved back');
  assert.equal(r.at(-1).index, 52);
  assert.ok(r.every((x) => !x.wrongWay));
});

test('a single backward jump is held; a sustained one is accepted and flagged wrong way', () => {
  const r = run([at(60), at(61), at(30), at(62)]);
  assert.deepEqual(r.map((x) => x.index), [60, 61, 61, 62]);
  assert.equal(r[2].held, true);
  // real reversal: consistently decreasing matches
  const back = run([at(60), at(58), at(55), at(52), at(49)]);
  assert.deepEqual(back.map((x) => x.index), [60, 60, 60, 52, 49]);
  assert.ok(back[1].held && back[2].held && !back[3].held);
  assert.equal(back[1].wrongWay, false, 'one step back is not yet "wrong way"');
  assert.equal(back[3].wrongWay, true);
  assert.equal(back[4].wrongWay, true);
  // driving forward again clears the hint
  const fwd = snapFix(samples, at(51), back.at(-1).state);
  assert.equal(fwd.wrongWay, false);
  assert.equal(fwd.index, 51);
});

test('off-route excursion leaves the position unchanged; the return snaps freely', () => {
  const r = run([at(80), at(81, { dLat: 0.05 }), at(81, { dLat: 0.2 }), at(78), at(79)]);
  assert.deepEqual(r.map((x) => x.status), ['ok', 'off', 'off', 'ok', 'ok']);
  assert.equal(r[1].index, 80, 'off-route reports the last on-route index');
  assert.ok(r[1].distM > 2000);
  // returning slightly behind after a detour is accepted at once (anchor dropped while off-route)
  assert.equal(r[3].index, 78);
  assert.equal(r[3].held, false);
  assert.equal(r[4].index, 79);
});

test('imprecise fixes are ignored and do not disturb the hysteresis state', () => {
  const a = run([at(90), at(91)]);
  const s = a.at(-1).state;
  const imp = snapFix(samples, at(10, { accuracy: 5000 }), s);
  assert.equal(imp.status, 'imprecise');
  assert.equal(imp.index, 91);
  assert.equal(imp.state, s, 'state object unchanged');
  const next = snapFix(samples, at(93), imp.state);
  assert.equal(next.index, 93);
  // an imprecise first fix gives no position
  assert.equal(snapFix(samples, at(5, { accuracy: 2000 })).index, null);
});

test('monotonic preference: on an out-and-back route the forward leg wins near the overlap', () => {
  // route goes west 0..99 then comes back east on (almost) the same line 100..199
  const loop = Array.from({ length: 200 }, (_, i) => ({ lat: 42 + (i < 100 ? 0 : 0.0006), lon: -72 - (i < 100 ? i : 199 - i) * 0.01 }));
  const fix = (i, extra = 0.0004) => ({ lat: 42 + extra, lon: -72 - i * 0.01, accuracy: 30 }); // nearer the return leg
  let r = snapFix(loop, fix(40, 0), null);
  assert.equal(r.index, 40);
  r = snapFix(loop, fix(42), r.state);
  assert.equal(r.index, 42, 'stays on the outbound leg instead of jumping to sample ~157');
  r = snapFix(loop, fix(45), r.state);
  assert.equal(r.index, 45);
});

test('state carries only indices and counters, never coordinates', () => {
  const r = run([at(5), at(6, { dLat: 0.001 })]).at(-1);
  assert.deepEqual(Object.keys(r.state).sort(), ['back', 'idx', 'off', 'raw', 'rev']);
  assert.ok(Object.values(r.state).every((v) => typeof v === 'number' || typeof v === 'boolean'));
});

test('invalid input is handled', () => {
  assert.equal(snapFix([], at(1)).status, 'none');
  assert.equal(snapFix(samples, { lat: NaN, lon: 1 }).status, 'none');
  assert.equal(snapFix(samples, null).status, 'none');
  // a stale anchor beyond the sample array is ignored
  assert.equal(snapFix(samples, at(3), { idx: 999, raw: 999, back: 0, rev: 0, off: false }).index, 3);
});
