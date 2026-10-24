// geo.js — geodesy helpers. Angles: compass degrees, 0 = north, clockwise.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const EARTH_RADIUS_M = 6371008.8;

export function normalizeDeg(a) {
  return ((a % 360) + 360) % 360;
}

/** Smallest absolute difference between two compass angles (0..180). */
export function angleDiff(a, b) {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** Signed difference a - b in (-180, 180]. */
export function signedAngle(a, b) {
  let d = normalizeDeg(a) - normalizeDeg(b);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from point 1 to point 2. */
export function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * RAD;
  const φ2 = lat2 * RAD;
  const Δλ = (lon2 - lon1) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(Math.atan2(y, x) * DEG);
}

/** Decode a Google-style encoded polyline (precision 6 for Valhalla). Returns [[lat, lon], ...]. */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

/** Index i such that arr[i] <= x < arr[i+1] (arr ascending). Clamped. */
export function searchSorted(arr, x) {
  let lo = 0;
  let hi = arr.length - 1;
  if (x <= arr[0]) return 0;
  if (x >= arr[hi]) return hi - 1 < 0 ? 0 : hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Interpolate the position and driving time at distance d along a normalized route. */
export function pointAtDistance(route, d) {
  const { coords, cumDist, cumTime } = route;
  const i = searchSorted(cumDist, d);
  const j = Math.min(i + 1, coords.length - 1);
  const span = cumDist[j] - cumDist[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - cumDist[i]) / span)) : 0;
  return {
    lat: coords[i][0] + (coords[j][0] - coords[i][0]) * f,
    lon: coords[i][1] + (coords[j][1] - coords[i][1]) * f,
    driveSec: cumTime[i] + (cumTime[j] - cumTime[i]) * f,
    vertex: i,
  };
}

/**
 * Resample a normalized route every `stepM` meters. Each sample has the routed
 * driving time to reach it and a smoothed heading (bearing across ±headingWindowM).
 */
export function resampleRoute(route, stepM = 1000, headingWindowM = 600) {
  const total = route.cumDist[route.cumDist.length - 1];
  const samples = [];
  const n = Math.max(2, Math.ceil(total / stepM) + 1);
  for (let k = 0; k < n; k++) {
    const d = Math.min(total, (total * k) / (n - 1));
    const p = pointAtDistance(route, d);
    const a = pointAtDistance(route, Math.max(0, d - headingWindowM / 2));
    const b = pointAtDistance(route, Math.min(total, d + headingWindowM / 2));
    const heading =
      a.lat === b.lat && a.lon === b.lon ? (samples.length ? samples[samples.length - 1].heading : 0) : bearing(a.lat, a.lon, b.lat, b.lon);
    samples.push({ distM: d, lat: p.lat, lon: p.lon, driveSec: p.driveSec, heading, vertex: p.vertex });
  }
  return samples;
}

/** Nearest labeled place to a point from [[name, state, lat, lon], ...]. */
export function nearestPlace(places, lat, lon) {
  let best = null;
  let bestD = Infinity;
  const cosLat = Math.cos(lat * RAD);
  for (const p of places) {
    const dy = p[2] - lat;
    const dx = (p[3] - lon) * cosLat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = p;
    }
  }
  if (!best) return null;
  return { name: best[0], state: best[1], distM: haversine(lat, lon, best[2], best[3]) };
}

/** Compass label for a heading. */
export function compass(deg) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(normalizeDeg(deg) / 22.5) % 16];
}

/**
 * Nearest route sample to a point (e.g. a GPS fix). Returns { index, distM } or null when there
 * are no samples. Pure: the coordinates are only compared, never stored.
 */
export function nearestSample(samples, lat, lon) {
  if (!samples?.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const d = (samples[i].lat - lat) ** 2 + ((samples[i].lon - lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distM: haversine(lat, lon, samples[best].lat, samples[best].lon) };
}
