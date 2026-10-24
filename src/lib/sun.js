// sun.js — sun position relative to the driving direction.
// SunCalc returns azimuth in radians measured from SOUTH, positive toward WEST,
// and geometric altitude (no refraction). We convert azimuth to compass degrees.
import SunCalc from 'suncalc';
import { angleDiff } from './geo.js';

const DEG = 180 / Math.PI;

/** Apparent horizon: the sun's upper limb is visible above ~ -0.833° geometric altitude. */
export const SUN_VISIBLE_ALT = -0.833;
export const GLARE_MAX_ALT = 25; // visor/roof line typically blocks a sun higher than this
export const GLARE_HALF_ANGLE = 30; // forward field of view where the sun is in the driver's eyes
export const REAR_MIN_OFFSET = 150; // sun "behind you" cone
export const REAR_MAX_ALT = 15;

export const SEVERITY_LABELS = ['None', 'Mild', 'Strong', 'Severe'];

export function sunPosition(utcMs, lat, lon) {
  const p = SunCalc.getPosition(new Date(utcMs), lat, lon);
  return {
    altitude: p.altitude * DEG,
    azimuth: (p.azimuth * DEG + 180 + 360) % 360, // compass, 0 = N
  };
}

/** Daylight phase from sun altitude. */
export function lightPhase(altitude) {
  if (altitude > 6) return 'day';
  if (altitude > SUN_VISIBLE_ALT) return 'low-sun';
  if (altitude > -6) return 'twilight';
  return 'night';
}

/**
 * Geometric glare risk for a driver at heading `heading`.
 * score in [0,1]: product of how low the sun is and how centered it is.
 */
export function geometricGlare(altitude, azimuth, heading) {
  const offset = angleDiff(azimuth, heading);
  const visible = altitude > SUN_VISIBLE_ALT;
  let score = 0;
  if (visible && altitude <= GLARE_MAX_ALT && offset <= GLARE_HALF_ANGLE) {
    const lowness = 1 - Math.max(0, altitude) / GLARE_MAX_ALT; // 1 at horizon
    const centering = 1 - offset / GLARE_HALF_ANGLE; // 1 straight ahead
    score = Math.max(0.01, lowness * centering);
  }
  const severity = score >= 0.55 ? 3 : score >= 0.3 ? 2 : score > 0 ? 1 : 0;
  const rear = visible && altitude <= REAR_MAX_ALT && offset >= REAR_MIN_OFFSET;
  return { offset, score, severity, rear };
}

/**
 * Expected glare after accounting for forecast cloud cover / precipitation / fog.
 * Returns the reduced severity and a reason. The geometric severity is preserved separately.
 */
export function cloudAdjustedSeverity(severity, wx) {
  if (severity === 0 || !wx) return { severity, muted: false, reason: null };
  const cloud = wx.cloudCover;
  const wet = (wx.precipitation ?? 0) >= 0.2;
  const fog = wx.visibility != null && wx.visibility < 2000;
  if (cloud == null) return { severity, muted: false, reason: 'cloud cover unknown' };
  if (cloud >= 85 || wet || fog) {
    return { severity: Math.max(0, severity - 2), muted: true, reason: `overcast (${Math.round(cloud)}% cloud)` };
  }
  if (cloud >= 60) {
    return { severity: Math.max(0, severity - 1), muted: true, reason: `mostly cloudy (${Math.round(cloud)}% cloud)` };
  }
  return { severity, muted: false, reason: `${Math.round(cloud)}% cloud cover` };
}
