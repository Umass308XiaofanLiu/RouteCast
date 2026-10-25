// overlays/index.js — keyless live overlays for REAL-data plans only (never synthetic demo or snapshots).
// Fetches are bounded by a timeout, abort with the trip, and a failure only yields a muted note.
import { buildRouteIndex } from './routeindex.js';
import { nycPortion, nycUrl, parseNycRows, speedScope, matchSlowLinks, suggestDelay } from './nycdot.js';
import { feedsForRoute, parseWzdx, matchWorkZones } from './wzdx.js';

export * from './nycdot.js';
export * from './wzdx.js';
export { buildRouteIndex, distToRoute, matchGeometry } from './routeindex.js';

export const OVERLAY_TIMEOUT_MS = 12000;

async function getJson(url, { fetchImpl, signal, timeoutMs }) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers?.get?.('content-type') || '';
    if (ct && !/json/i.test(ct)) throw new Error('not JSON');
    return await res.json();
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (ctrl.signal.aborted) throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const routeIndexCache = new WeakMap();
export function routeIndexFor(model) {
  let idx = routeIndexCache.get(model);
  if (!idx) routeIndexCache.set(model, (idx = buildRouteIndex(model.route.coords)));
  return idx;
}

/** Human labels of the overlay sources that would be queried for this plan (empty = nothing relevant). */
export function overlaySources(model, departureUtc, nowMs = Date.now()) {
  if (model?.source?.kind !== 'live') return [];
  const out = [];
  if (speedScope({ sourceKind: 'live', departureUtc, nowMs, hasNyc: Boolean(nycPortion(model.route.coords)) }).use) out.push('NYC DOT real-time speeds');
  for (const f of feedsForRoute(routeIndexFor(model).bbox)) out.push(`${f.agency} work zones (WZDx)`);
  return out;
}

/**
 * Fetch the raw overlay data relevant to a plan. Never throws (except AbortError); errors become notes.
 * Returns { nyc: {asOf, links} | null, nycError, wz: [{agency, feedTime, zones}], wzErrors: [...] }.
 */
export async function fetchOverlays(model, { departureUtc, nowMs = Date.now(), fetchImpl = fetch, signal, timeoutMs = OVERLAY_TIMEOUT_MS } = {}) {
  const out = { nyc: null, nycError: null, wz: [], wzErrors: [] };
  if (model?.source?.kind !== 'live') return out; // demo/snapshot: no overlay network at all
  const index = routeIndexFor(model);
  const nycBox = nycPortion(model.route.coords);
  const jobs = [];
  if (speedScope({ sourceKind: 'live', departureUtc, nowMs, hasNyc: Boolean(nycBox) }).use) {
    jobs.push(
      getJson(nycUrl(), { fetchImpl, signal, timeoutMs })
        .then((rows) => {
          const parsed = parseNycRows(rows);
          const b = nycBox;
          parsed.links = parsed.links.filter((l) => l.pts.some(([lat, lon]) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon));
          out.nyc = parsed;
        })
        .catch((e) => {
          if (e.name === 'AbortError') throw e;
          out.nycError = e.message || String(e);
        })
    );
  }
  for (const feed of feedsForRoute(index.bbox)) {
    jobs.push(
      getJson(feed.url, { fetchImpl, signal, timeoutMs })
        .then((json) => out.wz.push({ agency: feed.agency, ...parseWzdx(json, feed.agency) }))
        .catch((e) => {
          if (e.name === 'AbortError') throw e;
          out.wzErrors.push({ agency: feed.agency, error: e.message || String(e) });
        })
    );
  }
  await Promise.all(jobs);
  return out;
}

/** Evaluate fetched overlay data against the CURRENT evaluation (departure/delay may change later). */
export function evaluateOverlays(raw, model, ev, { nowMs = Date.now() } = {}) {
  const index = routeIndexFor(model);
  const res = { speed: null, speedNote: null, zones: [], zoneFeeds: [], notes: [] };
  const scope = speedScope({ sourceKind: model.source.kind, departureUtc: ev.departureUtc, nowMs, asOf: raw?.nyc ? raw.nyc.asOf : raw?.nycError ? null : undefined, hasNyc: Boolean(nycPortion(model.route.coords)) });
  if (raw?.nycError && scope.reason !== 'future-departure' && scope.reason !== 'not-real') res.notes.push({ kind: 'nyc-error', text: `NYC DOT speeds unavailable (${raw.nycError}).` });
  else if (raw?.nyc && scope.reason === 'stale') res.speedNote = { kind: 'stale', asOf: raw.nyc.asOf };
  else if (raw?.nyc && scope.use) {
    const slow = matchSlowLinks(raw.nyc.links, index, model, ev);
    res.speed = { asOf: raw.nyc.asOf, slow, suggestion: suggestDelay(slow, model.samples.length) };
  }
  for (const f of raw?.wz || []) {
    res.zoneFeeds.push({ agency: f.agency, feedTime: f.feedTime });
    res.zones.push(...matchWorkZones(f.zones, index, model, ev).map((z) => ({ ...z, feedTime: f.feedTime })));
  }
  for (const e of raw?.wzErrors || []) res.notes.push({ kind: 'wz-error', text: `${e.agency} work-zone feed unavailable (${e.error}).` });
  return res;
}
