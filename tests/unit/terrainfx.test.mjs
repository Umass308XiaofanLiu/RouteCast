// Pure helpers of the terrain-view weather/light/wind overlay (src/ui/terrainfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  signedAngle, nightFactor, horizonY, sunScreen, particleCount, fogAlpha, windRelative,
  glowStrength, skySpec, fxParams, MAX_PARTICLES, DEFAULT_FOV,
} from '../../src/ui/terrainfx.js';

const CAM = { bearing: 270, pitch: 72, fov: DEFAULT_FOV, width: 1000, height: 800 };

test('signedAngle stays in (−180, 180] and is antisymmetric', () => {
  assert.equal(signedAngle(10, 350), 20);
  assert.equal(signedAngle(350, 10), -20);
  fc.assert(fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -1e4, max: 1e4, noNaN: true }), (a, b) => {
    const d = signedAngle(a, b);
    return d > -180 - 1e-9 && d <= 180 + 1e-9;
  }));
});

test('nightFactor: day 0, night 1, monotone through twilight', () => {
  assert.equal(nightFactor(20), 0);
  assert.equal(nightFactor(-10), 1);
  assert.ok(nightFactor(-3) > 0 && nightFactor(-3) < 1);
  assert.ok(nightFactor(-5) > nightFactor(-2));
  assert.equal(nightFactor(undefined), 0);
});

test('horizonY: top-down view puts the horizon far above; level camera at the middle', () => {
  assert.ok(horizonY({ pitch: 0, height: 800 }) < -1000);
  assert.equal(horizonY({ pitch: 90, height: 800 }), 400);
  // higher pitch → horizon lower on screen
  assert.ok(horizonY({ pitch: 80, height: 800 }) > horizonY({ pitch: 70, height: 800 }));
});

test('sunScreen: a sun on the horizon straight ahead lies on the horizon line, centred', () => {
  const s = sunScreen({ ...CAM, azimuth: 270, altitude: 0 });
  assert.ok(s);
  assert.ok(Math.abs(s.x - 500) < 1e-6);
  assert.ok(Math.abs(s.y - horizonY(CAM)) < 1e-6);
});

test('sunScreen: below horizon or behind the camera → null; right of heading → right of centre', () => {
  assert.equal(sunScreen({ ...CAM, azimuth: 270, altitude: -2 }), null);
  assert.equal(sunScreen({ ...CAM, azimuth: 90, altitude: 5 }), null); // behind
  const r = sunScreen({ ...CAM, azimuth: 290, altitude: 3 });
  assert.ok(r.x > 500);
  const l = sunScreen({ ...CAM, azimuth: 250, altitude: 3 });
  assert.ok(l.x < 500);
  // higher sun → higher on screen
  assert.ok(sunScreen({ ...CAM, azimuth: 270, altitude: 8 }).y < sunScreen({ ...CAM, azimuth: 270, altitude: 2 }).y);
});

test('sunScreen: a low sun ahead is on-screen with a near-level camera, above the top at high pitch-down', () => {
  assert.equal(sunScreen({ ...CAM, pitch: 85, azimuth: 270, altitude: 3 }).onScreen, true);
  const hi = sunScreen({ ...CAM, pitch: 58, azimuth: 270, altitude: 5 });
  assert.ok(hi && hi.y < 0 && !hi.onScreen);
});

test('sunScreen is symmetric in the relative azimuth (property)', () => {
  fc.assert(fc.property(fc.double({ min: 0.5, max: 60, noNaN: true }), fc.double({ min: 0, max: 40, noNaN: true }), fc.double({ min: 50, max: 85, noNaN: true }), (rel, alt, pitch) => {
    const a = sunScreen({ ...CAM, pitch, azimuth: CAM.bearing + rel, altitude: alt });
    const b = sunScreen({ ...CAM, pitch, azimuth: CAM.bearing - rel, altitude: alt });
    if (!a || !b) return a === b;
    return Math.abs(a.x - 500 + (b.x - 500)) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  }));
});

test('particleCount: none below 0.1 mm/h, grows with precipitation, capped', () => {
  assert.equal(particleCount(0), 0);
  assert.equal(particleCount(0.05), 0);
  assert.equal(particleCount(NaN), 0);
  assert.ok(particleCount(1) < particleCount(3));
  assert.ok(particleCount(2, true) > particleCount(2, false));
  fc.assert(fc.property(fc.double({ min: 0, max: 1e4, noNaN: true }), fc.boolean(), (p, s) => {
    const n = particleCount(p, s);
    return n >= 0 && n <= MAX_PARTICLES && Number.isInteger(n);
  }));
});

test('fogAlpha: clear above 8 km, denser in lower visibility, at most 0.8', () => {
  assert.equal(fogAlpha(10000), 0);
  assert.equal(fogAlpha(undefined), 0);
  assert.ok(fogAlpha(300) > fogAlpha(4000));
  assert.ok(fogAlpha(0) <= 0.8);
  fc.assert(fc.property(fc.double({ min: -100, max: 1e5, noNaN: true }), (v) => fogAlpha(v) >= 0 && fogAlpha(v) <= 0.8));
});

test('windRelative: wind from the left of the camera blows to the right (positive slant)', () => {
  // camera bearing north; wind FROM west (270) blows toward east = right
  const w = windRelative({ windDirection: 270, windGusts: 60 }, 0);
  assert.equal(w.rel, 90);
  assert.ok(Math.abs(w.slant - 1) < 1e-9);
  // same wind with camera heading east: tail wind → no slant
  assert.ok(Math.abs(windRelative({ windDirection: 270, windGusts: 60 }, 90).slant) < 1e-9);
  assert.equal(windRelative(null, 0).rel, null);
  assert.ok(Math.abs(windRelative({ windDirection: 270, windSpeed: 30 }, 0).slant - 0.5) < 1e-9);
});

test('glowStrength: stronger for expected glare ≥ 2, dimmed by cloud', () => {
  assert.ok(glowStrength(2, 0).alpha > glowStrength(1, 0).alpha);
  assert.ok(glowStrength(2, 90).alpha < glowStrength(2, 0).alpha);
  assert.equal(glowStrength(1, 0).wash, 0);
  assert.ok(glowStrength(3, 0).wash > glowStrength(2, 0).wash);
});

test('skySpec: valid MapLibre sky colours; night darker; fog pulls ground blend in', () => {
  const day = skySpec({ sun: { altitude: 40 }, wx: { cloudCover: 0, visibility: 20000 } });
  const night = skySpec({ sun: { altitude: -20 }, wx: { cloudCover: 0, visibility: 20000 } });
  const foggy = skySpec({ sun: { altitude: 40 }, wx: { cloudCover: 0, visibility: 200 } });
  for (const s of [day, night, foggy]) {
    for (const k of ['sky-color', 'horizon-color', 'fog-color']) assert.match(s[k], /^#[0-9a-f]{6}$/);
    for (const k of ['fog-ground-blend', 'horizon-fog-blend', 'sky-horizon-blend', 'atmosphere-blend']) assert.ok(s[k] >= 0 && s[k] <= 1, k);
  }
  const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lum(night['sky-color']) < lum(day['sky-color']));
  assert.ok(foggy['fog-ground-blend'] < day['fog-ground-blend']);
});

test('fxParams combines the row and camera', () => {
  const p = fxParams({ sun: { altitude: -10, azimuth: 0 }, wx: { precipitation: 2, visibility: 500, windDirection: 270, windGusts: 70 }, hz: { snow: true }, expected: 0 }, { ...CAM, bearing: 0 });
  assert.equal(p.night, 1);
  assert.equal(p.snowing, true);
  assert.ok(p.particles > 0 && p.fog > 0 && p.streaks > 0);
  assert.equal(p.sun, null);
  const q = fxParams({ sun: { altitude: 20 }, wx: null, hz: {} }, CAM);
  assert.equal(q.particles, 0);
  assert.equal(q.hasWx, false);
});
