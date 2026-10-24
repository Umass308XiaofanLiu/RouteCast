// optimizer.js — re-evaluate the same route for nearby departure times.
import { evaluateTrip } from './trip.js';

// Exposure weights per minute. A transparent heuristic, not a crash-risk model.
export const WEIGHTS = {
  severeGlare: 3,
  strongGlare: 2,
  mildGlare: 0.5,
  snow: 4,
  ice: 5,
  heavyRain: 2,
  rain: 0.75,
  storm: 3,
  lowVis: 2,
  wind: 2,
  night: 0.4,
};

export function exposureScore(ev) {
  const t = ev.totals;
  const rainOnly = Math.max(0, t.wetMin - t.snowMin - t.heavyRainMin);
  return (
    WEIGHTS.severeGlare * t.expectedGlareMin[3] +
    WEIGHTS.strongGlare * t.expectedGlareMin[2] +
    WEIGHTS.mildGlare * t.expectedGlareMin[1] +
    WEIGHTS.snow * t.snowMin +
    WEIGHTS.ice * t.iceMin +
    WEIGHTS.heavyRain * t.heavyRainMin +
    WEIGHTS.rain * rainOnly +
    WEIGHTS.storm * t.stormMin +
    WEIGHTS.lowVis * t.lowVisMin +
    WEIGHTS.wind * t.windMin +
    WEIGHTS.night * t.nightMin
  );
}

/**
 * Evaluate departures shifted by `offsetsMin`. Candidates in the past or with more than
 * 5% of the drive outside the forecast window are marked unavailable rather than scored.
 */
export function optimizeDeparture(model, departureUtc, opts = {}, { nowMs = Date.now(), offsetsMin = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180] } = {}) {
  const base = evaluateTrip(model, departureUtc, opts);
  const baseScore = exposureScore(base);
  const candidates = offsetsMin.map((off) => {
    const dep = departureUtc + off * 60000;
    if (off !== 0 && dep < nowMs - 5 * 60000) return { offsetMin: off, departureUtc: dep, available: false, reason: 'in the past' };
    const ev = off === 0 ? base : evaluateTrip(model, dep, opts);
    const missingShare = ev.totals.missingMin / Math.max(1, ev.driveSec / 60);
    if (off !== 0 && missingShare > 0.05) return { offsetMin: off, departureUtc: dep, available: false, reason: 'beyond forecast' };
    return {
      offsetMin: off,
      departureUtc: dep,
      arrivalUtc: ev.arrivalUtc,
      available: true,
      score: exposureScore(ev),
      glareMin: ev.totals.expectedGlareMin[2] + ev.totals.expectedGlareMin[3],
      nightMin: ev.totals.nightMin,
      wetMin: ev.totals.wetMin,
      snowMin: ev.totals.snowMin + ev.totals.iceMin,
      windMin: ev.totals.windMin,
    };
  });
  const avail = candidates.filter((c) => c.available);
  // Prefer the smallest shift among near-ties (within 5% or 3 points of the best).
  const bestScore = Math.min(...avail.map((c) => c.score));
  const best = avail
    .filter((c) => c.score <= bestScore + Math.max(3, bestScore * 0.05))
    .sort((x, y) => Math.abs(x.offsetMin) - Math.abs(y.offsetMin))[0];
  const current = candidates.find((c) => c.offsetMin === 0);
  const improvement = current.score - best.score;
  const worthIt = best.offsetMin !== 0 && improvement >= Math.max(10, current.score * 0.2);
  return { base, baseScore, candidates, best, current, improvement, worthIt };
}
