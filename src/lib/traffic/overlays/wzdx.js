// wzdx.js — WZDx work-zone feeds that were probed keyless + CORS + JSON on 2026-10-24.
// USDOT registry (data.transportation.gov 69qe-yiui) corridor states MA/NY/PA/OH/IN/IL:
//   - Indiana DOT  https://in.carsprogram.org/carsapi_v1/api/wzdx   needapikey=false; HTTP 200 JSON, ACAO "*"  -> USED
//   - NYSDOT       https://511ny.org/api/wzdx                       needapikey=false; HTTP 200 but text/html   -> not usable
//   - MassDOT, PA Turnpike, Ohio DOT (OHGO), Illinois Tollway, IDOT: needapikey=true                      -> not used
// Work zones are closures/restrictions, not speeds: they are shown as labelled markers and advice lines,
// never as a timing change.
import { matchGeometry, arrivalAt } from './routeindex.js';

export const WZDX_FEEDS = [
  { id: 'indot', agency: 'INDOT', url: 'https://in.carsprogram.org/carsapi_v1/api/wzdx', bbox: { minLat: 37.7, maxLat: 41.8, minLon: -88.1, maxLon: -84.78 } },
];

const bboxHit = (a, b) => !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLon < b.minLon || a.minLon > b.maxLon);

/** Feeds whose coverage box intersects the route bbox. */
export function feedsForRoute(routeBbox) {
  return WZDX_FEEDS.filter((f) => bboxHit(f.bbox, routeBbox));
}

function vertices(geom) {
  if (!geom) return [];
  const c = geom.coordinates;
  const ll = (p) => [p[1], p[0]];
  switch (geom.type) {
    case 'Point':
      return [ll(c)];
    case 'MultiPoint':
    case 'LineString':
      return c.map(ll);
    case 'MultiLineString':
    case 'Polygon':
      return c.flat().map(ll);
    default:
      return [];
  }
}

const ms = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/** WZDx 4.x FeatureCollection -> { feedTime, zones: [...] }. Unknown shapes yield no zones. */
export function parseWzdx(json, agency) {
  const info = json?.road_event_feed_info || json?.feed_info || {};
  const zones = [];
  for (const f of Array.isArray(json?.features) ? json.features : []) {
    const p = f?.properties || {};
    const core = p.core_details || p;
    if (core.event_type && core.event_type !== 'work-zone') continue;
    const pts = vertices(f.geometry);
    if (!pts.length) continue;
    zones.push({
      id: String(f.id ?? core.road_event_id ?? zones.length),
      agency,
      road: (core.road_names || []).filter(Boolean).join(' / '),
      direction: core.direction || '',
      description: core.description || '',
      start: ms(p.start_date),
      end: ms(p.end_date),
      pts,
    });
  }
  return { feedTime: ms(info.update_date), zones };
}

/** Time overlap of the projected arrival with the zone's dates (missing dates count as open-ended). */
export function activeAt(zone, t) {
  if (t == null) return true;
  if (zone.start != null && t < zone.start) return false;
  if (zone.end != null && t > zone.end) return false;
  return true;
}

/** Zones within maxM of the route and active at the projected arrival there; duplicates (same road+text) merged. */
export function matchWorkZones(zones, index, model, ev, { maxM = 150 } = {}) {
  const out = [];
  const seen = new Set();
  const b = index.bbox;
  const pad = 0.01;
  for (const z of zones) {
    if (!z.pts.some(([lat, lon]) => lat >= b.minLat - pad && lat <= b.maxLat + pad && lon >= b.minLon - pad && lon <= b.maxLon + pad)) continue;
    const hit = matchGeometry(index, z.pts, maxM);
    if (!hit) continue;
    const at = arrivalAt(model, ev, hit.lat, hit.lon);
    if (!activeAt(z, at?.t)) continue;
    const k = `${z.road}|${z.description}|${at?.index}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...z, lat: hit.lat, lon: hit.lon, distM: hit.distM, sampleIndex: at?.index ?? null, arrivalUtc: at?.t ?? null });
  }
  return out.sort((a, b2) => (a.sampleIndex ?? 0) - (b2.sampleIndex ?? 0));
}
