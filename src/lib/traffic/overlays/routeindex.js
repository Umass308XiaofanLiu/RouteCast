// routeindex.js — fast "distance from a point to the planned route line" for overlay matching.
// Route segments are bucketed into a ~0.01° grid; distances use a local equirectangular projection,
// which is accurate to well under a metre at the ~150 m scales used here.
import { nearestSample } from '../../geo.js';

const CELL = 0.01; // degrees
const M_PER_DEG = 111320;
const key = (i, j) => `${i}:${j}`;

/** Build an index over route coordinates [[lat, lon], ...]. */
export function buildRouteIndex(coords) {
  const grid = new Map();
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (let s = 0; s < coords.length - 1; s++) {
    const [a1, o1] = coords[s];
    const [a2, o2] = coords[s + 1];
    const i0 = Math.floor(Math.min(a1, a2) / CELL);
    const i1 = Math.floor(Math.max(a1, a2) / CELL);
    const j0 = Math.floor(Math.min(o1, o2) / CELL);
    const j1 = Math.floor(Math.max(o1, o2) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push(s);
      }
    }
  }
  for (const [lat, lon] of coords) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return { coords, grid, bbox: { minLat, maxLat, minLon, maxLon } };
}

function segDist(lat, lon, a, b) {
  const k = Math.cos((lat * Math.PI) / 180) * M_PER_DEG;
  const ax = (a[1] - lon) * k;
  const ay = (a[0] - lat) * M_PER_DEG;
  const bx = (b[1] - lon) * k;
  const by = (b[0] - lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance (m) from a point to the route line; Infinity if farther than ~1 km (outside nearby cells). */
export function distToRoute(index, lat, lon) {
  const i = Math.floor(lat / CELL);
  const j = Math.floor(lon / CELL);
  let best = Infinity;
  const seen = new Set();
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (const s of index.grid.get(key(i + di, j + dj)) || []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const d = segDist(lat, lon, index.coords[s], index.coords[s + 1]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/**
 * Match a geometry (list of [lat, lon] vertices) to the route.
 * A line matches when at least two of its vertices are within `maxM` (one vertex near the route is
 * typically a crossing road or overpass); a point / two-point geometry matches with one vertex.
 * Returns { distM, lat, lon } of the closest vertex, or null.
 */
export function matchGeometry(index, pts, maxM = 150) {
  let near = 0;
  let best = null;
  for (const [lat, lon] of pts) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = distToRoute(index, lat, lon);
    if (d <= maxM) {
      near++;
      if (!best || d < best.distM) best = { distM: d, lat, lon };
    }
  }
  const need = pts.length <= 2 ? 1 : 2;
  return near >= need ? best : null;
}

/** Projected arrival time (ms) at the route sample nearest to a point. */
export function arrivalAt(model, ev, lat, lon) {
  const hit = nearestSample(model.samples, lat, lon);
  return hit ? { index: hit.index, t: ev.rows[hit.index]?.t } : null;
}
