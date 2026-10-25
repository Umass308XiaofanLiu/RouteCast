// 3D terrain view: in the isolated test browser the DEM/OSM tiles are blocked or blank, so the
// view must either render a MapLibre canvas or fall back cleanly to the Canvas chase preview.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, waitResult } from './helpers.mjs';

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

test('3D terrain view renders a MapLibre canvas or falls back to the 3D chase preview', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-mode="demo"]');
  await page.click('[data-scenario="sunset-glare"]');
  await waitResult(page);
  await page.click('[data-view="terrain"]');
  await page.waitForFunction(
    () => document.querySelector('#terrain canvas.maplibregl-canvas') || document.querySelector('[data-view="3d"]').getAttribute('aria-pressed') === 'true',
    { timeout: 30000 }
  );
  const r = await page.evaluate(() => ({
    canvas: !!document.querySelector('#terrain canvas.maplibregl-canvas'),
    terrainHidden: document.getElementById('terrain').hidden,
    view3d: document.querySelector('[data-view="3d"]').getAttribute('aria-pressed') === 'true',
    chaseHidden: document.getElementById('chase').hidden,
    msg: document.getElementById('terrain-msg').hidden ? '' : document.getElementById('terrain-msg').textContent,
    mapHidden: document.getElementById('map').hidden,
  }));
  if (r.canvas && !r.view3d) {
    assert.equal(r.terrainHidden, false);
    assert.equal(r.mapHidden, true);
    assert.equal(r.chaseHidden, true);
  } else {
    assert.equal(r.view3d, true);
    assert.equal(r.chaseHidden, false);
    assert.equal(r.terrainHidden, true);
    assert.match(r.msg, /3D terrain needs WebGL and online tiles/);
  }
  await page.click('[data-view="2d"]');
  assert.equal(await page.$eval('#map', (e) => e.hidden), false);
  assert.equal(await page.$eval('#terrain', (e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await page.close();
});
