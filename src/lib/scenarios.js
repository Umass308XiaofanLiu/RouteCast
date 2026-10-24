// scenarios.js — MANUAL DEMO SCENARIOS with deliberately hand-set (synthetic) weather and
// traffic-delay values. They exist only to demonstrate features and visuals reproducibly.
// No API is called: the route geometry and routed drive times come from a recorded real
// Valhalla route (public/fixtures), while every weather value below is invented on purpose.
import { resampleRoute } from './geo.js';
import { pickForecastPoints, assignSamplesToPoints } from './forecast.js';
import { zonedWallTimeToUtc, zonedParts } from './time.js';

const H = 3600e3;

/** Smooth 0..1 bump between a and b (fractions or hours) with soft edges. */
function band(x, a, b, edge = 0.05) {
  if (x <= a - edge || x >= b + edge) return 0;
  if (x >= a && x <= b) return 1;
  return x < a ? (x - (a - edge)) / edge : ((b + edge) - x) / edge;
}

function localHour(t, tz) {
  const p = zonedParts(t, tz);
  return p.hour + p.minute / 60;
}

const CLEAR = (frac, hr) => ({
  temperature: 6 + 8 * Math.sin(Math.max(0, Math.min(1, (hr - 7) / 10)) * Math.PI),
  precipitation: 0, rain: 0, snowfall: 0, precipProbability: 5, weatherCode: 0,
  cloudCover: 5, visibility: 30000, windSpeed: 10, windDirection: 300, windGusts: 18,
});

export const SCENARIOS = [
  {
    id: 'storm-crosswind',
    title: 'Heavy rain + crosswind',
    subtitle: 'Amherst → New York · 1:00 PM',
    route: 'amherst-nyc.json',
    depart: { hour: 13, minute: 0 },
    vehicle: 'high-profile',
    delay: { minutes: 0, where: 'middle' },
    story: 'A hand-set squall line with heavy rain and 85 km/h westerly gusts across the middle of the drive; vehicle set to van/truck.',
    weather(frac, t, tz) {
      const hr = localHour(t, tz);
      const rain = band(frac, 0.35, 0.75, 0.06);
      const wind = band(frac, 0.2, 0.85, 0.08);
      return {
        temperature: 14 - 2 * rain,
        precipitation: 6 * rain, rain: 6 * rain, snowfall: 0,
        precipProbability: 20 + 75 * rain,
        weatherCode: rain > 0.6 ? 65 : rain > 0.1 ? 61 : 3,
        cloudCover: 75 + 25 * rain,
        visibility: 20000 - 17000 * rain,
        windSpeed: 15 + 35 * wind, windDirection: 270, windGusts: 25 + 60 * wind,
        _hr: hr,
      };
    },
  },
  {
    id: 'sunset-glare',
    title: 'Westbound sunset glare',
    subtitle: 'Amherst → Chicago · 8:00 AM',
    route: 'amherst-chicago.json',
    depart: { hour: 8, minute: 0 },
    vehicle: 'car',
    delay: { minutes: 0, where: 'middle' },
    story: 'Hand-set clear skies everywhere, so the low sun straight ahead near Lake Erie is not softened by clouds.',
    weather(frac, t, tz) {
      return CLEAR(frac, localHour(t, tz));
    },
  },
  {
    id: 'snow-fog-night',
    title: 'Snow, fog and night',
    subtitle: 'Albany → Boston · 7:30 PM',
    route: 'albany-boston.json',
    depart: { hour: 19, minute: 30 },
    vehicle: 'car',
    delay: { minutes: 0, where: 'middle' },
    story: 'Hand-set snow over the Berkshires, freezing fog near Worcester, all after dark.',
    weather(frac) {
      const snow = band(frac, 0.12, 0.5, 0.06);
      const fog = band(frac, 0.6, 0.85, 0.05);
      return {
        temperature: -1 - 2.5 * snow + 1.5 * fog,
        precipitation: 1.6 * snow, rain: 0, snowfall: 1.8 * snow,
        precipProbability: 15 + 80 * snow,
        weatherCode: snow > 0.6 ? 75 : snow > 0.1 ? 71 : fog > 0.4 ? 48 : 3,
        cloudCover: 100,
        visibility: 15000 - 14200 * Math.max(snow * 0.95, fog * 0.98),
        windSpeed: 12 + 10 * snow, windDirection: 330, windGusts: 25 + 15 * snow,
      };
    },
  },
  {
    id: 'congestion-shift',
    title: 'Delay shifts the weather',
    subtitle: 'Amherst → New York · 3:30 PM · +75 min',
    route: 'amherst-nyc.json',
    depart: { hour: 15, minute: 30 },
    vehicle: 'car',
    delay: { minutes: 75, where: 'middle' },
    story: 'Hand-set: dry and sunny until 6:15 PM, then a rain band with gusts reaches the New York end. An assumed 75 min mid-route delay pushes arrival into the rain and darkness.',
    weather(frac, t, tz) {
      const hr = localHour(t, tz);
      const late = Math.max(0, Math.min(1, (hr - 18.25) / 0.5)) * band(frac, 0.55, 1.05, 0.08);
      return {
        temperature: 13 - 2 * late,
        precipitation: 5 * late, rain: 5 * late, snowfall: 0,
        precipProbability: 10 + 85 * late,
        weatherCode: late > 0.6 ? 65 : late > 0.1 ? 61 : 1,
        cloudCover: 15 + 85 * late,
        visibility: 30000 - 26000 * late,
        windSpeed: 12 + 25 * late, windDirection: 250, windGusts: 20 + 45 * late,
      };
    },
  },
];

export const SCENARIO_DATE = { year: 2026, month: 10, day: 25 };

/** Build a model for a scenario from a recorded route snapshot. No network calls. */
export function buildScenarioModel(scn, snap, places) {
  const route = snap.route;
  const samples = resampleRoute(route, 1000, 600);
  const pointIdx = pickForecastPoints(samples);
  const sampleToPoint = assignSamplesToPoints(samples, pointIdx);
  const tz = snap.origin.timezone;
  const departureUtc = zonedWallTimeToUtc({ ...SCENARIO_DATE, ...scn.depart }, tz);
  const total = samples[samples.length - 1].distM;
  const start = Math.floor((departureUtc - 5 * H) / H) * H;
  const end = departureUtc + route.totalSec * 1000 + 9 * H;
  const times = [];
  for (let t = start; t <= end; t += H) times.push(t);
  const forecasts = pointIdx.map((si, k) => {
    const ref = snap.forecasts[k] || snap.forecasts[snap.forecasts.length - 1];
    const ptz = ref.timezone || tz;
    const frac = samples[si].distM / total;
    const vals = times.map((t) => scn.weather(frac, t, ptz));
    const col = (key) => vals.map((v) => Math.round(v[key] * 100) / 100);
    return {
      timezone: ptz,
      lat: samples[si].lat,
      lon: samples[si].lon,
      times,
      temperature: col('temperature'),
      precipitation: col('precipitation'),
      rain: col('rain'),
      snowfall: col('snowfall'),
      precipProbability: col('precipProbability'),
      weatherCode: vals.map((v) => v.weatherCode),
      cloudCover: col('cloudCover'),
      visibility: col('visibility'),
      windSpeed: col('windSpeed'),
      windDirection: col('windDirection'),
      windGusts: col('windGusts'),
    };
  });
  return {
    model: {
      origin: snap.origin,
      dest: snap.dest,
      originTz: snap.origin.timezone,
      destTz: snap.dest.timezone,
      originLabel: snap.origin.label,
      destLabel: snap.dest.label,
      route,
      samples,
      pointIdx,
      sampleToPoint,
      forecasts,
      places,
      warnings: [],
      source: { kind: 'synthetic', scenario: scn.id, title: scn.title, story: scn.story, routeCapturedAt: snap.capturedAt, routing: route.engine, forecast: 'hand-set synthetic values' },
    },
    departureUtc,
    nowMs: departureUtc - 6 * H, // fixed reference "now" so the demo is reproducible on any date
  };
}
