// conditions.js — which projected condition applies to each route sample, and where to
// put condition icons. Pure logic (no DOM) so it can be unit-tested.
import { findWindows } from './trip.js';

// Draw priority (first wins when icons would overlap).
export const COND_ORDER = ['glare', 'snow', 'rain', 'fog', 'wind', 'jam', 'sun-aligned', 'night'];

export const COND_LABEL = {
  glare: 'Strong low sun ahead',
  'sun-aligned': 'Sun aligned, clouds forecast',
  snow: 'Snow / ice',
  rain: 'Rain',
  fog: 'Fog / low visibility',
  wind: 'Strong crosswind gusts',
  jam: 'Assumed traffic delay',
  night: 'Dark',
};

/** Conditions projected for one evaluated row (at that point's arrival time). */
export function rowConditions(r) {
  const out = [];
  if (r.expected >= 2) out.push('glare');
  else if (r.glare.severity >= 2) out.push('sun-aligned');
  const h = r.hz;
  if (h.snow || h.ice) out.push('snow');
  else if (h.wet) out.push('rain');
  else if (h.lowVis) out.push('fog');
  if (h.windy) out.push('wind');
  if (r.congested) out.push('jam');
  if (r.phase === 'night') out.push('night');
  return out;
}

/**
 * Candidate icon positions: the center of every condition window plus one every `stepKm`
 * samples inside long windows. Samples are ~1 km apart. The UI thins them by screen distance.
 */
const STEP_KM = { night: 45, 'sun-aligned': 20, jam: 6 };

export function conditionCandidates(ev, { stepKm: defaultStep = 9 } = {}) {
  const conds = ev.rows.map(rowConditions);
  const out = [];
  for (const cat of COND_ORDER) {
    const windows = findWindows(ev.rows, (_, i) => conds[i].includes(cat), 2);
    const stepKm = STEP_KM[cat] ?? defaultStep;
    // Snap to the nearest sample inside the window where the condition really holds
    // (windows tolerate 1–2 sample gaps).
    const snap = (i, a, b) => {
      for (let k = 0; k <= b - a; k++) {
        if (i - k >= a && conds[i - k].includes(cat)) return i - k;
        if (i + k <= b && conds[i + k].includes(cat)) return i + k;
      }
      return a;
    };
    for (const [a, b] of windows) {
      const center = snap(Math.round((a + b) / 2), a, b);
      out.push({ cat, idx: center, range: [a, b], rank: 0 });
      for (let i = a + Math.floor(stepKm / 2); i <= b; i += stepKm) {
        if (Math.abs(i - center) >= stepKm / 2) out.push({ cat, idx: snap(i, a, b), range: [a, b], rank: 1 });
      }
    }
  }
  return out.sort((x, y) => COND_ORDER.indexOf(x.cat) - COND_ORDER.indexOf(y.cat) || x.rank - y.rank);
}

/** Greedy screen-space thinning: keep candidates at least `minPx` apart, at most `max`. */
export function thinByDistance(cands, project, { minPx = 44, max = 60 } = {}) {
  const kept = [];
  for (const c of cands) {
    if (kept.length >= max) break;
    const p = project(c.idx);
    if (kept.every((k) => (k.p.x - p.x) ** 2 + (k.p.y - p.y) ** 2 >= minPx * minPx)) kept.push({ ...c, p });
  }
  return kept;
}
