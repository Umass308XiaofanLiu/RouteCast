// E2E helpers: isolated headless Chrome + loopback preview server + recorded-response replay.
// No real network is used: routing/forecast/geocoding calls are answered from the recorded
// snapshots in public/fixtures; map tiles get a blank PNG; anything else is aborted.
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SHOTS = join(ROOT, 'docs', 'qa');
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export const SNAP = Object.fromEntries(
  ['amherst-chicago', 'albany-boston', 'amherst-nyc'].map((n) => [n, JSON.parse(readFileSync(join(ROOT, 'public', 'fixtures', `${n}.json`), 'utf8'))])
);
export const NOW = SNAP['amherst-chicago'].capturedAt; // fixed "current time" for all tests

const GEO = {
  amherst: [
    { id: 4929180, name: 'Amherst', admin1: 'Massachusetts', admin2: 'Hampshire', latitude: 42.3732, longitude: -72.5199, timezone: 'America/New_York', population: 39000 },
    { id: 5107760, name: 'Amherst', admin1: 'New York', admin2: 'Erie', latitude: 42.9784, longitude: -78.7998, timezone: 'America/New_York', population: 122000 },
  ],
  chicago: [{ id: 4887398, name: 'Chicago', admin1: 'Illinois', admin2: 'Cook', latitude: 41.8781, longitude: -87.6298, timezone: 'America/Chicago', population: 2700000 }],
  'new york': [{ id: 5128581, name: 'New York', admin1: 'New York', admin2: '', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York', population: 8800000 }],
  albany: [{ id: 5106834, name: 'Albany', admin1: 'New York', admin2: 'Albany', latitude: 42.6526, longitude: -73.7562, timezone: 'America/New_York', population: 97000 }],
  boston: [{ id: 4930956, name: 'Boston', admin1: 'Massachusetts', admin2: 'Suffolk', latitude: 42.3601, longitude: -71.0589, timezone: 'America/New_York', population: 650000 }],
};

function encSigned(v) {
  let x = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (x >= 0x20) {
    s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
    x >>= 5;
  }
  return s + String.fromCharCode(x + 63);
}
function encodePolyline(coords, precision = 6) {
  const f = 10 ** precision;
  let pLat = 0;
  let pLon = 0;
  let out = '';
  for (const [lat, lon] of coords) {
    const a = Math.round(lat * f);
    const b = Math.round(lon * f);
    out += encSigned(a - pLat) + encSigned(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

function findSnap(o, d) {
  const near = (p, q) => Math.abs(p.lat - q.lat) < 0.05 && Math.abs(p.lon - q.lon) < 0.05;
  return Object.values(SNAP).find((s) => near(s.origin, o) && near(s.dest, d));
}
function roadAt(route, dist) {
  return route.roads.find((r) => dist >= r.fromM && dist < r.toM)?.name;
}
export function toValhalla(s) {
  const r = s.route;
  const n = r.coords.length;
  const maneuvers = [];
  for (let i = 0; i < n - 1; i++) {
    const name = roadAt(r, r.cumDist[i]);
    maneuvers.push({ time: r.cumTime[i + 1] - r.cumTime[i], length: (r.cumDist[i + 1] - r.cumDist[i]) / 1000, begin_shape_index: i, end_shape_index: i + 1, street_names: name ? [name] : [] });
  }
  maneuvers.push({ time: 0, length: 0, begin_shape_index: n - 1, end_shape_index: n - 1, street_names: [] });
  return { trip: { status: 0, legs: [{ shape: encodePolyline(r.coords), maneuvers }], summary: { time: r.totalSec, length: r.totalDistM / 1000 } } };
}
export function toOsrm(s) {
  const r = s.route;
  return {
    code: 'Ok',
    routes: [{ duration: r.totalSec, distance: r.totalDistM, geometry: { coordinates: r.coords.map(([a, b]) => [b, a]) }, legs: [{ annotation: { duration: r.coords.slice(1).map((_, i) => r.cumTime[i + 1] - r.cumTime[i]) }, steps: r.roads.map((x) => ({ name: x.name, distance: x.toM - x.fromM })) }] }],
  };
}
const ALL_SERIES = Object.values(SNAP).flatMap((s) => s.forecasts);
function toOpenMeteo(url) {
  const q = new URL(url).searchParams;
  const lats = q.get('latitude').split(',').map(Number);
  const lons = q.get('longitude').split(',').map(Number);
  return lats.map((lat, i) => {
    const lon = lons[i];
    let best = ALL_SERIES[0];
    let bd = Infinity;
    for (const x of ALL_SERIES) {
      const d = (x.lat - lat) ** 2 + (x.lon - lon) ** 2;
      if (d < bd) {
        bd = d;
        best = x;
      }
    }
    return {
      latitude: best.lat, longitude: best.lon, timezone: best.timezone,
      hourly: { time: best.times.map((t) => t / 1000), temperature_2m: best.temperature, precipitation: best.precipitation, rain: best.rain, snowfall: best.snowfall, precipitation_probability: best.precipProbability, weather_code: best.weatherCode, cloud_cover: best.cloudCover, visibility: best.visibility, wind_speed_10m: best.windSpeed, wind_direction_10m: best.windDirection, wind_gusts_10m: best.windGusts },
    };
  });
}

export async function startServer() {
  await build({ root: ROOT, logLevel: 'error' });
  const server = await preview({ root: ROOT, logLevel: 'error', preview: { host: '127.0.0.1', port: 4180, strictPort: false } });
  return { server, url: server.resolvedUrls.local[0] };
}

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'gp-e2e-'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
  mkdirSync(SHOTS, { recursive: true });
  return {
    browser,
    async close() {
      await browser.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * New page with fixed clock and replayed network. `fail` toggles service failures at runtime:
 * { valhalla, osrm, forecast, geocode } -> true makes that service return HTTP 503.
 */
export async function openPage(browser, base, { mobile = false, query = '', fail = {} } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { width: 1440, height: 1000 });
  await page.emulateTimezone('America/New_York');
  await page.evaluateOnNewDocument((fixed) => {
    const Real = Date;
    const offset = fixed - Real.now();
    class FakeDate extends Real {
      constructor(...a) {
        if (a.length === 0) super(Real.now() + offset);
        else super(...a);
      }
      static now() {
        return Real.now() + offset;
      }
    }
    globalThis.Date = FakeDate;
  }, NOW);
  const calls = { valhalla: 0, osrm: 0, forecast: 0, geocode: 0, blocked: [] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const json = (body, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (url.startsWith(base) || url.startsWith('data:')) return req.continue();
    if (url.includes('tile.openstreetmap.org')) return req.respond({ status: 200, contentType: 'image/png', body: PNG });
    if (url.includes('geocoding-api.open-meteo.com')) {
      calls.geocode++;
      if (fail.geocode) return json({ error: true, reason: 'down' }, 503);
      const name = (new URL(url).searchParams.get('name') || '').toLowerCase();
      return json(GEO[name] ? { results: GEO[name] } : { generationtime_ms: 0.1 });
    }
    if (url.includes('valhalla1.openstreetmap.de')) {
      calls.valhalla++;
      if (fail.valhalla) return json({ error: 'Service unavailable' }, 503);
      const q = JSON.parse(new URL(url).searchParams.get('json'));
      const s = findSnap(q.locations[0], q.locations[1]);
      return s ? json(toValhalla(s)) : json({ error_code: 442, error: 'No path could be found for input' }, 400);
    }
    if (url.includes('router.project-osrm.org')) {
      calls.osrm++;
      if (fail.osrm) return json({ code: 'Error', message: 'busy' }, 503);
      const m = /driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/.exec(url);
      const s = m && findSnap({ lon: +m[1], lat: +m[2] }, { lon: +m[3], lat: +m[4] });
      return s ? json(toOsrm(s)) : json({ code: 'NoRoute', message: 'Impossible route' }, 400);
    }
    if (url.includes('api.open-meteo.com/v1/forecast')) {
      calls.forecast++;
      if (fail.forecast) return json({ error: true, reason: 'Service unavailable' }, 503);
      return json(toOpenMeteo(url));
    }
    calls.blocked.push(url);
    return req.abort();
  });
  await page.goto(`${base}${query ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#presets .preset');
  return { page, calls, errors, fail };
}

export const text = (page, sel) => page.$eval(sel, (el) => (el.innerText || el.textContent).replace(/\s+/g, ' ').trim());
export const visible = (page, sel) => page.$eval(sel, (el) => !el.hidden && el.offsetParent !== null);

export async function choosePlace(page, which, query) {
  const input = `#${which}-input`;
  await page.click(input, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type(input, query, { delay: 10 });
  await page.waitForFunction((w) => [...document.querySelectorAll(`#${w}-list li[role=option]`)].some((li) => !li.classList.contains('empty')), {}, which);
  await page.keyboard.press('Enter');
}

export async function setDeparture(page, value) {
  await page.$eval('#departure', (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function waitResult(page) {
  await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('#advice .rec, #advice .rec-empty').length > 0);
}
