import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startServer, launch, openPage, text, waitResult, SHOTS } from './helpers.mjs';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('manual demo scenarios: one click, synthetic labels, zero API calls', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-mode="demo"]');
  assert.equal(await page.$eval('#trip-form', (e) => e.hidden), true);
  for (const id of ['storm-crosswind', 'sunset-glare', 'snow-fog-night', 'congestion-shift']) {
    await page.click(`[data-scenario="${id}"]`);
    await waitResult(page);
    await page.waitForFunction((x) => document.querySelector(`[data-scenario="${x}"]`).getAttribute('aria-pressed') === 'true', {}, id);
    assert.match(await text(page, '#provenance'), /Manual demo · synthetic data/);
    assert.match(await text(page, '#prov'), /synthetic data.*hand-set/i);
    assert.ok((await page.$$('.cond-icon')).length > 0, `${id} has condition icons`);
  }
  assert.match(await text(page, '#delay-card'), /What the assumed delay changes/);
  assert.match(await text(page, '#delay-card'), /not measured or predicted traffic/);
  assert.match(await text(page, '#cond-legend'), /Assumed traffic delay \(scenario\)/);
  assert.equal(calls.valhalla + calls.osrm + calls.forecast + calls.geocode, 0, 'no API requests in demo mode');
  assert.deepEqual(calls.blocked, []);
  await page.screenshot({ path: join(SHOTS, 'e2e-demo-congestion.png') });
  await page.click('[data-mode="real"]');
  assert.equal(await page.$eval('#trip-form', (e) => e.hidden), false);
  assert.equal(await page.$eval('#result', (e) => e.hidden), true, 'synthetic result is not left on screen in real mode');
  assert.deepEqual(errors, []);
  await page.close();
});

test('2D/3D share one trip state; preview ahead and return to playback position', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await waitResult(page);
  await page.focus('#scrub');
  for (let k = 0; k < 40; k++) await page.keyboard.press('ArrowRight');
  const t2d = await text(page, '.moment-time');
  await page.click('[data-view="3d"]');
  assert.equal(await page.$eval('#chase', (e) => e.hidden), false);
  assert.equal(await page.$eval('#map', (e) => e.hidden), true);
  await sleep(500);
  assert.ok((await text(page, '[data-hud="where"]')).startsWith(t2d), '3D view starts at the selected 2D time');
  assert.match(await text(page, '[data-hud="state"]'), /At playback position/);
  const c = await page.$('#chase canvas');
  const b = await c.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let k = 0; k < 5; k++) await page.mouse.wheel({ deltaY: 240 });
  await sleep(400);
  assert.match(await text(page, '[data-hud="state"]'), /Previewing ahead: \+/);
  assert.match(await text(page, '#moment'), /Preview ahead · current position unchanged/);
  assert.equal(await text(page, '.moment-time') === t2d, false);
  await page.click('[data-act="return"]');
  await sleep(300);
  assert.match(await text(page, '[data-hud="state"]'), /At playback position/);
  assert.equal(await text(page, '.moment-time'), t2d);
  await page.click('[data-act="farther"]');
  assert.equal(await text(page, '[data-hud="level"]'), 'Far');
  await page.click('[data-act="play"]');
  await sleep(1500);
  await page.click('[data-act="play"]');
  const moved = await text(page, '.moment-time');
  assert.notEqual(moved, t2d, 'playback advanced the shared position');
  await page.click('[data-view="2d"]');
  assert.equal(await text(page, '.moment-time'), moved, 'switching back keeps the playback position');
  assert.match(await text(page, '.chase-tag'), /not GPS/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('real mode delay assumption re-times downstream points without refetching', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-preset="chicago-sunset"]');
  await waitResult(page);
  const before = await text(page, '#kpis');
  const fc = calls.forecast;
  await page.select('#delay-min', '60');
  await page.waitForSelector('#delay-card:not([hidden])');
  assert.match(await text(page, '#kpis'), /Drive \+ delay 15h 24m/i);
  assert.match(await text(page, '#kpis'), /10:24 PM CDT/);
  assert.match(await text(page, '#delay-card'), /forecast checkpoints move to a different forecast hour/);
  assert.match(await text(page, '#prov'), /assumed 1 h delay/);
  assert.equal(calls.forecast, fc, 'no extra forecast request');
  assert.notEqual(await text(page, '#kpis'), before);
  assert.deepEqual(errors, []);
  await page.close();
});

test('reduced motion: icon animations off by default and toggle labelled', async () => {
  const page = await chrome.browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${srv.url}?demo=storm-crosswind`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#result:not([hidden])');
  await page.waitForSelector('.cond-icon');
  const anim = await page.$eval('.cond-badge .a-drop, .cond-badge .a-gust', (e) => getComputedStyle(e).animationName);
  assert.equal(anim, 'none');
  assert.match(await text(page, '#motion'), /off/);
  await page.close();
  const { page: p2 } = await openPage(chrome.browser, srv.url, { query: 'demo=storm-crosswind' });
  await waitResult(p2);
  await p2.waitForSelector('.cond-icon');
  assert.notEqual(await p2.$eval('.cond-badge .a-drop, .cond-badge .a-gust', (e) => getComputedStyle(e).animationName), 'none');
  await p2.click('#motion');
  assert.equal(await p2.$eval('.cond-badge .a-drop, .cond-badge .a-gust', (e) => getComputedStyle(e).animationName), 'none');
  await p2.close();
});
