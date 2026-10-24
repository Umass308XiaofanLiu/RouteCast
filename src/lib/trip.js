// trip.js — evaluate a routed trip for a departure time.
import { sunPosition, lightPhase, geometricGlare, cloudAdjustedSeverity } from './sun.js';
import { lookupForecast } from './forecast.js';
import { hazards } from './weather.js';
import { nearestPlace } from './geo.js';

export const BREAK_PLANS = {
  none: { label: 'No breaks', everySec: 0, durationSec: 0 },
  short: { label: '15 min every 2 h', everySec: 7200, durationSec: 900 },
  long: { label: '30 min every 3 h', everySec: 10800, durationSec: 1800 },
};

// Delay scenarios. GlarePilot has no live or predictive traffic source (the free routing
// servers return free-flow times), so delays are explicit USER ASSUMPTIONS. A delay is extra
// in-car time spread linearly over a stretch of the route: points before the stretch are
// unaffected, points inside it are partially delayed, every point after it is delayed in full.
export const DELAY_WHERE = {
  spread: { label: 'spread over the whole trip', from: 0, to: 1 },
  start: { label: 'in the first quarter', from: 0, to: 0.25 },
  middle: { label: 'mid-route', from: 0.375, to: 0.625 },
  end: { label: 'in the last quarter', from: 0.75, to: 1 },
};

export function makeDelay(delay, totalDistM) {
  const minutes = Math.max(0, Number(delay?.minutes) || 0);
  const where = DELAY_WHERE[delay?.where] ? delay.where : 'middle';
  const w = DELAY_WHERE[where];
  return { minutes, where, extraSec: minutes * 60, fromM: w.from * totalDistM, toM: w.to * totalDistM, label: w.label };
}

/** Extra seconds accumulated by the time the driver reaches `distM`. */
export function congestionAt(d, distM) {
  if (!d?.extraSec) return 0;
  if (distM <= d.fromM) return 0;
  if (distM >= d.toM) return d.extraSec;
  return (d.extraSec * (distM - d.fromM)) / (d.toM - d.fromM);
}

/** Elapsed trip seconds after `driveSec` of driving, including completed breaks. */
export function elapsedWithBreaks(driveSec, totalDriveSec, plan = BREAK_PLANS.none) {
  if (!plan?.everySec) return driveSec;
  // A break is taken after each full interval, but never at (or after) arrival.
  const taken = Math.floor(Math.min(driveSec, Math.max(0, totalDriveSec - 1)) / plan.everySec);
  const before = Math.floor(driveSec / plan.everySec);
  return driveSec + Math.min(taken, before) * plan.durationSec;
}

/** Human label for a point: "I 90 West near Toledo, OH". */
export function placeLabel(model, sample) {
  const place = nearestPlace(model.places, sample.lat, sample.lon);
  const road = model.route.roads.find((r) => sample.distM >= r.fromM && sample.distM <= r.toM)?.name;
  let near = '';
  if (place) {
    const mi = place.distM / 1609.344;
    near = mi < 8 ? `near ${place.name}, ${place.state}` : `${Math.round(mi)} mi from ${place.name}, ${place.state}`;
  }
  return { road: road || null, near, text: [road, near].filter(Boolean).join(' · ') || `${sample.lat.toFixed(2)}, ${sample.lon.toFixed(2)}` };
}

/**
 * Evaluate every route sample for a departure (UTC ms).
 * model = { route, samples, pointIdx, sampleToPoint, forecasts, places }
 */
export function evaluateTrip(model, departureUtc, { breakPlan = BREAK_PLANS.none, vehicle = 'car', delay = null } = {}) {
  const { samples, sampleToPoint, forecasts } = model;
  const totalDrive = samples[samples.length - 1].driveSec;
  const totalDist = samples[samples.length - 1].distM;
  const dly = makeDelay(delay, totalDist);
  // Moving (in-car) time = routed drive time + scenario delay accumulated so far.
  const moving = samples.map((smp) => smp.driveSec + congestionAt(dly, smp.distM));
  const totalMoving = totalDrive + dly.extraSec;
  const rows = new Array(samples.length);
  const totals = { glareMin: [0, 0, 0, 0], expectedGlareMin: [0, 0, 0, 0], rearMin: 0, nightMin: 0, twilightMin: 0, wetMin: 0, snowMin: 0, iceMin: 0, lowVisMin: 0, windMin: 0, stormMin: 0, heavyRainMin: 0, missingMin: 0 };
  let minTemp = Infinity;
  let maxTemp = -Infinity;
  let maxCrossMph = 0;
  let maxCrossIdx = -1;
  for (let s = 0; s < samples.length; s++) {
    const smp = samples[s];
    const t = departureUtc + elapsedWithBreaks(moving[s], totalMoving, breakPlan) * 1000;
    const sun = sunPosition(t, smp.lat, smp.lon);
    const phase = lightPhase(sun.altitude);
    const g = geometricGlare(sun.altitude, sun.azimuth, smp.heading);
    const series = forecasts[sampleToPoint[s]];
    const wx = lookupForecast(series, t);
    const adj = cloudAdjustedSeverity(g.severity, wx);
    const hz = hazards(wx, smp.heading, vehicle);
    const congested = dly.extraSec > 0 && smp.distM > dly.fromM && smp.distM < dly.toM;
    rows[s] = { t, sun, phase, glare: g, expected: adj.severity, muted: adj.muted, mutedReason: adj.reason, wx, hz, timezone: series?.timezone, congested, delaySec: moving[s] - smp.driveSec };
    // Minutes represented by this sample: half the in-car time gap to each neighbor.
    const prev = s > 0 ? moving[s - 1] : moving[s];
    const next = s < samples.length - 1 ? moving[s + 1] : moving[s];
    const min = (next - prev) / 2 / 60;
    totals.glareMin[g.severity] += min;
    totals.expectedGlareMin[adj.severity] += min;
    if (g.rear) totals.rearMin += min;
    if (phase === 'night') totals.nightMin += min;
    if (phase === 'twilight') totals.twilightMin += min;
    if (!wx) totals.missingMin += min;
    if (hz.wet) totals.wetMin += min;
    if (hz.snow) totals.snowMin += min;
    if (hz.ice) totals.iceMin += min;
    if (hz.lowVis) totals.lowVisMin += min;
    if (hz.windy) totals.windMin += min;
    if (hz.storm) totals.stormMin += min;
    if (hz.heavyRain) totals.heavyRainMin += min;
    if (wx?.temperature != null) {
      minTemp = Math.min(minTemp, wx.temperature);
      maxTemp = Math.max(maxTemp, wx.temperature);
    }
    if (hz.crossMph > maxCrossMph) {
      maxCrossMph = hz.crossMph;
      maxCrossIdx = s;
    }
  }
  const arrivalUtc = rows[rows.length - 1].t;
  return {
    departureUtc,
    arrivalUtc,
    elapsedSec: (arrivalUtc - departureUtc) / 1000,
    driveSec: totalDrive,
    movingSec: totalMoving,
    delay: dly,
    rows,
    totals,
    minTemp: Number.isFinite(minTemp) ? minTemp : null,
    maxTemp: Number.isFinite(maxTemp) ? maxTemp : null,
    maxCrossMph,
    maxCrossIdx,
    windows: {
      glare: findWindows(rows, (r) => r.glare.severity > 0, 8),
      rear: findWindows(rows, (r) => r.glare.rear, 5),
      wet: findWindows(rows, (r) => r.hz.wet || r.hz.snow, 5),
      snow: findWindows(rows, (r) => r.hz.snow || r.hz.ice),
      wind: findWindows(rows, (r) => r.hz.windy),
      lowVis: findWindows(rows, (r) => r.hz.lowVis),
      night: findWindows(rows, (r) => r.phase === 'night'),
      missing: findWindows(rows, (r) => !r.wx),
      jam: findWindows(rows, (r) => r.congested),
    },
  };
}

/** Group consecutive rows matching `pred` into [start, end] index windows; tolerate 1-sample gaps. */
export function findWindows(rows, pred, maxGap = 1) {
  const out = [];
  let start = -1;
  let lastHit = -1;
  for (let i = 0; i < rows.length; i++) {
    if (pred(rows[i], i)) {
      if (start < 0) start = i;
      lastHit = i;
    } else if (start >= 0 && i - lastHit > maxGap) {
      out.push([start, lastHit]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, lastHit]);
  return out;
}

/** Summary of a glare window for display and advice. */
export function describeGlareWindow(model, ev, [a, b]) {
  let peak = a;
  let peakExpected = 0;
  let strongMin = 0;
  let mutedCount = 0;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let minOff = Infinity;
  const clouds = [];
  for (let i = a; i <= b; i++) {
    const r = ev.rows[i];
    if (r.glare.score > ev.rows[peak].glare.score) peak = i;
    peakExpected = Math.max(peakExpected, r.expected);
    if (r.muted) mutedCount++;
    if (r.expected >= 2 && i < b) strongMin += (ev.rows[i + 1].t - r.t) / 60000;
    if (r.glare.severity > 0) {
      minAlt = Math.min(minAlt, r.sun.altitude);
      maxAlt = Math.max(maxAlt, r.sun.altitude);
      minOff = Math.min(minOff, r.glare.offset);
    }
    if (r.wx?.cloudCover != null) clouds.push(r.wx.cloudCover);
  }
  const startT = ev.rows[a].t;
  const endT = ev.rows[b].t;
  const pr = ev.rows[peak];
  const sunrise = pr.sun.azimuth < 180;
  return {
    a,
    b,
    peak,
    startT,
    endT,
    minutes: (endT - startT) / 60000 + 1,
    peakSeverity: pr.glare.severity,
    peakExpected,
    strongMin,
    mutedShare: mutedCount / (b - a + 1),
    sunAltRange: [Math.max(minAlt, -0.8), maxAlt],
    minOffset: minOff,
    avgCloud: clouds.length ? clouds.reduce((x, y) => x + y, 0) / clouds.length : null,
    kind: sunrise ? 'sunrise' : 'sunset',
    heading: model.samples[peak].heading,
    timezone: pr.timezone,
    where: placeLabel(model, model.samples[peak]),
    startWhere: placeLabel(model, model.samples[a]),
  };
}
