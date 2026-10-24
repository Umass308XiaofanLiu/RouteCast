// providers.js — network adapters. All sources are free, keyless and CORS-enabled.
// Every adapter takes an injectable fetch so tests can replay recorded responses.
import { decodePolyline, haversine } from './geo.js';
import { normalizeOpenMeteo } from './forecast.js';
import { STATE_ABBR } from './states.js';

export const ENDPOINTS = {
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
  valhalla: 'https://valhalla1.openstreetmap.de/route',
  osrm: 'https://router.project-osrm.org/route/v1/driving',
  forecast: 'https://api.open-meteo.com/v1/forecast',
};

export class ProviderError extends Error {
  constructor(provider, message, cause) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.cause = cause;
  }
}

async function getJson(fetchImpl, url, provider, { timeoutMs = 20000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const reason = body?.reason || body?.error || body?.message || `HTTP ${res.status}`;
      throw new ProviderError(provider, `${provider}: ${reason}`);
    }
    return body;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (signal?.aborted) throw e;
    const msg = ctrl.signal.aborted ? `${provider} timed out` : `${provider} unreachable`;
    throw new ProviderError(provider, msg, e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Search US places by name. Accepts "Amherst" or "Amherst, MA". */
export async function geocode(query, { fetchImpl = fetch, signal } = {}) {
  const [rawName, rawState] = String(query || '').split(',').map((s) => s.trim());
  if (!rawName || rawName.length < 2) return [];
  const url = `${ENDPOINTS.geocode}?${new URLSearchParams({ name: rawName, count: '10', language: 'en', format: 'json', countryCode: 'US' })}`;
  const data = await getJson(fetchImpl, url, 'Geocoding', { signal, timeoutMs: 10000 });
  let results = (data?.results || []).map((r) => {
    const state = STATE_ABBR[r.admin1] || r.admin1 || '';
    return {
      id: r.id,
      name: r.name,
      state,
      label: state ? `${r.name}, ${state}` : r.name,
      detail: r.admin2 || '',
      lat: r.latitude,
      lon: r.longitude,
      timezone: r.timezone,
      population: r.population || 0,
    };
  });
  if (rawState) {
    const want = rawState.toUpperCase();
    const filtered = results.filter((r) => r.state.toUpperCase() === want || (r.state && STATE_ABBR[rawState] === r.state));
    if (filtered.length) results = filtered;
  }
  return results;
}

/** Valhalla (FOSSGIS public server). Per-maneuver routed times, distributed by distance within a maneuver. */
export async function routeValhalla(origin, dest, { fetchImpl = fetch, signal } = {}) {
  const req = {
    locations: [
      { lat: origin.lat, lon: origin.lon },
      { lat: dest.lat, lon: dest.lon },
    ],
    costing: 'auto',
    units: 'kilometers',
    directions_type: 'maneuvers',
  };
  const url = `${ENDPOINTS.valhalla}?json=${encodeURIComponent(JSON.stringify(req))}`;
  const data = await getJson(fetchImpl, url, 'Valhalla routing', { signal, timeoutMs: 25000 });
  const leg = data?.trip?.legs?.[0];
  if (!leg?.shape || !leg.maneuvers?.length) throw new ProviderError('Valhalla routing', 'Valhalla routing: no route found');
  const coords = decodePolyline(leg.shape, 6);
  const n = coords.length;
  const cumDist = new Float64Array(n);
  for (let i = 1; i < n; i++) cumDist[i] = cumDist[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  const cumTime = new Float64Array(n);
  const roads = [];
  for (const m of leg.maneuvers) {
    const a = m.begin_shape_index;
    const b = m.end_shape_index;
    const span = cumDist[b] - cumDist[a];
    for (let i = a + 1; i <= b; i++) {
      const f = span > 0 ? (cumDist[i] - cumDist[a]) / span : 1;
      cumTime[i] = cumTime[a] + m.time * f;
    }
    if (m.street_names?.length && b > a) roads.push({ fromM: cumDist[a], toM: cumDist[b], name: m.street_names[0] });
  }
  return finalizeRoute('Valhalla', coords, cumDist, cumTime, roads);
}

/** OSRM public demo server. Per-segment durations from annotations. */
export async function routeOsrm(origin, dest, { fetchImpl = fetch, signal } = {}) {
  const url = `${ENDPOINTS.osrm}/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&annotations=duration&steps=true`;
  const data = await getJson(fetchImpl, url, 'OSRM routing', { signal, timeoutMs: 25000 });
  const r = data?.routes?.[0];
  if (!r) throw new ProviderError('OSRM routing', `OSRM routing: ${data?.message || 'no route found'}`);
  const coords = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  const dur = r.legs[0].annotation?.duration;
  const n = coords.length;
  const cumDist = new Float64Array(n);
  const cumTime = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cumDist[i] = cumDist[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  if (dur && dur.length === n - 1) {
    for (let i = 1; i < n; i++) cumTime[i] = cumTime[i - 1] + dur[i - 1];
  } else {
    for (let i = 1; i < n; i++) cumTime[i] = (r.duration * cumDist[i]) / cumDist[n - 1];
  }
  const roads = [];
  let d = 0;
  for (const s of r.legs[0].steps || []) {
    const name = s.ref || s.name;
    if (name && s.distance > 0) roads.push({ fromM: d, toM: d + s.distance, name: name.split(';')[0].trim() });
    d += s.distance;
  }
  return finalizeRoute('OSRM', coords, cumDist, cumTime, roads);
}

function finalizeRoute(engine, coords, cumDist, cumTime, roads) {
  return {
    engine,
    coords,
    cumDist: Array.from(cumDist),
    cumTime: Array.from(cumTime),
    totalDistM: cumDist[cumDist.length - 1],
    totalSec: cumTime[cumTime.length - 1],
    roads,
  };
}

/** Try Valhalla first, then OSRM. Never substitutes a straight line. */
export async function getRoute(origin, dest, opts = {}) {
  const errors = [];
  for (const fn of [routeValhalla, routeOsrm]) {
    try {
      const route = await fn(origin, dest, opts);
      return { route, warnings: errors.map((e) => e.message) };
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      errors.push(e);
    }
  }
  throw new ProviderError('Routing', `No driving route available (${errors.map((e) => e.message).join('; ')})`);
}

const HOURLY = [
  'temperature_2m', 'precipitation', 'rain', 'snowfall', 'precipitation_probability', 'weather_code',
  'cloud_cover', 'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Maximum forecast end date accepted by Open-Meteo (16 days including today). */
export function forecastHorizonEnd(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 15, 23);
}

/** Hourly forecasts for many points in one request. Returns series in input order. */
export async function fetchForecasts(points, startMs, endMs, { fetchImpl = fetch, signal, nowMs = Date.now() } = {}) {
  const horizon = forecastHorizonEnd(nowMs);
  const start = Math.max(startMs, nowMs - 864e5);
  const end = Math.min(endMs, horizon);
  if (start > end) throw new ProviderError('Open-Meteo forecast', 'Trip is beyond the 16-day forecast horizon');
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    hourly: HOURLY,
    timezone: 'auto',
    timeformat: 'unixtime',
    start_date: isoDate(start - 864e5 / 2),
    end_date: isoDate(Math.min(end + 864e5 / 2, horizon)),
  });
  const data = await getJson(fetchImpl, `${ENDPOINTS.forecast}?${params}`, 'Open-Meteo forecast', { signal, timeoutMs: 25000 });
  const list = Array.isArray(data) ? data : [data];
  if (list.length !== points.length) throw new ProviderError('Open-Meteo forecast', 'Open-Meteo forecast: unexpected number of locations');
  return list.map(normalizeOpenMeteo);
}
