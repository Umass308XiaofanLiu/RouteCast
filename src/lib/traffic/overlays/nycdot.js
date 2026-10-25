// nycdot.js — NYC DOT real-time traffic speeds (NYC Open Data / Socrata dataset i4gi-tjb9).
// Keyless, CORS "*" (verified 2026-10-24). These are CURRENT conditions only: they are used solely for
// a real-data plan departing within NEAR_TERM_MS of now, and only when data_as_of is fresh. They never
// change arrival times automatically; the user may copy a suggested delay into the manual delay control.
import { zonedWallTimeToUtc } from '../../time.js';
import { matchGeometry, arrivalAt } from './routeindex.js';

export const NYC_DOT_URL = 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json';
export const NYC_TZ = 'America/New_York';
export const NEAR_TERM_MS = 60 * 60e3; // departure must be within 60 min of now
export const MAX_AGE_MS = 20 * 60e3; // data_as_of must be at most 20 min old
export const SNAPSHOT_WINDOW_MS = 15 * 60e3; // links older than the newest row by more than this are dropped
// NYC five-borough bounding box (approximate, generous).
export const NYC_BBOX = { minLat: 40.49, maxLat: 40.92, minLon: -74.27, maxLon: -73.68 };
// Free-flow references (mph). The feed has no free-flow field, so these are GlarePilot assumptions.
export const FREE_FLOW_MPH = { highway: 50, other: 30 };
export const HIGHWAY_SLOW_MPH = 15;

const HIGHWAY_RE = /\b(BQE|BE|CBE|CIP|CVE|FDR|GCP|HHP|HRD|LIE|MDE|SIE|SSP|TNB|TBB|VWE|WSE|GWB|BPKWY|Belt Pkwy|Laurelton Pkwy|Westside Hwy|West Side Hwy|Hutchinson|Bruckner|Expwy|Expressway|Parkway|Pkwy|I[- ]?\d+)\b/i;

export function isHighway(name) {
  return HIGHWAY_RE.test(String(name || ''));
}

/** Route coordinates inside NYC, and their bounding box (null when the route never enters NYC). */
export function nycPortion(coords) {
  const b = NYC_BBOX;
  let n = 0;
  const box = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
  for (const [lat, lon] of coords) {
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) continue;
    n++;
    box.minLat = Math.min(box.minLat, lat);
    box.maxLat = Math.max(box.maxLat, lat);
    box.minLon = Math.min(box.minLon, lon);
    box.maxLon = Math.max(box.maxLon, lon);
  }
  if (!n) return null;
  const pad = 0.005;
  return { minLat: box.minLat - pad, maxLat: box.maxLat + pad, minLon: box.minLon - pad, maxLon: box.maxLon + pad };
}

/**
 * Query URL: newest rows only. In probes on 2026-10-24, `$where` comparisons on data_as_of returned [],
 * and link_points is a text column (no server-side geo filter), so we ask for the newest rows by
 * `$order=data_as_of DESC` with a `$limit`, and filter by the route's NYC bounding box client-side.
 */
export function nycUrl(limit = 1000) {
  const q = new URLSearchParams({ $select: 'link_id,speed,data_as_of,link_name,borough,link_points', $order: 'data_as_of DESC', $limit: String(limit) });
  return `${NYC_DOT_URL}?${q}`;
}

/** Parse a Socrata floating timestamp ("2026-10-24T19:57:07.000", NYC local) to UTC ms. */
export function parseAsOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
  if (!m) return null;
  const base = zonedWallTimeToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, NYC_TZ);
  return base + (Number(m[6]) || 0) * 1000;
}

/** "40.74,-73.77 40.75,-73.76 ..." -> [[lat, lon], ...] (the feed truncates long strings; partial pairs are dropped). */
export function parseLinkPoints(s) {
  const out = [];
  for (const tok of String(s || '').trim().split(/\s+/)) {
    const [a, b] = tok.split(',').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && a > 30 && b < -60) out.push([a, b]);
  }
  return out;
}

/** Normalise feed rows: keep the newest reading per link, from the latest snapshot window only. */
export function parseNycRows(rows) {
  const byId = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const asOf = parseAsOf(r.data_as_of);
    const speed = Number(r.speed);
    if (asOf == null || !r.link_id) continue;
    const prev = byId.get(r.link_id);
    if (prev && prev.asOf >= asOf) continue;
    byId.set(r.link_id, { id: String(r.link_id), name: String(r.link_name || ''), borough: r.borough || '', speedMph: Number.isFinite(speed) ? speed : null, asOf, pts: parseLinkPoints(r.link_points) });
  }
  const links = [...byId.values()];
  const newest = links.reduce((m, l) => Math.max(m, l.asOf), -Infinity);
  return { asOf: Number.isFinite(newest) ? newest : null, links: links.filter((l) => l.asOf >= newest - SNAPSHOT_WINDOW_MS) };
}

/**
 * Should NYC DOT speeds be used for this plan at all?
 * Returns { use: boolean, reason, ageMs } — reason is one of
 * 'not-real' | 'future-departure' | 'no-nyc' | 'no-data' (missing, or > 5 min in the future) | 'stale' | 'ok'.
 */
export function speedScope({ sourceKind, departureUtc, nowMs, asOf = undefined, hasNyc = true }) {
  if (sourceKind !== 'live') return { use: false, reason: 'not-real' };
  if (!(departureUtc - nowMs <= NEAR_TERM_MS)) return { use: false, reason: 'future-departure' };
  if (!hasNyc) return { use: false, reason: 'no-nyc' };
  if (asOf === undefined) return { use: true, reason: 'ok' }; // pre-fetch check
  if (asOf == null) return { use: false, reason: 'no-data' };
  const ageMs = nowMs - asOf;
  if (ageMs < -5 * 60e3) return { use: false, reason: 'no-data', ageMs }; // timestamp in the future: clock/zone mismatch
  if (ageMs > MAX_AGE_MS) return { use: false, reason: 'stale', ageMs };
  return { use: true, reason: 'ok', ageMs };
}

/** Is a link slow? speed < 50% of the free-flow reference, or < 15 mph on a highway. Speed 0/missing = no reading. */
export function isSlow(link) {
  const v = link.speedMph;
  if (!(v > 0)) return false;
  const hw = isHighway(link.name);
  const ref = hw ? FREE_FLOW_MPH.highway : FREE_FLOW_MPH.other;
  return v < 0.5 * ref || (hw && v < HIGHWAY_SLOW_MPH);
}

function lengthM(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const k = Math.cos((pts[i][0] * Math.PI) / 180);
    d += Math.hypot(pts[i][0] - pts[i - 1][0], (pts[i][1] - pts[i - 1][1]) * k) * 111320;
  }
  return d;
}

/** Slow links on the route (within maxM), each with estimated extra seconds vs the free-flow reference. */
export function matchSlowLinks(links, index, model, ev, { maxM = 150 } = {}) {
  const out = [];
  for (const l of links) {
    if (!isSlow(l) || l.pts.length < 1) continue;
    const hit = matchGeometry(index, l.pts, maxM);
    if (!hit) continue;
    const ref = isHighway(l.name) ? FREE_FLOW_MPH.highway : FREE_FLOW_MPH.other;
    const len = lengthM(l.pts);
    const mps = (mph) => mph * 0.44704;
    const extraSec = len > 0 ? Math.max(0, len / mps(l.speedMph) - len / mps(ref)) : 0;
    const at = arrivalAt(model, ev, hit.lat, hit.lon);
    out.push({ ...l, refMph: ref, lengthM: len, extraSec, lat: hit.lat, lon: hit.lon, distM: hit.distM, sampleIndex: at?.index ?? null });
  }
  return out.sort((a, b) => (a.sampleIndex ?? 0) - (b.sampleIndex ?? 0));
}

export const DELAY_OPTIONS_MIN = [15, 30, 45, 60, 90, 120];

/** Suggest a manual-delay setting from matched slow links: rounded UP to the next delay option. */
export function suggestDelay(slow, sampleCount) {
  const extraMin = slow.reduce((s, l) => s + l.extraSec, 0) / 60;
  if (!slow.length || extraMin <= 0) return null;
  const minutes = DELAY_OPTIONS_MIN.find((m) => m >= extraMin) ?? DELAY_OPTIONS_MIN[DELAY_OPTIONS_MIN.length - 1];
  const idx = slow.map((l) => l.sampleIndex).filter((i) => i != null);
  const frac = idx.length && sampleCount > 1 ? idx.reduce((a, b) => a + b, 0) / idx.length / (sampleCount - 1) : 1;
  const where = frac >= 0.75 ? 'end' : frac <= 0.25 ? 'start' : frac >= 0.375 && frac <= 0.625 ? 'middle' : 'spread';
  return { minutes, where, estimatedMin: Math.round(extraMin) };
}
