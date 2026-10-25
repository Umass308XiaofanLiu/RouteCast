// View parity: 2D / 3D chase / 3D terrain share one trip/time state (selection, playback position,
// preview and camera level), use the same controls/shortcuts, and transitions are instant with
// reduced motion. Headless test Chrome has no WebGL, so the terrain view takes its fallback path
// (→ 3D chase) here; the real MapLibre camera is checked by tests/e2e/terrain-visual.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, waitResult, text } from './helpers.mjs';

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
const scrub = (page) => page.$eval('#scrub', (e) => Number(e.value));
const hud = (page) => text(page, '#chase [data-hud="state"]');
const pinShown = (page) => page.evaluate(() => !!document.querySelector('#map .preview-pin'));

async function open(page) {
  await waitResult(page);
  await page.focus('#scrub');
  for (let k = 0; k < 30; k++) await page.keyboard.press('ArrowRight');
}

test('switching 2D ↔ chase ↔ terrain(fallback) in any order keeps selection, preview and level', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await open(page);
  const sel = await scrub(page);
  const t2d = await text(page, '.moment-time');
  assert.ok(sel > 0);

  await page.click('[data-view="3d"]');
  await sleep(300);
  assert.ok((await text(page, '#chase [data-hud="where"]')).startsWith(t2d));
  // camera level + preview ahead in the chase view
  await page.click('#chase [data-act="farther"]');
  assert.equal(await text(page, '#chase [data-hud="level"]'), 'Far');
  await page.click('#chase [data-act="fwd"]');
  await sleep(300);
  const pv = await hud(page);
  assert.match(pv, /^Previewing ahead: \+/);

  // → 2D: playback position unchanged, preview pin + label kept
  await page.click('[data-view="2d"]');
  await sleep(200);
  assert.equal(await scrub(page), sel, 'playback position survives');
  assert.equal(await pinShown(page), true, '2D map shows the preview pin for a 3D preview');
  assert.equal(await page.$eval('#view-preview', (e) => e.hidden), false);
  assert.match(await text(page, '#view-preview [data-hud="state"]'), /^Previewing ahead: \+/);
  assert.match(await text(page, '#moment'), /Preview ahead/);

  // → terrain (falls back to chase without WebGL) → still same position, preview and level
  await page.click('[data-view="terrain"]');
  await page.waitForFunction(() => document.querySelector('#terrain canvas.maplibregl-canvas') || document.querySelector('[data-view="3d"]').getAttribute('aria-pressed') === 'true', { timeout: 30000 });
  const fellBack = await page.$eval('[data-view="3d"]', (e) => e.getAttribute('aria-pressed') === 'true');
  if (fellBack) {
    await sleep(300);
    assert.equal(await page.$eval('#chase', (e) => e.hidden), false);
    assert.match(await text(page, '#terrain-msg'), /3D terrain needs WebGL/);
    assert.equal(await text(page, '#chase [data-hud="level"]'), 'Far', 'level survives');
    assert.equal(await hud(page), pv, 'preview survives');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#chase canvas')), true, 'focus moves to the 3D view');
  }
  // return to playback position from the chase view clears the preview everywhere
  await page.click('#chase [data-act="return"]');
  await sleep(250);
  assert.match(await hud(page), /At playback position/);
  assert.equal(await page.$eval('#chase [data-act="return"]', (e) => e.disabled), true);
  await page.click('[data-view="2d"]');
  await sleep(200);
  assert.equal(await pinShown(page), false);
  assert.equal(await page.$eval('#view-preview', (e) => e.hidden), true);
  assert.equal(await scrub(page), sel);
  assert.equal(await text(page, '.moment-time'), t2d);
  // level still Far on re-entry
  await page.click('[data-view="3d"]');
  await sleep(200);
  assert.equal(await text(page, '#chase [data-hud="level"]'), 'Far');
  assert.deepEqual(errors, []);
  await page.close();
});

test('2D "Return to playback position" clears a 3D preview; selecting a new 2D time ends a preview', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await open(page);
  const sel = await scrub(page);
  await page.click('[data-view="3d"]');
  await sleep(200);
  await page.click('#chase [data-act="back"]');
  await sleep(250);
  assert.match(await hud(page), /^Previewing behind: −/);
  await page.click('[data-view="2d"]');
  await sleep(200);
  assert.match(await text(page, '#view-preview [data-hud="state"]'), /^Previewing behind: −/);
  await page.click('#view-preview [data-act="return"]');
  await sleep(150);
  assert.equal(await page.$eval('#view-preview', (e) => e.hidden), true);
  assert.equal(await pinShown(page), false);
  await page.click('[data-view="3d"]');
  await sleep(250);
  assert.match(await hud(page), /At playback position/);
  // preview, then move the playback position in 2D: the preview ends in every view
  await page.click('#chase [data-act="fwd"]');
  await sleep(200);
  await page.click('[data-view="2d"]');
  await page.focus('#scrub');
  await page.keyboard.press('ArrowRight');
  assert.equal(await scrub(page), sel + 1);
  assert.equal(await page.$eval('#view-preview', (e) => e.hidden), true);
  await page.click('[data-view="3d"]');
  await sleep(250);
  assert.match(await hud(page), /At playback position/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('chase keyboard controls: arrows preview, Home returns, +/− change level, Space plays; HUD is announced politely', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await open(page);
  const sel = await scrub(page);
  await page.click('[data-view="3d"]');
  await sleep(200);
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#chase canvas')), true);
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  assert.match(await hud(page), /^Previewing ahead: \+/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await sleep(200);
  assert.match(await hud(page), /^Previewing behind: −/);
  await page.keyboard.press('Home');
  await sleep(200);
  assert.match(await hud(page), /At playback position/);
  assert.equal(await text(page, '#chase [data-hud="level"]'), 'Near');
  await page.keyboard.press('+');
  assert.equal(await text(page, '#chase [data-hud="level"]'), 'Close');
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  assert.equal(await text(page, '#chase [data-hud="level"]'), 'Far');
  // button semantics match the keys: "+" = nearer, "−" = farther
  assert.equal(await page.$eval('#chase [data-act="nearer"]', (e) => e.textContent), '+');
  assert.equal(await page.$eval('#chase [data-act="farther"]', (e) => e.textContent), '−');
  // labelled controls
  const unlabelled = await page.$$eval('#chase button', (bs) => bs.filter((b) => !(b.getAttribute('aria-label') || b.textContent.trim())).length);
  assert.equal(unlabelled, 0);
  await page.keyboard.press('Space');
  await sleep(1200);
  assert.equal(await page.$eval('#chase [data-act="play"]', (e) => e.getAttribute('aria-pressed')), 'true');
  await page.keyboard.press('Space');
  await sleep(200);
  assert.equal(await page.$eval('#chase [data-act="play"]', (e) => e.getAttribute('aria-pressed')), 'false');
  assert.ok((await scrub(page)) > sel, 'playback advanced the shared position');
  // throttled polite live region carries the HUD state (state line itself is not live)
  const live = await page.$eval('#view-live', (e) => ({ live: e.getAttribute('aria-live'), text: e.textContent }));
  assert.equal(live.live, 'polite');
  await sleep(1600);
  assert.match(await page.$eval('#view-live', (e) => e.textContent), /playback|Previewing/);
  assert.equal(await page.$eval('#chase [data-hud="state"]', (e) => e.getAttribute('aria-live')), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('reduced motion / Animation off: view switches have no cross-fade', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'demo=sunset-glare' });
  await waitResult(page);
  await page.click('[data-view="3d"]');
  assert.equal(await page.$eval('#chase', (e) => e.classList.contains('view-enter')), true, 'cross-fade with motion on');
  await page.click('[data-view="2d"]');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.click('[data-view="3d"]');
  assert.equal(await page.$eval('#chase', (e) => e.classList.contains('view-enter')), false);
  await page.click('[data-view="2d"]');
  assert.equal(await page.$eval('#map', (e) => e.classList.contains('view-enter')), false);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.click('#motion'); // Animation: off
  await page.click('[data-view="3d"]');
  assert.equal(await page.$eval('#chase', (e) => e.classList.contains('view-enter')), false);
  assert.deepEqual(errors, []);
  await page.close();
});
