// Optional "follow my location": off by default, explicit click, snaps to the planned route.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, text, waitResult } from './helpers.mjs';

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

const FOLLOW = /Following your location \(GPS\) — conditions are still the PLANNED forecast/;
const scrubValue = (page) => page.$eval('#scrub', (e) => e.value);

async function openDemo(grant) {
  const ctx = chrome.browser.defaultBrowserContext();
  await ctx.clearPermissionOverrides();
  await ctx.overridePermissions(new URL(srv.url).origin, grant ? ['geolocation'] : []);
  const o = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await waitResult(o.page);
  return o;
}

test('GPS is off by default and does not touch geolocation until clicked', async () => {
  const { page, errors } = await openDemo(false);
  assert.equal(await text(page, '#gps-start'), 'Use my location (optional)');
  assert.equal(await page.$eval('#gps-stop', (e) => e.hidden), true);
  assert.equal(await text(page, '#gps-status'), '');
  assert.match(await text(page, '.gps-note'), /never stored, logged or sent/);
  assert.equal(await page.$eval('[data-hud="gps"]', (e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a fix near the route snaps playback to the nearest sample and labels it', async () => {
  const { page, errors, calls } = await openDemo(true);
  const before = await scrubValue(page);
  assert.notEqual(before, '0', 'demo starts away from the first sample');
  await page.setGeolocation({ latitude: 42.3735, longitude: -72.5195, accuracy: 30 }); // ~40 m from Amherst start
  await page.click('#gps-start');
  await page.waitForFunction(() => /Following your location/.test(document.getElementById('gps-status').textContent));
  assert.match(await text(page, '#gps-status'), FOLLOW);
  assert.equal(await scrubValue(page), '0');
  assert.match(await text(page, '.moment-where'), /Amherst/);
  await page.click('[data-view="3d"]');
  assert.match(await text(page, '[data-hud="gps"]'), FOLLOW);
  assert.match(await text(page, '[data-hud="where"]'), /0 min into the trip|into the trip/);
  await page.click('#gps-stop');
  assert.equal(await text(page, '#gps-status'), '');
  assert.equal(await page.$eval('[data-hud="gps"]', (e) => e.hidden), true);
  assert.match(await text(page, '.chase-tag'), /not GPS/);
  assert.equal(calls.valhalla + calls.osrm + calls.forecast + calls.geocode, 0, 'no API calls carry coordinates');
  assert.deepEqual(calls.blocked, []);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a far fix (Denver) reports off-route and leaves the position unchanged', async () => {
  const { page, errors } = await openDemo(true);
  const before = await scrubValue(page);
  const where = await text(page, '.moment-where');
  await page.setGeolocation({ latitude: 39.7392, longitude: -104.9903 });
  await page.click('#gps-start');
  await page.waitForFunction(() => /off this planned route/.test(document.getElementById('gps-status').textContent));
  assert.match(await text(page, '#gps-status'), /You are off this planned route \(\d+ mi away\)/);
  assert.equal(await scrubValue(page), before);
  assert.equal(await text(page, '.moment-where'), where);
  assert.equal(await page.$eval('[data-hud="gps"]', (e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('denied permission shows a calm message and playback still works', async () => {
  const { page, errors } = await openDemo(false);
  const before = await scrubValue(page);
  await page.click('#gps-start');
  await page.waitForFunction(() => /permission denied/.test(document.getElementById('gps-status').textContent), { timeout: 20000 });
  assert.equal(await text(page, '#gps-status'), 'Location permission denied — the planned-route playback still works');
  assert.equal(await scrubValue(page), before);
  assert.equal(await page.$eval('#gps-start', (e) => e.hidden), false);
  await page.focus('#scrub');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await scrubValue(page), before, 'manual playback still moves');
  assert.deepEqual(errors, []);
  await page.close();
});

test('accuracy is shown; an imprecise fix is not snapped to the route', async () => {
  const { page, errors } = await openDemo(true);
  const before = await scrubValue(page);
  await page.setGeolocation({ latitude: 42.3735, longitude: -72.5195, accuracy: 5000 });
  await page.click('#gps-start');
  await page.waitForFunction(() => /too imprecise/.test(document.getElementById('gps-status').textContent));
  assert.match(await text(page, '#gps-status'), /accuracy ±3\.1 mi/);
  assert.equal(await scrubValue(page), before, 'position unchanged');
  await page.setGeolocation({ latitude: 42.3735, longitude: -72.5195, accuracy: 25 });
  await page.waitForFunction(() => /Following your location/.test(document.getElementById('gps-status').textContent), { timeout: 20000 });
  assert.match(await text(page, '#gps-status'), /accuracy ±\d+ ft/);
  assert.equal(await scrubValue(page), '0');
  assert.deepEqual(errors, []);
  await page.close();
});

test('exploring the plan pauses GPS following; Return to my location resumes it', async () => {
  const { page, errors } = await openDemo(true);
  await page.setGeolocation({ latitude: 42.3735, longitude: -72.5195, accuracy: 30 });
  await page.click('#gps-start');
  await page.waitForFunction(() => /Following your location/.test(document.getElementById('gps-status').textContent));
  await page.focus('#scrub');
  for (let k = 0; k < 25; k++) await page.keyboard.press('ArrowRight');
  assert.notEqual(await scrubValue(page), '0');
  assert.match(await text(page, '#gps-status'), /paused while you explore the plan/);
  assert.equal(await page.$eval('#gps-return', (e) => e.hidden), false);
  assert.equal(await page.$eval('[data-hud="gps"]', (e) => e.hidden), true);
  await page.$eval('#gps-return', (e) => e.scrollIntoView({ block: 'center' }));
  await page.click('#gps-return');
  assert.equal(await scrubValue(page), '0', 'back at the GPS-matched sample');
  assert.match(await text(page, '#gps-status'), FOLLOW);
  assert.equal(await page.$eval('#gps-return', (e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await page.close();
});
