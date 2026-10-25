// Terrain check (approximate): in the isolated test browser unknown hosts (incl. AWS Terrain Tiles)
// are aborted, so the honest outcome is "Terrain check unavailable" — and nothing else may change.
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

test('sunset demo: terrain check is on demand, reports unavailable when DEM tiles fail, KPIs unchanged', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await waitResult(page);
  const kpisBefore = await text(page, '#kpis');
  const adviceTitlesBefore = await page.$$eval('#advice .rec h3', (hs) => hs.map((h) => h.textContent));
  const lines = await page.$$('#advice .rec-terrain');
  assert.ok(lines.length >= 1, 'glare card has a terrain line');
  assert.match(await text(page, '#advice .rec-terrain'), /Check terrain \(approximate\)/);
  assert.match(await page.$eval('#advice .rec-terrain', (e) => e.title), /Bare-earth elevation \(AWS Terrain Tiles, ~30 m\); buildings, trees and road cuts are not modeled/);
  assert.deepEqual(calls.blocked, [], 'no elevation request before the user asks');

  await page.click('#advice [data-terrain-run]');
  await page.waitForFunction(() => /Terrain check unavailable \(elevation tiles did not load\)/.test(document.querySelector('#advice .rec-terrain')?.textContent || ''), { timeout: 30000 });
  assert.ok(calls.blocked.length > 0 && calls.blocked.every((u) => u.includes('elevation-tiles-prod/terrarium/12/')), 'only DEM tiles were requested');
  assert.equal(await text(page, '#kpis'), kpisBefore, 'KPIs identical');
  assert.deepEqual(await page.$$eval('#advice .rec h3', (hs) => hs.map((h) => h.textContent)), adviceTitlesBefore);
  assert.doesNotMatch(await text(page, '#advice'), /hills likely hide|open horizon/);
  assert.deepEqual(errors, []);
  await page.close();
});
