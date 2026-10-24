import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  decodeTerrarium,
  tileXY,
  pixelLookup,
  destinationPoint,
  terrainHorizon,
  sunBlocked,
  metersPerPixel,
} from '../../src/lib/horizon.js';

const LAT = 42.39;
const LON = -72.53;
const R = 6371008.8;
const D2R = Math.PI / 180;

// Ground distance (m) and signed along-azimuth projection relative to the observer.
function alongM(lat, lon, azDeg) {
  const x = (lon - LON) * D2R * R * Math.cos(LAT * D2R);
  const y = (lat - LAT) * D2R * R;
  return x * Math.sin(azDeg * D2R) + y * Math.cos(azDeg * D2R);
}

// 300 m ridge (band 2.9–3.1 km) to the west (az 270) of a 100 m plain.
const ridgeWest = (lat, lon) => {
  const a = alongM(lat, lon, 270);
  return a > 2900 && a < 3100 ? 400 : 100;
};

test('decodeTerrarium known values', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(0, 0, 0), -32768);
  assert.equal(decodeTerrarium(128, 100, 128), 100.5);
  assert.equal(decodeTerrarium(131, 232, 0), 1000);
});

test('tileXY / pixelLookup / metersPerPixel', () => {
  assert.deepEqual(tileXY(0, 0, 1), { x: 1, y: 1, z: 1 });
  const t = tileXY(LAT, LON, 12);
  assert.ok(t.x >= 0 && t.x < 4096 && t.y >= 0 && t.y < 4096);
  const p = pixelLookup(LAT, LON, 12);
  assert.ok(p.px >= 0 && p.px < 256 && p.py >= 0 && p.py < 256);
  // z12: ≈38.2 m/px at the equator, ≈29.3 m/px at 40°N (cos-lat scaling).
  assert.ok(Math.abs(metersPerPixel(0, 12) - 38.2) < 0.2);
  assert.ok(Math.abs(metersPerPixel(40, 12) - 29.3) < 0.2);
});

test('destinationPoint moves the right way', () => {
  const p = destinationPoint(LAT, LON, 270, 3000);
  assert.ok(Math.abs(alongM(p.lat, p.lon, 270) - 3000) < 5);
});

test('flat terrain → slightly negative horizon → 2° sun visible', async () => {
  const h = await terrainHorizon({ lat: LAT, lon: LON, azimuthDeg: 270, sampleElevation: () => 100 });
  assert.equal(h.status, 'ok');
  assert.equal(h.coverage, 1);
  assert.ok(h.horizonAltDeg < 0 && h.horizonAltDeg > -0.5, `got ${h.horizonAltDeg}`);
  assert.equal(sunBlocked({ sunAltDeg: 2, horizon: h }), 'visible');
});

test('300 m ridge 3 km away → ≈5.6° → blocks 3° sun, not 8°', async () => {
  const h = await terrainHorizon({ lat: LAT, lon: LON, azimuthDeg: 270, sampleElevation: ridgeWest, stepM: 100 });
  assert.ok(Math.abs(h.horizonAltDeg - 5.67) < 0.3, `got ${h.horizonAltDeg}`);
  assert.ok(Math.abs(h.atDistM - 3000) <= 100);
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: h }), 'blocked');
  assert.equal(sunBlocked({ sunAltDeg: 8, horizon: h }), 'visible');
});

test('async sampler is supported', async () => {
  const h = await terrainHorizon({
    lat: LAT, lon: LON, azimuthDeg: 270, stepM: 100,
    sampleElevation: async (a, b) => ridgeWest(a, b),
  });
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: h }), 'blocked');
});

test('ridge behind the observer does not block', async () => {
  const h = await terrainHorizon({ lat: LAT, lon: LON, azimuthDeg: 90, sampleElevation: ridgeWest, stepM: 100 });
  assert.ok(h.horizonAltDeg < 0);
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: h }), 'visible');
});

test('missing data → unknown, never blocked', async () => {
  const noObs = await terrainHorizon({
    lat: LAT, lon: LON, azimuthDeg: 270, stepM: 100,
    sampleElevation: (a, b) => (a === LAT && b === LON ? null : 5000),
  });
  assert.equal(noObs.status, 'no-observer-elevation');
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: noObs }), 'unknown');

  // Ridge present but half the tiles are missing → coverage < 0.9 → unknown.
  let i = 0;
  const holes = await terrainHorizon({
    lat: LAT, lon: LON, azimuthDeg: 270, stepM: 100,
    sampleElevation: (a, b) => (i++ === 0 ? 100 : i % 2 ? null : ridgeWest(a, b)),
  });
  assert.ok(holes.coverage < 0.9);
  assert.equal(sunBlocked({ sunAltDeg: -10, horizon: holes }), 'unknown');

  const none = await terrainHorizon({
    lat: LAT, lon: LON, azimuthDeg: 270, stepM: 100,
    sampleElevation: (a, b) => (a === LAT && b === LON ? 100 : null),
  });
  assert.equal(none.status, 'no-data');
  assert.equal(sunBlocked({ sunAltDeg: -10, horizon: none }), 'unknown');
  assert.equal(sunBlocked({ sunAltDeg: 3, horizon: null }), 'unknown');
  assert.equal(sunBlocked({ sunAltDeg: NaN, horizon: { status: 'ok', horizonAltDeg: 1, coverage: 1 } }), 'unknown');
});

test('within margin → unknown', () => {
  const h = { status: 'ok', horizonAltDeg: 2, coverage: 1 };
  assert.equal(sunBlocked({ sunAltDeg: 2.3, horizon: h }), 'unknown');
});

test('property: raising any sample never lowers the horizon', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 2000 }), { minLength: 20, maxLength: 20 }),
      fc.nat({ max: 19 }),
      fc.integer({ min: 1, max: 3000 }),
      async (profile, idx, bump) => {
        const run = async (prof) => {
          let k = 0;
          return terrainHorizon({
            lat: LAT, lon: LON, azimuthDeg: 200, stepM: 500, maxDistM: 10000,
            sampleElevation: () => (k++ === 0 ? 100 : prof[(k - 2) % prof.length]),
          });
        };
        const base = await run(profile);
        const raised = profile.slice();
        raised[idx] += bump;
        const after = await run(raised);
        return after.horizonAltDeg >= base.horizonAltDeg - 1e-12;
      },
    ),
    { numRuns: 200 },
  );
});
