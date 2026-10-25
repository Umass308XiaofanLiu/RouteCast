import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestSample } from '../../src/lib/geo.js';

const samples = [
  { lat: 42.0, lon: -72.0 },
  { lat: 42.0, lon: -72.1 },
  { lat: 42.0, lon: -72.2 },
];

test('nearestSample snaps to the closest sample and reports distance in meters', () => {
  const r = nearestSample(samples, 42.001, -72.099);
  assert.equal(r.index, 1);
  assert.ok(r.distM > 50 && r.distM < 250, `distM ${r.distM}`);
  const far = nearestSample(samples, 39.7392, -104.9903);
  assert.equal(far.index, 2);
  assert.ok(far.distM > 2_000_000);
});

test('nearestSample handles empty or invalid input', () => {
  assert.equal(nearestSample([], 42, -72), null);
  assert.equal(nearestSample(samples, NaN, -72), null);
});
