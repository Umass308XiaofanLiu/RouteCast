// glare.js — sun-glare computation, the core differentiator.
// Uses SunCalc for sun azimuth/altitude. All angles in degrees unless noted.
import SunCalc from 'suncalc';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Bearing (compass heading) from point A to point B, degrees 0..360 (0 = North, 90 = East).
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * RAD;
  const φ2 = lat2 * RAD;
  const Δλ = (lon2 - lon1) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

// Smallest absolute difference between two compass angles, 0..180.
export function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// SunCalc azimuth is measured from South, clockwise (radians). Convert to
// compass bearing (0 = North, clockwise) so we can compare to driving heading.
function sunCompassAzimuth(suncalcAzimuthRad) {
  return (suncalcAzimuthRad * DEG + 180 + 360) % 360;
}

/**
 * Evaluate sun-glare risk for a driver at a location/time heading a direction.
 * Returns severity 0..3 and a human-readable reason.
 */
export function glareForSegment(lat, lon, date, headingDeg) {
  const pos = SunCalc.getPosition(date, lat, lon);
  const altitudeDeg = pos.altitude * DEG; // negative = below horizon
  const sunAz = sunCompassAzimuth(pos.azimuth);
  const offset = angleDiff(sunAz, headingDeg); // 0 = sun directly ahead

  // Below horizon: no glare.
  if (altitudeDeg <= -0.5) {
    return {
      severity: 0,
      altitudeDeg,
      sunAzimuth: sunAz,
      headingOffset: offset,
      label: 'No glare',
      reason: 'Sun is below the horizon.',
    };
  }

  // Glare requires the sun ahead of the driver (within a forward cone) and low in the sky.
  const ahead = offset <= 45; // forward cone half-angle
  const low = altitudeDeg <= 25; // low sun = windshield-level glare
  const veryLow = altitudeDeg <= 10;

  let severity = 0;
  if (ahead && low) {
    if (veryLow && offset <= 20) severity = 3;
    else if (veryLow || offset <= 20) severity = 2;
    else severity = 1;
  } else if (ahead && altitudeDeg <= 35) {
    severity = 1; // mild: sun ahead but higher
  }

  const labels = ['No glare', 'Mild glare', 'Strong glare', 'Severe glare'];
  let reason;
  if (severity === 0) {
    reason =
      offset > 45
        ? 'Sun is not in the direction of travel.'
        : 'Sun is high enough to clear the windshield glare zone.';
  } else {
    reason =
      `Sun is ${altitudeDeg.toFixed(0)}° above the horizon and ` +
      `${offset.toFixed(0)}° off your heading (sun ahead).`;
  }

  return {
    severity,
    altitudeDeg,
    sunAzimuth: sunAz,
    headingOffset: offset,
    label: labels[severity],
    reason,
  };
}

// Classify sunrise/sunset glare context for messaging.
export function glarePhase(headingDeg, altitudeDeg) {
  const eastbound = angleDiff(headingDeg, 90) <= 45;
  const westbound = angleDiff(headingDeg, 270) <= 45;
  if (altitudeDeg > 0 && altitudeDeg <= 12) {
    if (eastbound) return 'eastbound-sunrise';
    if (westbound) return 'westbound-sunset';
  }
  return 'none';
}
