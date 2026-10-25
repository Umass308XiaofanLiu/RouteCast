// PROTOTYPE — terrain sun-occlusion (geographic line-of-sight) helpers.
// Pure logic, no DOM, no network. NOT wired into the UI or the glare score.
// See docs/OCCLUSION.md for scope, limits and integration cost.

export const EARTH_RADIUS_M = 6371008.8;
export const REFRACTION_K = 0.13; // standard atmospheric refraction coefficient
export const TILE_SIZE = 256;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Mapzen/AWS "terrarium" encoding → meters. */
export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

/** Fractional Web-Mercator tile coordinates (x, y) at zoom z. */
export function tileXYFloat(lat, lon, z) {
  const n = 2 ** z;
  const latC = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin(latC * D2R);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

/** Integer tile index containing (lat, lon) at zoom z. */
export function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const { x, y } = tileXYFloat(lat, lon, z);
  return {
    x: ((Math.floor(x) % n) + n) % n,
    y: Math.min(n - 1, Math.max(0, Math.floor(y))),
    z,
  };
}

/** Tile + pixel (0..255) containing (lat, lon) at zoom z. */
export function pixelLookup(lat, lon, z, tileSize = TILE_SIZE) {
  const f = tileXYFloat(lat, lon, z);
  const t = tileXY(lat, lon, z);
  const px = Math.min(tileSize - 1, Math.max(0, Math.floor((f.x - Math.floor(f.x)) * tileSize)));
  const py = Math.min(tileSize - 1, Math.max(0, Math.floor((f.y - Math.floor(f.y)) * tileSize)));
  return { ...t, px, py };
}

/** Approximate ground size of one pixel (m) at latitude and zoom. */
export function metersPerPixel(lat, z, tileSize = TILE_SIZE) {
  return (Math.cos(lat * D2R) * 2 * Math.PI * EARTH_RADIUS_M) / (tileSize * 2 ** z);
}

/** Great-circle destination point. */
export function destinationPoint(lat, lon, bearingDeg, distM) {
  const d = distM / EARTH_RADIUS_M;
  const b = bearingDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * R2D, lon: ((((l2 * R2D + 540) % 360) + 360) % 360) - 180 };
}

/** Apparent drop (m) of a target at distance d from curvature, reduced by standard refraction. */
export function curvatureDropM(distM) {
  return ((distM * distM) / (2 * EARTH_RADIUS_M)) * (1 - REFRACTION_K);
}

/** Sample distances: uniform if stepM is given, otherwise ~60 geometric samples (dense near the observer). */
export function sampleDistances(maxDistM, stepM) {
  const out = [];
  if (stepM && stepM > 0) {
    for (let d = stepM; d <= maxDistM + 1e-9; d += stepM) out.push(d);
    return out;
  }
  const n = 60;
  const d0 = Math.min(30, maxDistM);
  const ratio = (maxDistM / d0) ** (1 / (n - 1));
  for (let i = 0; i < n; i++) out.push(d0 * ratio ** i);
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * March outward along azimuth and return the apparent terrain horizon altitude.
 * sampleElevation(lat, lon) may be sync or async; returns meters or null.
 * @returns {Promise<{horizonAltDeg:number|null, atDistM:number|null, coverage:number, samples:number, status:string}>}
 *   status: 'ok' | 'no-observer-elevation' | 'no-data'
 *   minDistM (default 0) ignores samples closer than this to the observer.
 */
export async function terrainHorizon({
  lat,
  lon,
  azimuthDeg,
  sampleElevation,
  observerHeightM = 1.5,
  maxDistM = 30000,
  stepM,
  minDistM = 0,
}) {
  // minDistM skips near-field samples: at ~30 m/px the first 1–3 DEM pixels mostly reflect road cuts,
  // embankments and pixel quantisation, not a real horizon (see docs/OCCLUSION.md validation).
  const dists = sampleDistances(maxDistM, stepM).filter((d) => d >= minDistM);
  const h0raw = await sampleElevation(lat, lon);
  if (!isNum(h0raw)) {
    return { horizonAltDeg: null, atDistM: null, coverage: 0, samples: dists.length, status: 'no-observer-elevation' };
  }
  const eye = h0raw + observerHeightM;
  let best = -Infinity;
  let bestD = null;
  let have = 0;
  for (const d of dists) {
    const p = destinationPoint(lat, lon, azimuthDeg, d);
    const h = await sampleElevation(p.lat, p.lon);
    if (!isNum(h)) continue;
    have++;
    const alt = Math.atan((h - eye - curvatureDropM(d)) / d) * R2D;
    if (alt > best) {
      best = alt;
      bestD = d;
    }
  }
  const coverage = dists.length ? have / dists.length : 0;
  if (have === 0) return { horizonAltDeg: null, atDistM: null, coverage, samples: dists.length, status: 'no-data' };
  return { horizonAltDeg: best, atDistM: bestD, coverage, samples: dists.length, status: 'ok' };
}

/**
 * Classify the sun against a terrain horizon. Never returns 'blocked' from missing data:
 * 'unknown' if observer elevation missing, coverage < 0.9, or sun within ±margin of the horizon.
 */
export function sunBlocked({ sunAltDeg, horizon, marginDeg = 0.5, minCoverage = 0.9 }) {
  if (!isNum(sunAltDeg) || !horizon || horizon.status !== 'ok') return 'unknown';
  if (!isNum(horizon.horizonAltDeg) || !(horizon.coverage >= minCoverage)) return 'unknown';
  if (sunAltDeg < horizon.horizonAltDeg - marginDeg) return 'blocked';
  if (sunAltDeg > horizon.horizonAltDeg + marginDeg) return 'visible';
  return 'unknown';
}
