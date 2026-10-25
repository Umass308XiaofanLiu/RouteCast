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

// Robustness on the WebGL-unavailable path (headless test Chrome): fallback, back to 2D, and
// repeated view toggling must never throw or leave a broken layout.
test('terrain fallback → 2D and repeated 2D↔3D↔terrain toggling (5×) stay error-free', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-mode="demo"]');
  await page.click('[data-scenario="congestion-shift"]');
  await waitResult(page);
  const settle = () =>
    page.waitForFunction(
      () => document.querySelector('#terrain canvas.maplibregl-canvas') || document.querySelector('[data-view="3d"]').getAttribute('aria-pressed') === 'true',
      { timeout: 30000 }
    );
  const snap = () =>
    page.evaluate(() => ({
      pressed: [...document.querySelectorAll('[data-view]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.view),
      map: !document.getElementById('map').hidden,
      chase: !document.getElementById('chase').hidden,
      terrain: !document.getElementById('terrain').hidden,
      canvas: !!document.querySelector('#terrain canvas.maplibregl-canvas'),
      msg: !document.getElementById('terrain-msg').hidden,
      terrainChildren: document.getElementById('terrain').children.length,
    }));

  await page.click('[data-view="terrain"]');
  await settle();
  const first = await snap();
  await page.click('[data-view="2d"]');
  const back = await snap();
  assert.deepEqual(back.pressed, ['2d']);
  assert.equal(back.map, true);
  assert.equal(back.chase, false);
  assert.equal(back.terrain, false);
  if (!first.canvas) assert.equal(back.terrainChildren, 0, 'failed terrain view leaves no partial DOM');

  for (let k = 0; k < 5; k++) {
    await page.click('[data-view="3d"]');
    let s = await snap();
    assert.deepEqual(s.pressed, ['3d']);
    assert.equal(s.chase, true);
    assert.equal(s.map, false);
    await page.click('[data-view="terrain"]');
    await settle();
    s = await snap();
    if (s.canvas) {
      assert.deepEqual(s.pressed, ['terrain']);
      assert.equal(s.terrain, true);
    } else {
      // WebGL unavailable: it falls back to the chase preview with the explanation shown
      assert.deepEqual(s.pressed, ['3d']);
      assert.equal(s.chase, true);
      assert.equal(s.terrain, false);
      assert.equal(s.msg, true);
    }
    await page.click('[data-view="2d"]');
    s = await snap();
    assert.deepEqual(s.pressed, ['2d']);
    assert.equal(s.map, true);
    assert.equal(s.terrain, false);
    assert.equal(s.chase, false);
  }
  // the timeline scrubber still drives the shared position after all the toggling
  await page.$eval('#scrub', (s) => {
    s.value = s.max;
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.$eval('#scrub', (s) => s.value === s.max), true);
  assert.deepEqual(errors, []);
  await page.close();
});
