// common.js — shared helpers for the optional, key-based traffic routing adapters.
// Nothing here logs or embeds the API key in errors, warnings or provenance.
import { haversine } from '../geo.js';

/** Departures more than this far in the future use the provider's predictive (historical/typical) traffic. */
export const LIVE_WINDOW_MS = 30 * 60e3;

export const MODE_LABEL = {
  predictive: 'predictive (provider historical/typical traffic for that departure time)',
  live: 'live traffic',
  none: 'no traffic data (free-flow)',
};

export function trafficMode(departureUtc, nowMs = Date.now()) {
  return departureUtc - nowMs > LIVE_WINDOW_MS ? 'predictive' : 'live';
}

export class TrafficError extends Error {
  constructor(provider, kind, message, status = null) {
    super(message);
    this.name = 'TrafficError';
    this.provider = provider;
    this.kind = kind; // 'auth' | 'forbidden' | 'rate' | 'request' | 'unavailable' | 'parse' | 'config'
    this.status = status;
  }
}

/** Friendly, key-free message for an HTTP status. */
export function errorForStatus(provider, status, detail = '') {
  const d = detail ? ` (${String(detail).slice(0, 160)})` : '';
  if (status === 401) return new TrafficError(provider, 'auth', `${provider} rejected the API key (401 invalid or missing key). Check the key you pasted.`, status);
  if (status === 403) return new TrafficError(provider, 'forbidden', `${provider} refused the request (403 forbidden): the key may not be enabled for this API, may be restricted to other domains, or the account needs attention.`, status);
  if (status === 429) return new TrafficError(provider, 'rate', `${provider} rate limit or free-tier quota reached (429). Try again later.`, status);
  if (status >= 400 && status < 500) return new TrafficError(provider, 'request', `${provider} could not route this trip (HTTP ${status})${d}.`, status);
  return new TrafficError(provider, 'unavailable', `${provider} traffic routing is unavailable (HTTP ${status}).`, status);
}

/** Strip any key-looking query parameter from a string before it could reach a message. */
export function redact(s) {
  return String(s).replace(/((?:key|apikey|apiKey|access_token)=)[^&\s]+/g, '$1***');
}

export async function fetchJson(fetchImpl, url, provider, { signal, timeoutMs = 25000 } = {}) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new TrafficError(provider, 'unavailable', ctrl.signal.aborted ? `${provider} traffic routing timed out.` : `${provider} traffic routing is unreachable.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const detail = body?.error?.description || body?.detailedError?.message || body?.title || body?.message || body?.error_description || '';
    throw errorForStatus(provider, res.status, redact(typeof detail === 'string' ? detail : ''));
  }
  if (!body) throw new TrafficError(provider, 'parse', `${provider} returned an unreadable response.`);
  return body;
}

export function cumulativeDistance(coords) {
  const n = coords.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  return cum;
}

/**
 * Fill cumTime from anchor points [{ idx, t }] (cumulative seconds at a coordinate index),
 * interpolating by distance between anchors. Anchors must start at index 0.
 */
export function cumTimeFromAnchors(cumDist, anchors) {
  const n = cumDist.length;
  const cum = new Float64Array(n);
  const a = anchors.filter((x) => x.idx >= 0 && x.idx < n).sort((x, y) => x.idx - y.idx);
  if (!a.length || a[0].idx !== 0) a.unshift({ idx: 0, t: 0 });
  for (let k = 0; k < a.length; k++) {
    const p = a[k];
    const q = a[k + 1];
    if (!q) {
      for (let i = p.idx + 1; i < n; i++) cum[i] = p.t;
      break;
    }
    const tq = Math.max(p.t, q.t); // never let time run backwards
    const span = cumDist[q.idx] - cumDist[p.idx];
    for (let i = p.idx + 1; i <= q.idx; i++) {
      const f = span > 0 ? (cumDist[i] - cumDist[p.idx]) / span : (i - p.idx) / Math.max(1, q.idx - p.idx);
      cum[i] = p.t + (tq - p.t) * f;
    }
    q.t = tq;
  }
  cum[0] = 0;
  return cum;
}

/** Scale an existing cumulative-time curve so it ends at `totalSec` (used when only a total is known). */
export function scaleCumTime(cumTime, totalSec) {
  const end = cumTime[cumTime.length - 1];
  return Array.from(cumTime, (t, i) => (end > 0 ? (t * totalSec) / end : (totalSec * i) / Math.max(1, cumTime.length - 1)));
}

export function assertMonotonic(cumTime, provider) {
  for (let i = 1; i < cumTime.length; i++) {
    if (!(cumTime[i] >= cumTime[i - 1]) || !Number.isFinite(cumTime[i])) throw new TrafficError(provider, 'parse', `${provider} returned inconsistent segment times.`);
  }
}

/** Build the normalized route shape used by providers.js / planner.js. */
export function normalizedRoute(engine, coords, cumDist, cumTime, roads, traffic) {
  if (coords.length < 2) throw new TrafficError(traffic.provider, 'parse', `${traffic.provider}: no route found`);
  const ct = Array.from(cumTime);
  assertMonotonic(ct, traffic.provider);
  return {
    engine,
    coords,
    cumDist: Array.from(cumDist),
    cumTime: ct,
    totalDistM: cumDist[cumDist.length - 1],
    totalSec: ct[ct.length - 1],
    roads,
    traffic,
  };
}

export const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
