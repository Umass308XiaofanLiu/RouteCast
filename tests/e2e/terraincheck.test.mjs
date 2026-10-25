// Terrain check (approximate) + terrain-adjusted glare in the real app (headless Chrome, no network).
// (1) shared helper page: unknown hosts (incl. AWS Terrain Tiles) are aborted → honest "unavailable".
// (2) own interception: DEM tiles are GENERATED terrarium PNGs (flat plain, or a west-rising sawtooth
//     "ridge" terrain that hides a low western sun); everything else except map tiles is aborted.
// In every case geometric KPIs, advice titles and advice severity stay identical.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { startServer, launch, openPage, text, waitResult, NOW } from './helpers.mjs';

let srv;
let chrome;
before(async () => {
  srv = await startServer();
  chrome = await launch();
});
after(async () => {
  await chrome?.close();
  await new Promise((r) => srv?.server.httpServer.close(r));
});

// ---- generated terrarium tiles ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 256×256 RGBA terrarium PNG; elev(lat, lon) in metres. */
function terrariumPng(z, x, y, elev) {
  const S = 256;
  const raw = Buffer.alloc((S * 4 + 1) * S);
  const n = 2 ** z;
  for (let py = 0; py < S; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / S)) / n))) * 180) / Math.PI;
    for (let px = 0; px < S; px++) {
      const lon = ((x + (px + 0.5) / S) / n) * 360 - 180;
      const v = elev(lat, lon) + 32768;
      const o = py * (S * 4 + 1) + 1 + px * 4;
      raw[o] = Math.floor(v / 256);
      raw[o + 1] = Math.floor(v) % 256;
      raw[o + 2] = Math.floor((v % 1) * 256);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const FLAT = () => 120;
// Terrain rising 60 % toward the WEST in 20 km sawtooth ramps: looking west, the horizon is ~30° high
// almost everywhere, so a low western sun is hidden; looking east it is open.
const RIDGE = (lat, lon) => 100 + 0.6 * ((((-lon * 111320 * Math.cos((lat * Math.PI) / 180)) % 20000) + 20000) % 20000);
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Page with fixed clock; DEM tiles from `elev` (null → 404); map tiles blank; all else aborted. */
async function openDemPage(browser, base, { query, elev }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
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
  const calls = { dem: [], blocked: [] };
  const errors = [];
  const cache = new Map();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(base) || url.startsWith('data:')) return req.continue();
    if (url.includes('tile.openstreetmap.org')) return req.respond({ status: 200, contentType: 'image/png', body: PNG1 });
    const m = /elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
    if (m) {
      calls.dem.push(url);
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (!elev) return req.respond({ status: 404, headers: cors, body: 'not found' });
      const key = m.slice(1).join('/');
      if (!cache.has(key)) cache.set(key, terrariumPng(+m[1], +m[2], +m[3], elev));
      return req.respond({ status: 200, contentType: 'image/png', headers: cors, body: cache.get(key) });
    }
    calls.blocked.push(url);
    return req.abort();
  });
  await page.goto(`${base}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#presets .preset');
  return { page, calls, errors };
}

const kpiValues = (page) => page.$$eval('#kpis .kpi', (ks) => ks.map((k) => [k.querySelector('.k-label').textContent, k.querySelector('.k-value').textContent]));
const glareSub = (page) => page.$eval('#kpis .kpi.glare .k-sub', (e) => e.textContent.replace(/\s+/g, ' ').trim());
const adviceSig = (page) => page.$$eval('#advice .rec', (ls) => ls.map((l) => `${l.className}|${l.querySelector('h3')?.textContent}`));
const waitText = (page, re, sel = '#advice .rec-terrain') =>
  page.waitForFunction((src, s) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), { timeout: 30000 }, re.source, sel);

test('sunset demo: terrain check is on demand, reports unavailable when DEM tiles fail, geometric KPIs unchanged', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await waitResult(page);
  const kpisBefore = await kpiValues(page);
  const subBefore = await glareSub(page);
  const adviceBefore = await adviceSig(page);
  const lines = await page.$$('#advice .rec-terrain');
  assert.ok(lines.length >= 1, 'glare card has a terrain line');
  assert.match(await text(page, '#advice .rec-terrain'), /Check terrain \(approximate\)/);
  assert.match(await page.$eval('#advice .rec-terrain', (e) => e.title), /Bare-earth elevation \(AWS Terrain Tiles, ~30 m\); buildings, trees and road cuts are not modeled/);
  assert.equal(await page.$eval('#advice [data-terrain-auto]', (e) => e.checked), false, 'auto check is OFF by default');
  assert.doesNotMatch(subBefore, /terrain check/, 'no terrain note before a check');
  assert.deepEqual(calls.blocked, [], 'no elevation request before the user asks');

  await page.click('#advice [data-terrain-run]');
  await waitText(page, /Terrain check unavailable \(elevation tiles did not load\)/);
  assert.ok(calls.blocked.length > 0 && calls.blocked.every((u) => u.includes('elevation-tiles-prod/terrarium/12/')), 'only DEM tiles were requested');
  assert.deepEqual(await kpiValues(page), kpisBefore, 'KPI values identical');
  assert.equal(await glareSub(page), `${subBefore} (terrain check: unavailable)`);
  assert.deepEqual(await adviceSig(page), adviceBefore, 'advice titles and severity identical');
  assert.doesNotMatch(await text(page, '#advice'), /hills likely hide|open horizon|Terrain-adjusted/);
  assert.equal(await page.$$eval('#timeline .tl-terrain-hidden', (r) => r.length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('glarepilot.terrainAuto')), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('generated flat DEM: open horizon, terrain-adjusted = cloud-adjusted strong glare, nothing hatched', async () => {
  const { page, calls, errors } = await openDemPage(chrome.browser, srv.url, { query: 'demo=sunset-glare', elev: FLAT });
  await waitResult(page);
  const kpisBefore = await kpiValues(page);
  const adviceBefore = await adviceSig(page);
  assert.equal(calls.dem.length, 0, 'normal plan: no DEM request');
  await page.click('#advice [data-terrain-run]');
  await waitText(page, /open horizon toward the sun/);
  const card = await text(page, '#advice .rec-terrain');
  const m = /Terrain-adjusted strong glare: (\d+) of (\d+) min/.exec(card);
  assert.ok(m, card);
  assert.equal(m[1], m[2], 'flat terrain hides nothing');
  assert.match(await glareSub(page), /\(terrain check: no hills in the way at checked points\)$/);
  assert.equal(await page.$$eval('#timeline .tl-terrain-hidden', (r) => r.length), 0);
  assert.deepEqual(await kpiValues(page), kpisBefore);
  assert.deepEqual(await adviceSig(page), adviceBefore);
  assert.ok(calls.dem.every((u) => u.includes('/terrarium/12/')));
  assert.deepEqual(calls.blocked, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('generated ridge DEM + "Check terrain automatically": hidden stretches hatched, labelled, remembered; geometric KPIs/advice unchanged', async () => {
  const { page, calls, errors } = await openDemPage(chrome.browser, srv.url, { query: 'demo=sunset-glare', elev: RIDGE });
  await waitResult(page);
  const kpisBefore = await kpiValues(page);
  const subBefore = await glareSub(page);
  const adviceBefore = await adviceSig(page);
  assert.equal(calls.dem.length, 0, 'auto check is off by default: no DEM request');

  await page.click('#advice [data-terrain-auto]'); // ticking it also runs the check now
  await waitText(page, /hills likely hide the low sun/);
  assert.equal(await page.evaluate(() => localStorage.getItem('glarepilot.terrainAuto')), '1');
  const card = await text(page, '#advice .rec-terrain');
  const m = /Terrain-adjusted strong glare: (\d+) of (\d+) min/.exec(card);
  assert.ok(m, card);
  assert.ok(Number(m[1]) < Number(m[2]), `ridge reduces terrain-adjusted strong glare: ${m[0]}`);
  assert.match(await glareSub(page), /^.+ \(terrain check: hills may hide ~\d+ of \d+ strong min\)$/);
  assert.ok((await glareSub(page)).startsWith(subBefore), 'original KPI subtext kept');
  const hatched = await page.$$eval('#timeline .tl-terrain-hidden', (r) => r.map((x) => x.querySelector('title').textContent));
  assert.ok(hatched.length >= 1 && hatched.every((t) => /Terrain likely hides the sun/.test(t)));
  assert.match(await text(page, '#timeline'), /Hatched sun glare: terrain likely hides the sun/);
  assert.match(await page.$eval('#timeline svg', (s) => s.getAttribute('aria-label')), /terrain check: hills likely hide the sun/);
  assert.deepEqual(await kpiValues(page), kpisBefore, 'geometric/cloud KPI values identical');
  assert.deepEqual(await adviceSig(page), adviceBefore, 'advice titles and severity identical');
  const firstRun = calls.dem.length;
  assert.ok(firstRun > 0 && firstRun <= 60, `${firstRun} DEM tiles`);
  await page.screenshot({ path: '/tmp/gp_b2_tg_ridge.png', fullPage: true });

  // Remembered: a reload runs the check automatically after the plan, without a click.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  await waitText(page, /hills likely hide the low sun/);
  assert.equal(await page.$eval('#advice [data-terrain-auto]', (e) => e.checked), true);
  // Unticking forgets the preference.
  await page.click('#advice [data-terrain-auto]');
  assert.equal(await page.evaluate(() => localStorage.getItem('glarepilot.terrainAuto')), null);
  assert.deepEqual(calls.blocked, []);
  assert.deepEqual(errors, []);
  await page.close();
});
