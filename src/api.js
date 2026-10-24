// api.js — routing (OSRM demo) + forecast weather (Open-Meteo). No API keys required.
// If a network call fails, callers fall back to clearly-labeled simulated data.

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

// Returns { coordinates: [[lat,lon],...], durationSec, distanceM, simulated:false }
export async function getRoute(origin, destination) {
  const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (!data.routes || !data.routes.length) throw new Error('No route found');
  const r = data.routes[0];
  // GeoJSON is [lon,lat]; normalize to [lat,lon].
  const coordinates = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  return {
    coordinates,
    durationSec: r.duration,
    distanceM: r.distance,
    simulated: false,
  };
}

/**
 * Fetch hourly forecast and return the values at (or nearest to) targetDate.
 * Returns { temperatureC, precipitationMm, snowfallCm, windSpeedKmh, windDirDeg, weatherCode, simulated }.
 */
export async function getForecastAt(lat, lon, targetDate) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      'temperature_2m,precipitation,rain,snowfall,wind_speed_10m,wind_direction_10m,weather_code',
    wind_speed_unit: 'kmh',
    forecast_days: '7',
    timezone: 'auto',
  });
  const url = `${OPEN_METEO}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const times = data.hourly.time.map((t) => new Date(t).getTime());
  const target = targetDate.getTime();
  let bestIdx = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - target);
    if (d < bestDelta) {
      bestDelta = d;
      bestIdx = i;
    }
  }
  const h = data.hourly;
  return {
    temperatureC: h.temperature_2m[bestIdx],
    precipitationMm: h.precipitation[bestIdx],
    rainMm: h.rain[bestIdx],
    snowfallCm: h.snowfall[bestIdx],
    windSpeedKmh: h.wind_speed_10m[bestIdx],
    windDirDeg: h.wind_direction_10m[bestIdx],
    weatherCode: h.weather_code[bestIdx],
    validTime: h.time[bestIdx],
    simulated: false,
  };
}

// Deterministic simulated forecast (used only when the network is unavailable).
export function simulatedForecast(lat, lon, targetDate) {
  const hour = targetDate.getHours();
  const seed = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233)) ;
  const temp = 8 + 10 * Math.sin((hour / 24) * Math.PI) + (seed - 0.5) * 6;
  const precip = seed > 0.7 ? (seed - 0.7) * 10 : 0;
  return {
    temperatureC: Number(temp.toFixed(1)),
    precipitationMm: Number(precip.toFixed(1)),
    rainMm: Number((precip * 0.8).toFixed(1)),
    snowfallCm: temp < 0 ? Number((precip * 0.3).toFixed(1)) : 0,
    windSpeedKmh: Number((5 + seed * 30).toFixed(0)),
    windDirDeg: Math.round(seed * 360),
    weatherCode: precip > 1 ? 61 : 1,
    validTime: targetDate.toISOString(),
    simulated: true,
  };
}
