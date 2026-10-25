// E2E: keyless live overlays (NYC DOT speeds, INDOT WZDx) and the experimental provider-key flag.
// Overlay hosts are answered by a fetch shim installed in this file (helpers.mjs is unchanged) using the
// REAL recorded samples in tests/fixtures/overlays/. No real overlay API call is made.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, launch, openPage, text, choosePlace, setDeparture, waitResult } from './helpers.mjs';

const fx = (n) => JSON.parse(readFileSync(new URL(`../fixtures/overlays/${n}`, import.meta.url), 'utf8'));
// The fixed test clock is 2026-10-24 16:12 EDT; make the recorded NYC rows "5-7 min old" relative to it.
const shift = (s) => new Date(Date.parse(`${s}Z`) - (3 * 60 + 50) * 60e3).toISOString().replace('Z', ''); // floating local time
const NYC_ROWS = fx('nycdot-speeds-sample.json').rows.map((r) => ({ ...r, data_as_of: shift(r.data_as_of) }));
const INDOT = fx('indot-wzdx-sample.json');
const OVERLAY_HOSTS = ['data.cityofnewyork.us', 'in.carsprogram.org'];

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

async function openOverlayPage(query = '') {
  const ctx = await openPage(chrome.browser, srv.url, { query });
  await ctx.page.evaluateOnNewDocument((nyc, indot) => {
    const real = window.fetch.bind(window);
    window.__ov = [];
    const json = (b) => Promise.resolve(new Response(b, { status: 200, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = (input, init) => {
      const url = String(input?.url || input);
      if (url.startsWith('https://data.cityofnewyork.us/')) {
        window.__ov.push(url);
        return json(nyc);
      }
      if (url.startsWith('https://in.carsprogram.org/')) {
        window.__ov.push(url);
        return json(indot);
      }
      return real(input, init);
    };
  }, JSON.stringify(NYC_ROWS), JSON.stringify(INDOT));
  await ctx.page.reload({ waitUntil: 'domcontentloaded' });
  await ctx.page.waitForSelector('#presets .preset');
  return ctx;
}
const overlayCalls = (page) => page.evaluate(() => window.__ov);
const noOverlayNetwork = (calls) => assert.deepEqual(calls.blocked.filter((u) => OVERLAY_HOSTS.some((h) => u.includes(h))), []);

test('overlays: synthetic demo and snapshot modes fetch no overlays; provider-key UI hidden by default', async () => {
  const { page, calls, errors } = await openOverlayPage('demo=sunset-glare');
  await waitResult(page);
  assert.equal(await page.$eval('#traffic-cfg', (e) => e.hidden), true, 'provider UI hidden without the experimental flag');
  await page.goto(`${srv.url}?snapshot=amherst-nyc`, { waitUntil: 'domcontentloaded' });
  await waitResult(page);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await overlayCalls(page), []);
  assert.equal(await page.$eval('#overlay-notes', (e) => e.textContent.trim()), '');
  noOverlayNetwork(calls);
  assert.deepEqual(errors, []);
  await page.close();
});

test('overlays: near-now NYC departure -> "as of" speed overlay; Add as delay assumption changes arrival', async () => {
  const { page, calls, errors } = await openOverlayPage();
  await choosePlace(page, 'origin', 'Amherst, MA');
  await choosePlace(page, 'dest', 'New York');
  await setDeparture(page, '2026-10-24T16:30');
  await page.click('#plan');
  await waitResult(page);
  assert.deepEqual(await overlayCalls(page), [], 'nothing fetched until the user asks');
  assert.match(await text(page, '#overlay-notes'), /NYC DOT real-time speeds/);
  await page.click('#ov-run');
  await page.waitForSelector('#ov-speed', { timeout: 15000 });
  const line = await text(page, '#ov-speed');
  assert.match(line, /NYC DOT speeds as of 4:0\d PM .*\(current, not a forecast\)/);
  assert.match(line, /West St S Spring St/);
  assert.equal((await overlayCalls(page)).filter((u) => u.includes('cityofnewyork')).length, 1);
  assert.equal(await page.$eval('#delay-min', (e) => e.value), '0', 'arrival not changed automatically');
  const before = await text(page, '#kpis');
  await page.click('#ov-add-delay');
  await page.waitForFunction(() => document.querySelector('#delay-min').value !== '0');
  assert.equal(await page.$eval('#delay-min', (e) => e.value), '15');
  assert.equal(await page.$eval('#delay-where', (e) => e.value), 'end');
  const afterK = await text(page, '#kpis');
  assert.notEqual(afterK, before);
  assert.match(afterK, /\+15 min assumed delay/);
  assert.match(await text(page, '#delay-card'), /Your assumption/);
  noOverlayNetwork(calls);
  assert.deepEqual(errors, []);
  await page.close();
});

test('overlays: departure tomorrow -> no NYC speed request or overlay', async () => {
  const { page, errors } = await openOverlayPage();
  await choosePlace(page, 'origin', 'Amherst, MA');
  await choosePlace(page, 'dest', 'New York');
  await setDeparture(page, '2026-10-25T09:00');
  await page.click('#plan');
  await waitResult(page);
  // Amherst->NYC never touches Indiana, and tomorrow is outside the 60-min speed horizon: nothing to offer.
  assert.equal(await page.$('#ov-run'), null);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await overlayCalls(page), []);
  assert.equal(await page.$('#ov-speed'), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('overlays: Chicago trip -> INDOT work zones as advice lines and map markers; feed failure is a muted note', async () => {
  const { page, errors } = await openOverlayPage();
  await choosePlace(page, 'origin', 'Amherst, MA');
  await choosePlace(page, 'dest', 'Chicago');
  await setDeparture(page, '2026-10-25T08:00');
  await page.click('#plan');
  await waitResult(page);
  assert.doesNotMatch(await text(page, '#overlay-notes'), /NYC DOT/);
  await page.click('#ov-run');
  await page.waitForSelector('.ov-wz', { timeout: 15000 });
  const lines = await page.$$eval('.ov-wz', (els) => els.map((e) => e.textContent));
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((l) => /Work zone reported by INDOT \(as of feed time 9:28 PM/.test(l)));
  assert.ok(lines.some((l) => /I-80 Toll/.test(l)));
  assert.equal(await page.$$eval('.wz-pin', (e) => e.length), lines.length);
  assert.match(await text(page, '#kpis'), /Arrive 9:24 PM CDT/i, 'work zones never change timing');
  assert.deepEqual((await overlayCalls(page)).map((u) => new URL(u).host), ['in.carsprogram.org']);
  assert.deepEqual(errors, []);
  await page.close();

  // Failure path: the feed returns HTML -> muted note, plan intact.
  const ctx = await openPage(chrome.browser, srv.url);
  await ctx.page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => (String(input?.url || input).startsWith('https://in.carsprogram.org/') ? Promise.resolve(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })) : real(input, init));
  });
  await ctx.page.reload({ waitUntil: 'domcontentloaded' });
  await ctx.page.waitForSelector('#presets .preset');
  await choosePlace(ctx.page, 'origin', 'Amherst, MA');
  await choosePlace(ctx.page, 'dest', 'Chicago');
  await setDeparture(ctx.page, '2026-10-25T08:00');
  await ctx.page.click('#plan');
  await waitResult(ctx.page);
  await ctx.page.click('#ov-run');
  await ctx.page.waitForSelector('.ov-err');
  assert.match(await text(ctx.page, '.ov-err'), /INDOT work-zone feed unavailable \(not JSON\)/);
  assert.match(await text(ctx.page, '#kpis'), /Arrive 9:24 PM CDT/i);
  assert.deepEqual(ctx.errors, []);
  await ctx.page.close();
});
