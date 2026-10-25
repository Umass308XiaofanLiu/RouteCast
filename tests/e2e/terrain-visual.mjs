// Manual visual check of the MapLibre "3D terrain" view (NOT part of `npm run test:e2e`).
// Headless Chrome WebGL is unreliable here, so this drives a real (headed) Chrome with SwiftShader
// under Xvfb and LIVE terrain/building tiles (AWS Terrain Tiles, OpenFreeMap, OSM). Only ?demo=
// scenarios are used, so no routing/forecast APIs are called.
//
//   npm run build
//   npx vite preview --host 127.0.0.1 --port 4193 --strictPort &
//   xvfb-run -a -s "-screen 0 1600x1000x24" node tests/e2e/terrain-visual.mjs [outDir]
//
// Env: BASE_URL (default http://127.0.0.1:4193/), CHROME_PATH (default /opt/google/chrome/chrome),
// ONLY (regex on shot names, e.g. ONLY=^fx- for the weather/light/wind overlay shots).
// Writes terrain-integration-*.png into outDir (default /tmp/gp_terrain_visual) and prints a
// JSON summary (page errors, console warnings, HUD overlap checks) per shot. Inspect the PNGs.
// ONLY=^views runs the view/camera parity check (2D → terrain fly-in, wheel preview, return,
// level buttons, reduced motion) and writes views-*.png; it uses ?demo=sunset-glare&qa.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4193/';
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const OUT = process.argv[2] || '/tmp/gp_terrain_visual';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { name: 'sunset-glare-desktop', demo: 'sunset-glare', vp: { width: 1440, height: 1000 } },
  { name: 'sunset-glare-mobile', demo: 'sunset-glare', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: 'nyc-close-desktop', demo: 'congestion-shift', vp: { width: 1440, height: 1000 }, end: true, close: true, loseContext: true },
  // weather / light / wind overlay (src/ui/terrainfx.js); `scrub` = fraction of the trip
  { name: 'fx-storm-desktop', demo: 'storm-crosswind', vp: { width: 1440, height: 1000 }, scrub: 0.45 },
  { name: 'fx-storm-mobile', demo: 'storm-crosswind', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, scrub: 0.45 },
  { name: 'fx-snow-night-desktop', demo: 'snow-fog-night', vp: { width: 1440, height: 1000 }, scrub: 0.3 },
  { name: 'fx-fog-night-mobile', demo: 'snow-fog-night', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, scrub: 0.72 },
  { name: 'fx-sunset-close-desktop', demo: 'sunset-glare', vp: { width: 1440, height: 1000 }, close: true, toGlare: true },
  { name: 'fx-sunset-mobile', demo: 'sunset-glare', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, toGlare: true },
  { name: 'fx-storm-reduced', demo: 'storm-crosswind', vp: { width: 1440, height: 1000 }, scrub: 0.45, reduced: true },
  { name: 'nyc-close-mobile', demo: 'congestion-shift', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, end: true, close: true },
];

/** Pairs of visible HUD boxes inside #terrain that intersect (should be none). */
function hudOverlaps() {
  const root = document.getElementById('terrain');
  const sel = ['.chase-tag', '.chase-where', '.terrain-state', '.terrain-note', '.terrain-ahead', '.chase-controls > *', '.maplibregl-ctrl-attrib'];
  const boxes = [];
  for (const s of sel) {
    for (const el of root.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && getComputedStyle(el).visibility !== 'hidden') boxes.push({ s, r });
    }
  }
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 1 && iy > 1) out.push(`${boxes[i].s} × ${boxes[j].s} (${Math.round(ix)}×${Math.round(iy)}px)`);
    }
  }
  const tr = root.getBoundingClientRect();
  const outside = boxes.filter(({ r }) => r.left < tr.left - 1 || r.right > tr.right + 1 || r.top < tr.top - 1 || r.bottom > tr.bottom + 1).map(({ s }) => s);
  return { overlaps: out, outside };
}

const profile = mkdtempSync(join(tmpdir(), 'gp-terrain-visual-'));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: profile,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,1000'],
});
const summary = [];
try {
  for (const shot of SHOTS.filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s.name))) {
    const page = await browser.newPage();
    const errors = [];
    const warnings = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && warnings.push(m.text().slice(0, 160)));
    await page.setViewport(shot.vp);
    if (shot.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${BASE}?demo=${shot.demo}&view=terrain`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#terrain canvas.maplibregl-canvas') || !document.getElementById('terrain-msg').hidden, { timeout: 60000 });
    const canvas = await page.$('#terrain canvas.maplibregl-canvas');
    if (canvas && shot.end) {
      await page.$eval('#scrub', (s) => {
        s.value = s.max;
        s.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    if (canvas && shot.scrub != null) {
      await page.$eval('#scrub', (s, f) => {
        s.value = String(Math.round(Number(s.max) * f));
        s.dispatchEvent(new Event('input', { bubbles: true }));
      }, shot.scrub);
    }
    if (canvas && shot.toGlare) {
      // scrub to the first sample whose expected glare is ≥ 2 (read from the overlay's dataset)
      await sleep(1500);
      const max = await page.$eval('#scrub', (s) => Number(s.max));
      for (let k = 0; k <= 60; k++) {
        const g = await page.$eval('#scrub', (s, v) => {
          s.value = String(v);
          s.dispatchEvent(new Event('input', { bubbles: true }));
          return Number(document.querySelector('#terrain canvas.terrain-fx')?.dataset.glare);
        }, Math.round((max * k) / 60));
        await sleep(120);
        if (g >= 2) break;
      }
    }
    if (canvas && shot.close) {
      for (let k = 0; k < 4; k++) {
        await page.click('#terrain [data-act="nearer"]');
        await sleep(150);
      }
    }
    await sleep(9000); // tiles + terrain settle (SwiftShader is slow)
    await page.$eval('#terrain', (e) => e.scrollIntoView({ block: 'center' }));
    await sleep(800);
    const info = await page.evaluate(hudOverlaps);
    const level = await page.$eval('#terrain [data-hud="level"]', (e) => e.textContent).catch(() => null);
    const where = await page.$eval('#terrain [data-hud="where"]', (e) => e.textContent).catch(() => null);
    const gps = await page.$eval('#gps-bar', (e) => ({ visible: !!e.offsetParent, text: e.innerText.replace(/\s+/g, ' ').trim() })).catch(() => null);
    // overlay state: what the effects canvas drew for the represented row, and whether it animates
    const fx = await page.evaluate(async () => {
      const c = document.querySelector('#terrain canvas.terrain-fx');
      if (!c) return null;
      const d1 = c.toDataURL();
      await new Promise((r) => setTimeout(r, 400));
      return { ...c.dataset, hidden: c.hidden, pointerEvents: getComputedStyle(c).pointerEvents, frameChanged: c.toDataURL() !== d1 };
    });
    const file = join(OUT, `terrain-integration-${shot.name}.png`);
    const el = await page.$('#terrain:not([hidden])') || await page.$('#chase');
    await page.screenshot({ path: file, fullPage: false });
    if (el) await el.screenshot({ path: file.replace('.png', '-view.png') });
    let contextLoss = null;
    if (canvas && shot.loseContext) {
      // simulate a GPU reset: the view must show its own explanation and must not throw
      contextLoss = await page.evaluate(async () => {
        const gl = document.querySelector('#terrain canvas.maplibregl-canvas').getContext('webgl2') || document.querySelector('#terrain canvas.maplibregl-canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_lose_context');
        if (!ext) return { supported: false };
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 500));
        const lost = document.querySelector('#terrain [data-hud="lost"]');
        const shown = !!lost && !lost.hidden;
        document.querySelector('#terrain [data-act="play"]').click(); // must be a no-op, not a throw
        ext.restoreContext();
        await new Promise((r) => setTimeout(r, 1500));
        return { supported: true, messageShownWhileLost: shown, hiddenAfterRestore: !!lost && lost.hidden };
      });
    }
    summary.push({ shot: shot.name, file, webglCanvas: !!canvas, fx, level, where, gps, ...info, contextLoss, errors, warnings: warnings.length, warningSample: warnings.slice(0, 3) });
    await page.close();
  }
  // ---- view/camera parity (ONLY=^views): 2D → terrain fly-in, wheel preview, return, levels ----
  if (!process.env.ONLY || new RegExp(process.env.ONLY).test('views')) {
    for (const reduced of [false, true]) summary.push(await viewsCheck(reduced));
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(JSON.stringify(summary, null, 2));
const failed = summary.filter((s) => s.errors.length || (s.checks && Object.values(s.checks).some((v) => v === false)));
process.exitCode = failed.length ? 1 : 0;

async function viewsCheck(reduced) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE}?demo=sunset-glare&qa`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
  await page.$eval('#scrub', (s) => {
    s.value = String(Math.round(Number(s.max) * 0.3));
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1500);
  const sel = await page.$eval('#scrub', (s) => Number(s.value));
  const cam = () => page.evaluate(() => window.__gpTerrain?.state ?? null);
  const hudText = () => page.$eval('#terrain [data-hud="state"]', (e) => e.textContent).catch(() => null);
  const dist = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111.2; // km
  const checks = {};
  const out = {};
  await page.$eval('#map', (e) => e.scrollIntoView({ block: 'center' }));
  await page.click('[data-view="terrain"]');
  // camera samples during the fly-in (first time: wait for the lazily created view)
  await page.waitForFunction(() => window.__gpTerrain?.state?.visible, { timeout: 60000 });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    const s = await cam();
    samples.push({ t: Date.now() - t0, flying: s.flying, ...s.camera });
    await sleep(250);
  }
  out.flySamples = samples.map((s) => ({ t: s.t, flying: s.flying, zoom: +s.zoom.toFixed(2), pitch: +s.pitch.toFixed(1) }));
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (reduced) checks.instantNoFly = samples.every((s) => !s.flying) && Math.abs(first.zoom - last.zoom) < 0.05 && Math.abs(first.pitch - last.pitch) < 0.5;
  else checks.flyAnimates = samples.some((s) => s.flying) && last.pitch - first.pitch > 10 && last.zoom - first.zoom > 1 && !last.flying;
  checks.positionKept = (await cam()).cur === sel;
  await sleep(6000); // tiles settle
  await page.$eval('#terrain', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(500);
  const before = (await cam()).camera;
  out.hudBefore = await hudText();
  // wheel over the map previews ahead (no map zoom)
  const box = await (await page.$('#terrain .terrain-map')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < 5; k++) {
    await page.mouse.wheel({ deltaY: 240 });
    await sleep(80);
  }
  await sleep(2500);
  const ahead = await cam();
  out.hudAhead = await hudText();
  checks.wheelPreviews = /^Previewing ahead: \+/.test(out.hudAhead) && ahead.preview > 0 && ahead.cur === sel;
  checks.wheelMovesCenter = dist(before, ahead.camera) > 1;
  checks.wheelNotZoom = Math.abs(ahead.camera.zoom - before.zoom) < 0.05;
  out.centerMoveKm = +dist(before, ahead.camera).toFixed(2);
  if (!reduced) {
    await sleep(4000);
    await page.screenshot({ path: join(OUT, 'views-terrain-preview.png') });
  }
  // 2D shows the preview pin + label for the terrain preview
  await page.click('[data-view="2d"]');
  await sleep(1200);
  checks.pin2d = await page.evaluate(() => !!document.querySelector('#map .preview-pin') && !document.getElementById('view-preview').hidden);
  out.label2d = await page.$eval('#view-preview', (e) => e.textContent.trim());
  if (!reduced) await page.screenshot({ path: join(OUT, 'views-2d-preview.png') });
  await page.click('[data-view="terrain"]');
  await sleep(reduced ? 800 : 3000);
  await page.waitForFunction(() => !window.__gpTerrain.state.flying, { timeout: 15000 });
  checks.previewSurvives = (await cam()).preview === ahead.preview;
  await page.click('#terrain [data-act="return"]');
  await sleep(2000);
  await page.waitForFunction(() => !window.__gpTerrain.map.isMoving(), { timeout: 15000 });
  const back = await cam();
  out.hudReturn = await hudText();
  out.returnKm = +dist(before, back.camera).toFixed(3);
  out.returnState = { preview: back.preview, cur: back.cur, flying: back.flying };
  checks.returnWorks = /At playback position/.test(out.hudReturn) && back.preview === 0 && dist(before, back.camera) < 0.3;
  // level buttons and Ctrl+wheel change the camera distance (pitch/zoom)
  await page.click('#terrain [data-act="nearer"]');
  await sleep(1500);
  const near = await cam();
  await page.click('#terrain [data-act="farther"]');
  await page.click('#terrain [data-act="farther"]');
  await sleep(1500);
  const far = await cam();
  out.levels = [back, near, far].map((s) => ({ level: s.level, zoom: +s.camera.zoom.toFixed(2), pitch: +s.camera.pitch.toFixed(1) }));
  checks.levelButtons = near.level === 0 && far.level === 2 && near.camera.zoom > back.camera.zoom && far.camera.zoom < back.camera.zoom && near.camera.pitch !== far.camera.pitch;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel({ deltaY: -120 });
  await page.keyboard.up('Control');
  await sleep(1200);
  checks.ctrlWheelLevel = (await cam()).level === 1 && (await cam()).preview === 0;
  if (!reduced) {
    await sleep(3000);
    await page.screenshot({ path: join(OUT, 'views-terrain-level.png') });
  }
  // level survives into the chase view
  await page.click('[data-view="3d"]');
  await sleep(500);
  checks.levelShared = (await page.$eval('#chase [data-hud="level"]', (e) => e.textContent)) === 'Near';
  await page.close();
  return { shot: `views${reduced ? '-reduced' : ''}`, checks, ...out, errors };
}
