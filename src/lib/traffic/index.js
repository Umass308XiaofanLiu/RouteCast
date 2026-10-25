// traffic/index.js — optional traffic-aware routing (user-supplied key; never required).
// routeWithTraffic returns the same normalized route shape as providers.js (coords, cumDist, cumTime,
// totalSec, roads, engine) plus `traffic` provenance. Manual delay assumptions in trip.js stay separate.
import { routeTomTom } from './tomtom.js';
import { routeHere } from './here.js';
import { routeMapbox } from './mapbox.js';
import { TrafficError, MODE_LABEL, trafficMode, LIVE_WINDOW_MS } from './common.js';

export { TrafficError, MODE_LABEL, trafficMode, LIVE_WINDOW_MS };
export { decodeFlexible } from './flexpolyline.js';

export const TRAFFIC_PROVIDERS = {
  tomtom: { label: 'TomTom', fn: routeTomTom, keyName: 'API key', signup: 'https://developer.tomtom.com/' },
  here: { label: 'HERE', fn: routeHere, keyName: 'API key', signup: 'https://platform.here.com/' },
  mapbox: { label: 'Mapbox', fn: routeMapbox, keyName: 'access token', signup: 'https://account.mapbox.com/' },
};

/** Statement shown with any traffic-provider optimizer result (one request per plan, not per candidate). */
export const OPTIMIZER_TRAFFIC_NOTE = "Other departure times reuse this plan's traffic timing (one traffic request per plan); traffic is not re-requested for each bar.";

export async function routeWithTraffic(origin, dest, { provider, departureUtc, apiKey, fetchImpl = fetch, signal, nowMs = Date.now() } = {}) {
  const p = TRAFFIC_PROVIDERS[provider];
  if (!p) throw new TrafficError(String(provider), 'config', `Unknown traffic provider "${provider}".`);
  if (!apiKey) throw new TrafficError(p.label, 'config', `${p.label} needs your own ${p.keyName}.`);
  return p.fn(origin, dest, { departureUtc, apiKey, fetchImpl, signal, nowMs });
}
