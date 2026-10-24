// forecast.js — pick the forecast value valid at an arrival time.
// Open-Meteo hourly semantics: temperature/cloud/visibility/wind speed+direction are
// instantaneous at the hour; precipitation/rain/snowfall/probability/gusts describe
// the PRECEDING hour. All series times are UTC epoch ms.
import { haversine } from './geo.js';

const HOUR = 3600e3;
const INSTANT = ['temperature', 'cloudCover', 'visibility', 'windSpeed'];
const PRECEDING = ['precipitation', 'rain', 'snowfall', 'precipProbability', 'windGusts'];

function lerp(a, b, f) {
  if (a == null) return f < 0.5 ? null : b;
  if (b == null) return f < 0.5 ? a : null;
  return a + (b - a) * f;
}

/**
 * Value of a forecast series at instant t (ms). Returns null outside the covered window,
 * never an extrapolated or invented value.
 */
export function lookupForecast(series, t) {
  const times = series?.times;
  if (!times || times.length < 2) return null;
  const first = times[0];
  const last = times[times.length - 1];
  if (t < first - HOUR / 2 || t > last + HOUR / 2) return null;
  // Bracketing indices for instantaneous variables.
  let i = Math.floor((t - first) / HOUR);
  i = Math.max(0, Math.min(times.length - 2, i));
  while (i > 0 && times[i] > t) i--;
  while (i < times.length - 2 && times[i + 1] <= t) i++;
  const f = Math.max(0, Math.min(1, (t - times[i]) / (times[i + 1] - times[i])));
  // Hour bin ending at or after t, for preceding-hour variables.
  let k = times[i] >= t ? i : i + 1;
  if (t > last) k = times.length - 1;
  const nearest = f < 0.5 ? i : i + 1;
  const out = { validTime: times[nearest], precipValidEnd: times[k] };
  for (const v of INSTANT) out[v] = lerp(series[v]?.[i] ?? null, series[v]?.[i + 1] ?? null, f);
  for (const v of PRECEDING) out[v] = series[v]?.[k] ?? null;
  out.windDirection = series.windDirection?.[nearest] ?? null; // circular: nearest, not interpolated
  out.weatherCode = series.weatherCode?.[nearest] ?? null;
  if (out.temperature == null && out.precipitation == null && out.weatherCode == null) return null;
  return out;
}

/**
 * Choose forecast locations along the route: roughly every `spacingSec` of driving and
 * at least every `maxGapM` meters, capped at `maxPoints`, always including both ends.
 * Returns indices into `samples`.
 */
export function pickForecastPoints(samples, { spacingSec = 1800, maxGapM = 45000, maxPoints = 40 } = {}) {
  const totalSec = samples[samples.length - 1].driveSec;
  const totalM = samples[samples.length - 1].distM;
  const wanted = Math.min(maxPoints, Math.max(2, Math.ceil(Math.max(totalSec / spacingSec, totalM / maxGapM)) + 1));
  const idx = [];
  for (let k = 0; k < wanted; k++) {
    const targetM = (totalM * k) / (wanted - 1);
    let best = 0;
    let bestD = Infinity;
    for (let s = 0; s < samples.length; s++) {
      const d = Math.abs(samples[s].distM - targetM);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!idx.includes(best)) idx.push(best);
  }
  return idx;
}

/** For each sample, the index (into forecast points) of the nearest forecast point along the route. */
export function assignSamplesToPoints(samples, pointIdx) {
  const out = new Array(samples.length);
  let p = 0;
  for (let s = 0; s < samples.length; s++) {
    while (
      p < pointIdx.length - 1 &&
      Math.abs(samples[pointIdx[p + 1]].distM - samples[s].distM) <= Math.abs(samples[pointIdx[p]].distM - samples[s].distM)
    ) {
      p++;
    }
    out[s] = p;
  }
  return out;
}

/** Normalize one Open-Meteo location response (timeformat=unixtime) into a series. */
export function normalizeOpenMeteo(loc) {
  const h = loc.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error('Forecast response missing hourly data');
  return {
    timezone: loc.timezone,
    lat: loc.latitude,
    lon: loc.longitude,
    times: h.time.map((s) => s * 1000),
    temperature: h.temperature_2m,
    precipitation: h.precipitation,
    rain: h.rain,
    snowfall: h.snowfall,
    precipProbability: h.precipitation_probability,
    weatherCode: h.weather_code,
    cloudCover: h.cloud_cover,
    visibility: h.visibility,
    windSpeed: h.wind_speed_10m,
    windDirection: h.wind_direction_10m,
    windGusts: h.wind_gusts_10m,
  };
}

/** Distance (m) between requested and returned grid location, for transparency. */
export function gridOffsetM(req, series) {
  return haversine(req.lat, req.lon, series.lat, series.lon);
}
