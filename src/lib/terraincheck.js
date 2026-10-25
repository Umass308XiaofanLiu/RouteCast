// terraincheck.js — separate, approximate "might terrain hide the low sun?" check for glare windows.
// Pure logic with an injected elevation sampler. It NEVER modifies ev, glare severity or scores;
// it only returns a per-window summary that the UI shows beside the existing glare advice.
import { terrainHorizon, sunBlocked } from './horizon.js';

export const TERRAIN_SOURCE_NOTE = 'Bare-earth elevation (AWS Terrain Tiles, ~30 m); buildings, trees and road cuts are not modeled';

function abortError() {
  const e = new Error('Terrain check aborted');
  e.name = 'AbortError';
  return e;
}

/** Up to n row indices in [a, b] with geometric glare ≥ 1, evenly spread, always including the peak. */
export function pickSamples(ev, d, n = 6) {
  const cand = [];
  for (let i = d.a; i <= d.b; i++) if ((ev.rows[i]?.glare?.severity ?? 0) >= 1) cand.push(i);
  if (!cand.length || n <= 0) return [];
  const out = new Set();
  if (cand.includes(d.peak)) out.add(d.peak);
  if (cand.length <= n) cand.forEach((i) => out.add(i));
  else {
    const k = n - out.size;
    for (let j = 0; j < k; j++) out.add(cand[Math.round((j * (cand.length - 1)) / Math.max(1, k - 1))]);
    for (let j = 0; out.size < n && j < cand.length; j++) out.add(cand[j]);
  }
  return [...out].sort((x, y) => x - y);
}

export function windowStatus({ checked, blocked, visible }) {
  if (checked === 0 || blocked + visible === 0) return 'unknown';
  if (blocked >= 1 && blocked / checked >= 0.5) return 'terrain-may-hide';
  if (blocked >= 1) return 'partly';
  if (visible === checked) return 'open';
  return 'unknown'; // some visible, rest unknown, none blocked: not enough to call it open
}

/**
 * @param model trip model (model.samples[i].lat/lon)
 * @param ev    evaluateTrip result (ev.rows[i].sun.altitude/azimuth, ev.rows[i].glare.severity)
 * @param descs describeGlareWindow(...) results ({a, b, peak})
 * @returns Promise<Array<{a,b,peak,checked,blocked,visible,unknown,status,samples:Array}>>
 */
export async function checkGlareWindows(model, ev, descs, { sampleElevation, maxSamplesPerWindow = 6, signal, concurrency = 4, horizonOpts = {} } = {}) {
  if (typeof sampleElevation !== 'function') throw new TypeError('sampleElevation is required');
  const limit = Math.max(1, Math.min(4, concurrency));
  if (signal?.aborted) throw abortError();
  const guarded = async (lat, lon) => {
    if (signal?.aborted) throw abortError();
    try {
      return await sampleElevation(lat, lon);
    } catch {
      return null;
    }
  };
  const jobs = [];
  const results = descs.map((d) => {
    const r = { a: d.a, b: d.b, peak: d.peak, checked: 0, blocked: 0, visible: 0, unknown: 0, status: 'unknown', samples: [] };
    for (const i of pickSamples(ev, d, maxSamplesPerWindow)) jobs.push({ r, i });
    return r;
  });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      if (signal?.aborted) throw abortError();
      const { r, i } = jobs[next++];
      const smp = model.samples[i];
      const sun = ev.rows[i].sun;
      const horizon = await terrainHorizon({ lat: smp.lat, lon: smp.lon, azimuthDeg: sun.azimuth, sampleElevation: guarded, ...horizonOpts });
      const verdict = sunBlocked({ sunAltDeg: sun.altitude, horizon });
      r.checked++;
      r[verdict]++;
      r.samples.push({ i, verdict, sunAltDeg: sun.altitude, horizonAltDeg: horizon.horizonAltDeg, atDistM: horizon.atDistM, coverage: horizon.coverage });
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  if (signal?.aborted) throw abortError();
  for (const r of results) {
    r.samples.sort((x, y) => x.i - y.i);
    r.status = windowStatus(r);
  }
  return results;
}

/** One-line, user-facing summary for a window result. */
export function terrainLine(result) {
  switch (result?.status) {
    case 'terrain-may-hide':
      return 'Terrain check (approximate): hills likely hide the low sun for part of this stretch.';
    case 'partly':
      return 'Terrain check (approximate): hills may hide the low sun at some points of this stretch.';
    case 'open':
      return 'Terrain check (approximate): open horizon toward the sun.';
    default:
      if (result?.samples?.some((s) => s.coverage > 0)) return 'Terrain check inconclusive (sun too close to the terrain horizon or incomplete elevation data).';
      return 'Terrain check unavailable (elevation tiles did not load).';
  }
}
