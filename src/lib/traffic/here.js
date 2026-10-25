// here.js — HERE Routing API v8 adapter (needs the user's own HERE API key).
// Docs: https://www.here.com/docs/bundle/routing-api-v8-api-reference/page/index.html
//   GET https://router.hereapi.com/v8/routes?transportMode=car&origin=lat,lng&destination=lat,lng
//   &departureTime=<RFC 3339> (omitted -> "now"; HERE uses live+historical traffic around now and
//   historical/typical speeds further ahead) &return=polyline,summary,travelSummary&spans=duration,length&apiKey=…
// Response: routes[0].sections[] { polyline: <flexible polyline>, summary { duration, length, baseDuration,
//   typicalDuration }, travelSummary {…}, spans: [{ offset (index into the section polyline), duration, length }] }.
// `baseDuration` = duration without traffic. Shapes reconstructed from the documentation; VERIFIED only
// against mocked responses (no real call made).
import { decodeFlexible } from './flexpolyline.js';
import { fetchJson, cumulativeDistance, cumTimeFromAnchors, normalizedRoute, isoSeconds, trafficMode, TrafficError, MODE_LABEL } from './common.js';

export const HERE_HOST = 'https://router.hereapi.com';
const P = 'HERE';

export function hereUrl(origin, dest, { departureUtc, apiKey, nowMs = Date.now() }) {
  const params = new URLSearchParams({
    transportMode: 'car',
    origin: `${origin.lat},${origin.lon}`,
    destination: `${dest.lat},${dest.lon}`,
    return: 'polyline,summary,travelSummary',
    spans: 'duration,length',
    apiKey,
  });
  if (trafficMode(departureUtc, nowMs) === 'predictive') params.set('departureTime', isoSeconds(departureUtc));
  return `${HERE_HOST}/v8/routes?${params}`;
}

export function parseHere(data, { departureUtc, nowMs = Date.now(), retrievedAt = nowMs } = {}) {
  const sections = data?.routes?.[0]?.sections;
  if (!sections?.length) throw new TrafficError(P, 'parse', `HERE: ${data?.notices?.[0]?.title || 'no route found'}`);
  const coords = [];
  const anchors = [];
  let tBase = 0;
  let total = 0;
  let base = 0;
  let typical = 0;
  let allSpans = true;
  for (const sec of sections) {
    const pts = decodeFlexible(sec.polyline).polyline.map(([a, b]) => [a, b]);
    const off = coords.length ? coords.length - 1 : 0; // section start shares the previous end point
    pts.forEach((p, i) => (i === 0 && coords.length ? null : coords.push(p)));
    const dur = Number(sec.summary?.duration) || 0;
    const spans = (sec.spans || []).filter((s) => Number.isFinite(s.duration) && Number.isInteger(s.offset));
    if (spans.length) {
      let t = tBase;
      for (const s of spans) {
        anchors.push({ idx: off + s.offset, t });
        t += s.duration;
      }
    } else {
      allSpans = false;
      anchors.push({ idx: off, t: tBase });
    }
    tBase += dur;
    anchors.push({ idx: coords.length - 1, t: tBase });
    total += dur;
    base += Number(sec.summary?.baseDuration ?? dur);
    typical += Number(sec.summary?.typicalDuration ?? NaN);
  }
  if (!(total > 0)) throw new TrafficError(P, 'parse', 'HERE: response has no duration');
  const cumDist = cumulativeDistance(coords);
  const cumTime = cumTimeFromAnchors(cumDist, anchors);
  const mode = trafficMode(departureUtc, nowMs);
  const timing = allSpans ? 'per-span durations' : 'scaled total, not per-segment';
  return normalizedRoute('HERE', coords, cumDist, cumTime, [], {
    provider: 'HERE',
    mode,
    departureUtc,
    retrievedAt,
    totalSec: total,
    freeFlowSec: base,
    typicalSec: Number.isFinite(typical) ? typical : null,
    trafficDelaySec: total - base,
    timing,
    note: `${MODE_LABEL[mode]}; ${timing}. Delay = HERE duration − baseDuration (no-traffic).`,
  });
}

export async function routeHere(origin, dest, { departureUtc, apiKey, fetchImpl = fetch, signal, nowMs = Date.now() } = {}) {
  if (!apiKey) throw new TrafficError(P, 'config', 'HERE needs your own API key.');
  const data = await fetchJson(fetchImpl, hereUrl(origin, dest, { departureUtc, apiKey, nowMs }), P, { signal });
  return parseHere(data, { departureUtc, nowMs, retrievedAt: Date.now() });
}
