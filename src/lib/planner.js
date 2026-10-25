// planner.js — build a trip model: routed samples + time-aligned forecast series.
import { getRoute, fetchForecasts } from './providers.js';
import { resampleRoute } from './geo.js';
import { pickForecastPoints, assignSamplesToPoints } from './forecast.js';
import { BREAK_PLANS, elapsedWithBreaks } from './trip.js';
import { routeWithTraffic, TRAFFIC_PROVIDERS, MODE_LABEL } from './traffic/index.js';

export const MAX_TRIP_HOURS = 30;

/**
 * Fetch route and forecasts for a trip. `places` is the label dataset.
 * Forecasts cover departure − 3.5 h … arrival + 5.5 h so the optimizer can shift departures
 * and a delay scenario of up to 2 h stays inside the fetched window.
 */
export async function buildTripModel({ origin, dest, departureUtc, breakPlan = BREAK_PLANS.none, places, fetchImpl = fetch, signal, nowMs = Date.now(), onStage = () => {}, traffic = null }) {
  onStage('route');
  // Optional traffic-aware routing with the user's own key. Any failure falls back to free-flow
  // routing with a visible warning (never silent); the key never appears in messages.
  let route = null;
  let warnings = [];
  let trafficInfo = null;
  if (traffic?.provider && traffic.provider !== 'none' && traffic.apiKey) {
    try {
      route = await routeWithTraffic(origin, dest, { provider: traffic.provider, departureUtc, apiKey: traffic.apiKey, fetchImpl, signal, nowMs });
      trafficInfo = route.traffic;
    } catch (e) {
      if (signal?.aborted) throw e;
      const label = TRAFFIC_PROVIDERS[traffic.provider]?.label || traffic.provider;
      trafficInfo = { provider: label, mode: 'none', departureUtc, retrievedAt: null, freeFlowSec: null, trafficDelaySec: null, error: e.message, note: MODE_LABEL.none };
      route = null;
      warnings.push(`Traffic-aware routing failed: ${e.message} Using free-flow routing instead.`);
    }
  }
  if (!route) {
    const r = await getRoute(origin, dest, { fetchImpl, signal });
    route = r.route;
    warnings = [...warnings, ...r.warnings];
  }
  if (route.totalSec > MAX_TRIP_HOURS * 3600) {
    throw new Error(`This route is ${Math.round(route.totalSec / 3600)} h of driving; RouteCast supports trips up to ${MAX_TRIP_HOURS} h.`);
  }
  const samples = resampleRoute(route, 1000, 600);
  const pointIdx = pickForecastPoints(samples);
  const sampleToPoint = assignSamplesToPoints(samples, pointIdx);
  onStage('forecast');
  const elapsed = elapsedWithBreaks(route.totalSec, route.totalSec, breakPlan);
  const forecasts = await fetchForecasts(
    pointIdx.map((i) => samples[i]),
    departureUtc - 3.5 * 3600e3,
    departureUtc + (elapsed + 5.5 * 3600) * 1000,
    { fetchImpl, signal, nowMs }
  );
  return {
    origin,
    dest,
    originTz: origin.timezone,
    destTz: dest.timezone,
    originLabel: origin.label,
    destLabel: dest.label,
    route,
    samples,
    pointIdx,
    sampleToPoint,
    forecasts,
    places,
    warnings,
    source: { kind: 'live', capturedAt: nowMs, routing: route.engine, forecast: 'Open-Meteo', traffic: trafficInfo },
  };
}

/** Serialize the network-derived parts of a model as a compact recorded snapshot. */
export function toSnapshot(model, departureUtc, meta = {}) {
  const r = model.route;
  const round = (x) => Math.round(x * 1e5) / 1e5;
  return {
    version: 1,
    capturedAt: model.source.capturedAt,
    departureUtc,
    origin: model.origin,
    dest: model.dest,
    route: {
      engine: r.engine,
      coords: r.coords.map(([a, b]) => [round(a), round(b)]),
      cumDist: r.cumDist.map((x) => Math.round(x)),
      cumTime: r.cumTime.map((x) => Math.round(x * 10) / 10),
      totalDistM: r.totalDistM,
      totalSec: r.totalSec,
      roads: r.roads,
    },
    forecasts: model.forecasts,
    ...meta,
  };
}

/** Rebuild a model from a recorded snapshot (no network). */
export function fromSnapshot(snap, places) {
  const route = snap.route;
  const samples = resampleRoute(route, 1000, 600);
  const pointIdx = pickForecastPoints(samples);
  if (pointIdx.length !== snap.forecasts.length) throw new Error('Snapshot forecast points do not match the route sampling');
  return {
    origin: snap.origin,
    dest: snap.dest,
    originTz: snap.origin.timezone,
    destTz: snap.dest.timezone,
    originLabel: snap.origin.label,
    destLabel: snap.dest.label,
    route,
    samples,
    pointIdx,
    sampleToPoint: assignSamplesToPoints(samples, pointIdx),
    forecasts: snap.forecasts,
    places,
    warnings: [],
    source: { kind: 'snapshot', capturedAt: snap.capturedAt, routing: route.engine, forecast: 'Open-Meteo' },
  };
}
