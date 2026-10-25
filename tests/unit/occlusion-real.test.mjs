// Terrain occlusion on REAL recorded AWS terrarium z12 tiles (tests/fixtures/dem/, no network).
// Fixtures recorded 2026-10-24 with `node scripts/horizon-probe.mjs --record ...`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terrainHorizon, sunBlocked, pixelLookup } from '../../src/lib/horizon.js';
import { createDemSampler } from '../../src/lib/demsampler.js';
import { DEFAULT_HORIZON_OPTS } from '../../src/lib/terraincheck.js';
import { decodePng, fixtureFetchTile, FIXTURE_DIR, fixtureName } from '../../scripts/horizon-probe.mjs';

const fixtureSampler = (used) => createDemSampler({ zoom: 12, fetchTile: fixtureFetchTile(FIXTURE_DIR, used) });
const ray = (s, lat, lon, azimuthDeg, maxDistM) =>
  terrainHorizon({ lat, lon, azimuthDeg, sampleElevation: s, maxDistM, minDistM: DEFAULT_HORIZON_OPTS.minDistM });

// (a1) I-90 between Lee and West Stockbridge MA (approx. alignment), westbound, ridge ~2.8 km west.
const BERKSHIRE = { lat: 42.33, lon: -73.32, az: 258, maxDistM: 8000 };
// (a2) I-90 near the Westfield MA interchange (approx.), Berkshire escarpment ~6 km west.
const WESTFIELD = { lat: 42.165, lon: -72.76, az: 258, maxDistM: 10000 };
// (b) I-80/I-90 Ohio Turnpike near Fremont/Toledo (Great Black Swamp plain), westbound.
const OHIO = { lat: 41.456, lon: -83.46, az: 265, maxDistM: 10000 };
// (c) Springfield MA, I-91 along the Connecticut River, looking WSW across the valley.
const SPRINGFIELD = { lat: 42.101, lon: -72.59, az: 258, maxDistM: 8000 };

test('fixtures are small, valid 256 px terrarium PNGs', () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.png'));
  assert.ok(files.length >= 8 && files.length <= 16, `${files.length} tiles`);
  const total = files.reduce((n, f) => n + fs.statSync(FIXTURE_DIR + f).size, 0);
  assert.ok(total <= 2 * 1024 * 1024, `${total} bytes`);
  for (const f of files) {
    const t = decodePng(fs.readFileSync(FIXTURE_DIR + f));
    assert.equal(t.width, 256);
    assert.equal(t.height, 256);
    assert.equal(t.data.length, 256 * 256 * 4);
  }
});

test('summit cross-check: Mount Greylock decodes to its published 1,064 m (3,491 ft)', async () => {
  const s = fixtureSampler();
  // max over a ±6 px window around the summit coordinate (pixel quantisation, ~22 m/px here)
  const p = pixelLookup(42.6375, -73.1658, 12);
  const t = decodePng(fs.readFileSync(FIXTURE_DIR + fixtureName(12, p.x, p.y)));
  let best = -Infinity;
  for (let y = p.py - 6; y <= p.py + 6; y++)
    for (let x = p.px - 6; x <= p.px + 6; x++) {
      const o = (y * 256 + x) * 4;
      best = Math.max(best, t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768);
    }
  assert.ok(Math.abs(best - 1064) <= 3, `summit ${best}`);
  const at = await s(42.6375, -73.1658);
  assert.ok(at > 1040 && at <= 1066, `sample ${at}`);
});

test('(a1) Berkshire ridge west of I-90: horizon ≈ 5.3° at ≈ 2.8 km blocks a 3° western sun', async () => {
  const used = new Set();
  const s = fixtureSampler(used);
  const h = await ray(s, BERKSHIRE.lat, BERKSHIRE.lon, BERKSHIRE.az, BERKSHIRE.maxDistM);
  assert.equal(h.status, 'ok');
  assert.equal(h.coverage, 1);
  assert.ok(h.horizonAltDeg > 4.5 && h.horizonAltDeg < 6.5, `${h.horizonAltDeg}`);
  assert.ok(h.atDistM > 2000 && h.atDistM < 3500, `${h.atDistM}`);
  const obs = await s(BERKSHIRE.lat, BERKSHIRE.lon);
  assert.ok(obs > 250 && obs < 320, `observer ${obs}`);
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: h }), 'blocked');
  assert.equal(sunBlocked({ sunAltDeg: 8, horizon: h }), 'visible');
  assert.equal(used.size, 2);
});

test('(a2) Westfield: Berkshire escarpment gives ≈ 1.9° horizon; blocks 1° sun, not 3°', async () => {
  const s = fixtureSampler();
  const h = await ray(s, WESTFIELD.lat, WESTFIELD.lon, WESTFIELD.az, WESTFIELD.maxDistM);
  assert.equal(h.status, 'ok');
  assert.ok(h.horizonAltDeg > 1.4 && h.horizonAltDeg < 2.4, `${h.horizonAltDeg}`);
  assert.ok(h.atDistM > 4000 && h.atDistM < 8000, `${h.atDistM}`);
  assert.equal(sunBlocked({ sunAltDeg: 1, horizon: h }), 'blocked');
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: h }), 'visible');
});

test('(b) flat NW Ohio: near-0° horizon, a 1° sun is visible', async () => {
  const s = fixtureSampler();
  const h = await ray(s, OHIO.lat, OHIO.lon, OHIO.az, OHIO.maxDistM);
  assert.equal(h.status, 'ok');
  assert.ok(Math.abs(h.horizonAltDeg) < 0.3, `${h.horizonAltDeg}`);
  assert.equal(sunBlocked({ sunAltDeg: 1, horizon: h }), 'visible');
  assert.equal(sunBlocked({ sunAltDeg: 0.2, horizon: h }), 'unknown'); // within ±0.5° margin
});

test('(c) Springfield valley: low horizon (< 1.5°), 2° sun visible', async () => {
  const s = fixtureSampler();
  const h = await ray(s, SPRINGFIELD.lat, SPRINGFIELD.lon, SPRINGFIELD.az, SPRINGFIELD.maxDistM);
  assert.equal(h.status, 'ok');
  assert.ok(h.horizonAltDeg > -0.5 && h.horizonAltDeg < 1.5, `${h.horizonAltDeg}`);
  assert.equal(sunBlocked({ sunAltDeg: 2, horizon: h }), 'visible');
});

test('missing tiles → unknown, never blocked', async () => {
  const s = fixtureSampler();
  // Same Berkshire ray but 30 km: leaves the 2 recorded tiles → coverage < 0.9 → unknown.
  const far = await ray(s, BERKSHIRE.lat, BERKSHIRE.lon, BERKSHIRE.az, 30000);
  assert.ok(far.coverage < 0.9, `${far.coverage}`);
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: far }), 'unknown');
  // Observer in an unrecorded tile (Denver) → no-observer-elevation → unknown.
  const none = await ray(s, 39.74, -104.99, 260, 5000);
  assert.equal(none.status, 'no-observer-elevation');
  assert.equal(sunBlocked({ sunAltDeg: -5, horizon: none }), 'unknown');
});

// ---- sampler robustness (synthetic fetchTile, still no network) ----
const flat = () => {
  const t = new Uint8ClampedArray(256 * 256 * 4);
  for (let o = 0; o < t.length; o += 4) t.set([128, 100, 0, 255], o); // 100 m
  return t;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('sampler: ≤ 6 concurrent tile fetches even when asked for more', async () => {
  let active = 0, peak = 0;
  const s = createDemSampler({ maxConcurrent: 50, fetchTile: async () => { active++; peak = Math.max(peak, active); await sleep(5); active--; return flat(); } });
  const pts = Array.from({ length: 20 }, (_, i) => [40, -100 + i * 0.2]); // 20 distinct tiles
  const v = await Promise.all(pts.map(([a, b]) => s(a, b)));
  assert.ok(v.every((x) => x === 100));
  assert.ok(peak <= 6 && peak >= 2, `peak ${peak}`);
  assert.ok(s.stats.maxInFlight <= 6);
});

test('sampler: one retry on network error, none on HTTP error', async () => {
  let n = 0;
  const s = createDemSampler({ fetchTile: async () => { if (n++ === 0) throw new TypeError('network'); return flat(); } });
  assert.equal(await s(40, -100), 100);
  assert.equal(n, 2);
  assert.equal(s.stats.retried, 1);
  let m = 0;
  const http = createDemSampler({ fetchTile: async () => { m++; const e = new Error('tile HTTP 404'); e.noRetry = true; throw e; } });
  assert.equal(await http(40, -100), null);
  assert.equal(m, 1);
  let k = 0;
  const dead = createDemSampler({ fetchTile: async () => { k++; throw new TypeError('network'); } });
  assert.equal(await dead(40, -100), null);
  assert.equal(k, 2); // original + exactly one retry
});

test('sampler: per-attempt timeout → null (after one retry), never throws', async () => {
  let n = 0;
  const s = createDemSampler({ timeoutMs: 20, fetchTile: () => { n++; return new Promise(() => {}); } });
  const t0 = Date.now();
  assert.equal(await s(40, -100), null);
  assert.equal(n, 2);
  assert.ok(Date.now() - t0 < 1000);
});

test('sampler: AbortSignal → null at once, aborts the fetch, does not cache the tile as missing', async () => {
  let sawAbort = false, calls = 0;
  const s = createDemSampler({
    fetchTile: (z, x, y, { signal }) => { calls++; return new Promise((res, rej) => {
      if (calls > 1) return res(flat());
      signal.addEventListener('abort', () => { sawAbort = true; rej(new Error('aborted')); });
    }); },
  });
  const ctrl = new AbortController();
  const p = s(40, -100, { signal: ctrl.signal });
  await sleep(5);
  ctrl.abort();
  assert.equal(await p, null);
  await sleep(5);
  assert.ok(sawAbort);
  assert.equal(await s(40, -100), 100); // refetched, not remembered as missing
  assert.equal(calls, 2);
  assert.equal(await s(40, -100, { signal: AbortSignal.abort() }), null); // pre-aborted
});

test('sampler: shared tile keeps loading while another waiter is still interested', async () => {
  let release;
  const s = createDemSampler({ fetchTile: () => new Promise((r) => { release = () => r(flat()); }) });
  const ctrl = new AbortController();
  const a = s(40, -100, { signal: ctrl.signal });
  const b = s(40, -100);
  await sleep(1);
  ctrl.abort();
  release();
  assert.equal(await a, null);
  assert.equal(await b, 100);
});

test('sampler: LRU never exceeds maxTiles', async () => {
  const s = createDemSampler({ maxTiles: 3, fetchTile: async () => flat() });
  for (let i = 0; i < 10; i++) await s(40, -100 + i * 0.2);
  assert.equal(s.cacheSize(), 3);
});
