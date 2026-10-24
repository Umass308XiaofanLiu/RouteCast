import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { zonedWallTimeToUtc, tzOffsetMinutes, toLocalInput, parseLocalInput, formatClock, formatDuration } from '../../src/lib/time.js';
import { angleDiff, signedAngle, bearing, haversine, decodePolyline, resampleRoute, compass } from '../../src/lib/geo.js';
import { sunPosition, geometricGlare, lightPhase, cloudAdjustedSeverity } from '../../src/lib/sun.js';
import { windComponents, hazards } from '../../src/lib/weather.js';

test('time: Eastern/Central wall times convert to the right UTC instant, across DST', () => {
  // 2026-10-25 08:00 EDT = 12:00Z; 2026-11-02 08:00 EST = 13:00Z (DST ends 2026-11-01).
  assert.equal(zonedWallTimeToUtc({ year: 2026, month: 10, day: 25, hour: 8 }, 'America/New_York'), Date.UTC(2026, 9, 25, 12));
  assert.equal(zonedWallTimeToUtc({ year: 2026, month: 11, day: 2, hour: 8 }, 'America/New_York'), Date.UTC(2026, 10, 2, 13));
  assert.equal(zonedWallTimeToUtc({ year: 2026, month: 10, day: 25, hour: 20 }, 'America/Chicago'), Date.UTC(2026, 9, 26, 1));
  assert.equal(tzOffsetMinutes(Date.UTC(2026, 9, 25, 12), 'America/Chicago'), -300);
  // Spring-forward gap (02:30 does not exist) resolves forward; fall-back overlap picks the earlier instant.
  assert.equal(zonedWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York'), Date.UTC(2026, 2, 8, 7, 30));
  assert.equal(zonedWallTimeToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York'), Date.UTC(2026, 10, 1, 5, 30));
});

test('time: datetime-local round trip and labels', () => {
  const t = parseLocalInput('2026-10-25T17:45', 'America/Chicago');
  assert.equal(toLocalInput(t, 'America/Chicago'), '2026-10-25T17:45');
  assert.equal(formatClock(Date.UTC(2026, 9, 26, 1, 24), 'America/Chicago'), 'Sun 8:24 PM CDT');
  assert.equal(parseLocalInput('', 'America/New_York'), null);
  assert.equal(formatDuration(14 * 3600 + 24 * 60), '14 h 24 min');
  assert.equal(formatDuration(51840, { compact: true }), '14h 24m');
});

test('property: wall time -> UTC -> wall time is identity outside DST gaps', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 365 * 3 }), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), fc.constantFrom('America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'), (dayOff, h, m, tz) => {
      const d = new Date(Date.UTC(2026, 0, 1) + dayOff * 864e5);
      const wall = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: h, minute: m };
      const utc = zonedWallTimeToUtc(wall, tz);
      const back = toLocalInput(utc, tz);
      const want = `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      if (back !== want) {
        // Only allowed mismatch: a nonexistent spring-forward time, which moves forward by one hour.
        const moved = `${want.slice(0, 11)}${String(h + 1).padStart(2, '0')}${want.slice(13)}`;
        assert.equal(back, moved);
      }
    }),
    { numRuns: 400 }
  );
});

test('geo: bearings and angle helpers use compass convention', () => {
  assert.ok(Math.abs(bearing(42, -72, 42, -71) - 90) < 0.5); // east
  assert.ok(Math.abs(bearing(42, -72, 42, -73) - 270) < 0.5); // west
  assert.ok(Math.abs(bearing(42, -72, 43, -72) - 0) < 1e-9); // north
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(signedAngle(10, 350), 20);
  assert.equal(signedAngle(350, 10), -20);
  assert.equal(compass(244), 'WSW');
  assert.ok(Math.abs(haversine(42.3732, -72.5199, 40.7128, -74.006) / 1000 - 223) < 3);
});

test('property: angleDiff is symmetric, bounded and invariant to full turns', () => {
  fc.assert(
    fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.double({ min: -1e4, max: 1e4, noNaN: true }), fc.integer({ min: -5, max: 5 }), (a, b, k) => {
      const d = angleDiff(a, b);
      assert.ok(d >= 0 && d <= 180 + 1e-9);
      assert.ok(Math.abs(d - angleDiff(b, a)) < 1e-6);
      assert.ok(Math.abs(d - angleDiff(a + 360 * k, b)) < 1e-6);
      assert.ok(Math.abs(Math.abs(signedAngle(a, b)) - d) < 1e-6);
    })
  );
});

test('geo: polyline6 decoding matches the reference example', () => {
  // Google's documented example "_p~iF~ps|U_ulLnnqC_mqNvxq`@" at precision 5.
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test('geo: resampling interpolates routed time, not straight-line time', () => {
  const route = {
    coords: [[42, -72], [42, -71.9], [42, -71.8]],
    cumDist: [0, 8280, 16560],
    cumTime: [0, 600, 900], // slow first half, fast second half
  };
  const s = resampleRoute(route, 4140, 200);
  assert.equal(s.length, 5);
  assert.ok(Math.abs(s[1].driveSec - 300) < 1);
  assert.ok(Math.abs(s[3].driveSec - 750) < 1);
  assert.ok(s.every((x) => Math.abs(x.heading - 90) < 1));
});

test('sun: SunCalc azimuth is converted to compass degrees', () => {
  // Amherst, MA at local solar noon is due south; at 07:30 EDT on Oct 25 the sun is ESE and just risen.
  const noon = sunPosition(Date.UTC(2026, 9, 25, 16, 45), 42.37, -72.52);
  assert.ok(Math.abs(noon.azimuth - 180) < 6, `noon az ${noon.azimuth}`);
  const morning = sunPosition(Date.UTC(2026, 9, 25, 11, 30), 42.37, -72.52);
  assert.ok(morning.azimuth > 100 && morning.azimuth < 120, `morning az ${morning.azimuth}`);
  assert.ok(morning.altitude > -1 && morning.altitude < 8, `morning alt ${morning.altitude}`);
  const evening = sunPosition(Date.UTC(2026, 9, 25, 21, 45), 41.4, -82.2); // near Lorain, OH, 5:45 PM EDT
  assert.ok(evening.azimuth > 235 && evening.azimuth < 260, `evening az ${evening.azimuth}`);
});

test('glare: ahead + low = glare; behind, high, or below horizon = no windshield glare', () => {
  assert.equal(geometricGlare(3, 250, 250).severity, 3);
  assert.equal(geometricGlare(12, 250, 262).severity, 2);
  assert.equal(geometricGlare(20, 250, 275).severity, 1);
  assert.equal(geometricGlare(40, 250, 250).severity, 0); // above visor line
  assert.equal(geometricGlare(5, 250, 200).severity, 0); // 50° off heading
  assert.equal(geometricGlare(-3, 250, 250).severity, 0); // below horizon
  const rear = geometricGlare(5, 250, 70);
  assert.equal(rear.severity, 0);
  assert.equal(rear.rear, true);
  assert.equal(lightPhase(30), 'day');
  assert.equal(lightPhase(3), 'low-sun');
  assert.equal(lightPhase(-3), 'twilight');
  assert.equal(lightPhase(-12), 'night');
});

test('property: glare severity never increases as the sun moves away from the heading or climbs', () => {
  fc.assert(
    fc.property(fc.double({ min: -0.8, max: 24, noNaN: true }), fc.double({ min: 0, max: 29, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 5, noNaN: true }), (alt, off, heading, delta) => {
      const base = geometricGlare(alt, heading + off, heading).score;
      assert.ok(geometricGlare(alt, heading + Math.min(off + delta, 179), heading).score <= base + 1e-9);
      assert.ok(geometricGlare(alt + delta, heading + off, heading).score <= base + 1e-9);
      assert.ok(base > 0);
    })
  );
});

test('glare: clouds reduce expected severity but never invent glare', () => {
  assert.equal(cloudAdjustedSeverity(3, { cloudCover: 95, precipitation: 0 }).severity, 1);
  assert.equal(cloudAdjustedSeverity(3, { cloudCover: 70, precipitation: 0 }).severity, 2);
  assert.equal(cloudAdjustedSeverity(2, { cloudCover: 10, precipitation: 0 }).severity, 2);
  assert.equal(cloudAdjustedSeverity(0, { cloudCover: 0 }).severity, 0);
  assert.equal(cloudAdjustedSeverity(2, null).severity, 2);
});

test('wind: meteorological FROM direction vs heading gives head/cross components', () => {
  const head = windComponents(40, 90, 90); // driving east, wind from the east
  assert.ok(Math.abs(head.headwind - 40) < 1e-9 && head.crosswind < 1e-9);
  const tail = windComponents(40, 270, 90);
  assert.ok(Math.abs(tail.headwind + 40) < 1e-9);
  const cross = windComponents(40, 180, 90); // from the south while driving east = from the right
  assert.ok(Math.abs(cross.crosswind - 40) < 1e-9);
  assert.equal(cross.side, 'right');
  assert.equal(windComponents(null, 180, 90).crosswind, null);
});

test('property: crosswind is bounded by wind speed', () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 0, max: 360, noNaN: true }), (v, from, heading) => {
      const w = windComponents(v, from, heading);
      assert.ok(w.crosswind <= v + 1e-9 && w.crosswind >= 0);
      assert.ok(Math.abs(w.crosswind ** 2 + w.headwind ** 2 - v * v) < 1e-6 * Math.max(1, v * v));
    })
  );
});

test('hazards: snow, ice, heavy rain, fog and vehicle-specific crosswind limits', () => {
  assert.deepEqual(hazards({ snowfall: 1.5, precipitation: 1.2, temperature: -2, weatherCode: 75 }, 90).flags.slice(0, 1), ['heavy-snow']);
  assert.ok(hazards({ precipitation: 0.5, temperature: 0, weatherCode: 66 }, 90).ice);
  assert.ok(hazards({ precipitation: 6, temperature: 12, weatherCode: 65 }, 90).heavyRain);
  assert.ok(hazards({ precipitation: 0, temperature: 8, weatherCode: 45, visibility: 300 }, 90).lowVis);
  const wx = { windSpeed: 30, windGusts: 55, windDirection: 180, precipitation: 0, temperature: 10, weatherCode: 3 }; // 55 km/h = 34 mph crosswind
  assert.equal(hazards(wx, 90, 'car').windy, false);
  assert.equal(hazards(wx, 90, 'high-profile').windy, true);
  assert.deepEqual(hazards(null, 90).flags, []);
});
