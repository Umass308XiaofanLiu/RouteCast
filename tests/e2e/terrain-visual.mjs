// Manual visual check of the MapLibre "3D terrain" view (NOT part of `npm run test:e2e`).
// Headless Chrome WebGL is unreliable here, so this drives a real (headed) Chrome with SwiftShader
// under Xvfb and LIVE terrain/building tiles (AWS Terrain Tiles, OpenFreeMap, OSM). Only ?demo=
// scenarios are used, so no routing/forecast APIs are called.
//
//   npm run build
//   npx vite preview --host 127.0.0.1 --port 4193 --strictPort &
//   xvfb-run -a -s "-screen 0 1600x1000x24" node tests/e2e/terrain-visual.mjs [outDir]
//
// Env: BASE_URL (default http://127.0.0.1:4193/), CHROME_PATH (default /opt/google/chrome/chrome).
// Writes terrain-integration-*.png into outDir (default /tmp/gp_terrain_visual) and prints a
// JSON summary (page errors, console warnings, HUD overlap checks) per shot. Inspect the PNGs.
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
  { name: 'nyc-close-mobile', demo: 'congestion-shift', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, end: true, close: true },
];

/** Pairs of visible HUD boxes inside #terrain that intersect (should be none). */
function hudOverlaps() {
  const root = document.getElementById('terrain');
  const sel = ['.chase-tag', '.chase-where', '.terrain-note', '.terrain-ahead', '.chase-controls > *', '.maplibregl-ctrl-attrib'];
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
  for (const shot of SHOTS) {
    const page = await browser.newPage();
    const errors = [];
    const warnings = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && warnings.push(m.text().slice(0, 160)));
    await page.setViewport(shot.vp);
    await page.goto(`${BASE}?demo=${shot.demo}&view=terrain`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#terrain canvas.maplibregl-canvas') || !document.getElementById('terrain-msg').hidden, { timeout: 60000 });
    const canvas = await page.$('#terrain canvas.maplibregl-canvas');
    if (canvas && shot.end) {
      await page.$eval('#scrub', (s) => {
        s.value = s.max;
        s.dispatchEvent(new Event('input', { bubbles: true }));
      });
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
    summary.push({ shot: shot.name, file, webglCanvas: !!canvas, level, where, gps, ...info, contextLoss, errors, warnings: warnings.length, warningSample: warnings.slice(0, 3) });
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.some((s) => s.errors.length) ? 1 : 0;
