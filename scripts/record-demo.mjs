// record-demo.mjs — records the GlarePilot demo video (MP4 + SRT + poster) with headless Chrome.
//
// Usage: node scripts/record-demo.mjs [baseUrl]
//   baseUrl defaults to the live GitHub Pages deployment.
//
// How it works
// - Launches system Chrome headless with a fresh temporary profile (deleted at the end).
// - Drives the real app (live data first; if a live request fails, falls back to the
//   app's own `?snapshot=<id>` recorded snapshot and says so in the caption).
// - Captures frames with the DevTools Page.startScreencast API into a temp dir, keeping
//   each frame's arrival time, then rebuilds a constant 30 fps H.264 video with ffmpeg.
// - Captions are burned into a dedicated bar BELOW the page (the page viewport is
//   1440x810, the video is 1440x900) so they never cover app UI. A matching SRT is written.
// - A small synthetic pointer is overlaid by this script (pointer-events: none) so viewers
//   can see where clicks happen. The app's code and data are not modified.
//
// Outputs (docs/media/): glarepilot-demo.mp4, glarepilot-demo.en.srt,
// glarepilot-demo-poster.png, recording-log.json
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'https://umass308xiaofanliu.github.io/glarepilot/';
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const OUT = resolve('docs/media');
const VW = 1440; // video width
const VH = 900; // video height
const PH = 810; // page viewport height (desktop); the remaining 90 px is the caption bar
const BAR_COLOR = '0x0f1b33';
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

mkdirSync(OUT, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'gp-video-'));
const profile = mkdtempSync(join(tmpdir(), 'gp-video-profile-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now() / 1000;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- recorder
const segments = []; // { dir, frames: [{file,t}], start, end, offset }
const captions = []; // { start, end, lines: [] } in global video seconds
const report = { capturedAt: new Date().toISOString(), baseUrl: BASE, scenes: [] };
let seg = null;
let session = null;
let frameNo = 0;
let posterAt = null;

function globalNow() {
  return seg.offset + (now() - seg.start);
}

async function startSegment(page, name, { maxWidth, maxHeight }) {
  const offset = segments.reduce((s, x) => s + (x.end - x.start), 0);
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  seg = { name, dir, frames: [], start: now(), end: null, offset };
  segments.push(seg);
  session = await page.createCDPSession();
  const mine = seg;
  session.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const t = now();
    const file = join(mine.dir, `${String(++frameNo).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    mine.frames.push({ file, t });
    try {
      await session.send('Page.screencastFrameAck', { sessionId });
    } catch {}
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth, maxHeight, everyNthFrame: 1 });
  // Nudge a repaint so the segment starts with a frame.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await sleep(300);
}

async function endSegment() {
  closeCaption();
  await session.send('Page.stopScreencast');
  await session.detach().catch(() => {});
  seg.end = now();
  log(`segment ${seg.name}: ${seg.frames.length} frames, ${(seg.end - seg.start).toFixed(1)} s`);
}

function closeCaption() {
  const c = captions[captions.length - 1];
  if (c && c.end == null) c.end = globalNow();
}
// Split a caption line that would not fit the 1440 px bar into two balanced lines.
function wrap(line, max = 78) {
  if (line.length <= max) return [line];
  const mid = line.length / 2;
  let cut = -1;
  for (let i = 0; i < line.length; i++) if (line[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
  return cut < 0 ? [line] : [line.slice(0, cut), line.slice(cut + 1)];
}
function caption(...input) {
  closeCaption();
  const lines = input.length > 1 ? input : wrap(input[0]); // explicit multi-line captions are pre-split
  captions.push({ start: globalNow(), end: null, lines });
  log('caption:', lines.join(' / '));
}

// ---------------------------------------------------------------- page helpers
const POINTER = () => {
  const install = () => {
    if (document.getElementById('__demo_pointer')) return;
    const d = document.createElement('div');
    d.id = '__demo_pointer';
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(255,209,102,.55);border:2px solid #ff7a45;box-shadow:0 0 0 3px rgba(255,255,255,.7);' +
      'pointer-events:none;z-index:2147483647;transition:transform .15s ease;';
    document.documentElement.appendChild(d);
    addEventListener('mousemove', (e) => { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { d.style.transform = 'scale(.6)'; }, true);
    addEventListener('mouseup', () => { d.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
};

const mousePos = new WeakMap();
async function moveTo(page, selector, { steps = 28, pause = 250 } = {}) {
  const el = await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  const box = await el.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const from = mousePos.get(page) || { x: x - 200, y: y + 120 };
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(16);
  }
  mousePos.set(page, { x, y });
  await sleep(pause);
  return { x, y };
}
async function clickOn(page, selector, opts) {
  await moveTo(page, selector, opts);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  // Mouse events above already trigger the click on the element under the pointer.
}

// Smoothly scroll window (target = 'window') or an element, with a fixed duration.
async function scrollTo(page, target, top, ms = 1400) {
  await page.evaluate(
    (target, top, ms) =>
      new Promise((done) => {
        const el = target === 'window' ? document.scrollingElement : document.querySelector(target);
        const from = el.scrollTop;
        const to = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          el.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    target,
    top,
    ms
  );
  await sleep(150);
}
// Document-y of an element (for window scrolling), minus the sticky header height.
async function docY(page, selector, margin = 12) {
  return page.evaluate(
    (s, m) => {
      const r = document.querySelector(s).getBoundingClientRect();
      const bar = document.querySelector('.appbar');
      const sticky = bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
      return r.top + scrollY - sticky - m;
    },
    selector,
    margin
  );
}
// Scroll offset inside the sticky sidebar that brings `selector` to its top.
async function sideY(page, selector, margin = 4) {
  return page.evaluate(
    (s, m) => {
      const side = document.querySelector('.side');
      return document.querySelector(s).getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop - m;
    },
    selector,
    margin
  );
}
const txt = (page, s) => page.$eval(s, (e) => e.innerText.trim()).catch(() => '');

async function waitTiles(page, ms = 8000) {
  await page
    .waitForFunction(() => {
      const t = document.querySelectorAll('.leaflet-tile-container img');
      return t.length > 0 && [...t].every((i) => i.complete);
    }, { timeout: ms, polling: 200 })
    .catch(() => {});
}

async function waitOutcome(page) {
  await page.waitForFunction(
    () => {
      const err = !document.getElementById('error').hidden;
      const ok = !document.getElementById('result').hidden && document.querySelectorAll('#advice .rec, #advice .rec-empty').length > 0;
      return err || ok;
    },
    { timeout: 75000, polling: 200 }
  );
  return page.evaluate(() => (document.getElementById('error').hidden ? 'ok' : document.getElementById('error-msg').textContent));
}

// Runs a preset live; on failure opens the app's recorded snapshot. Returns provenance info.
async function runPreset(page, id, { mobile = false } = {}) {
  const sel = `[data-preset="${id}"]`;
  await clickOn(page, sel);
  let outcome = await waitOutcome(page).catch((e) => `timeout: ${e.message}`);
  let mode = 'live';
  if (outcome !== 'ok') {
    log(`live ${id} failed (${outcome}); opening recorded snapshot`);
    mode = 'snapshot';
    await page.goto(`${BASE}?snapshot=${id}`, { waitUntil: 'networkidle2', timeout: 60000 });
    outcome = await waitOutcome(page);
  }
  const provenance = await txt(page, '#provenance');
  if (/snapshot/i.test(provenance)) mode = 'snapshot';
  await waitTiles(page);
  const info = { id, mobile, mode, provenance, kpis: await txt(page, '#kpis'), at: new Date().toISOString() };
  report.scenes.push(info);
  log(`${id}${mobile ? ' (mobile)' : ''}: ${mode} — ${provenance}`);
  return info;
}
const tag = (info) => (info.mode === 'snapshot' ? ' (recorded snapshot)' : ' (live data)');
const kpi = (kpis, label) => {
  const m = kpis.match(new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, 'i'));
  return m ? m[1].trim() : '';
};
// Title line of the first recommendation matching `re`.
async function recInfo(page, re) {
  return page.$$eval(
    '#advice .rec',
    (els, src) => {
      const r = new RegExp(src, 'i');
      const i = els.findIndex((e) => r.test(e.innerText));
      return i < 0 ? null : { index: i, title: els[i].innerText.split('\n')[0].trim() };
    },
    re.source
  );
}

// ---------------------------------------------------------------- the demo
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  userDataDir: profile,
  protocolTimeout: 120000,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US'],
});
try {
  // ======== Segment A: desktop walkthrough (single 1440x810 page)
  const page = await browser.newPage();
  await page.emulateTimezone('America/New_York');
  await page.evaluateOnNewDocument(POINTER);
  await page.setViewport({ width: VW, height: PH, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);
  await startSegment(page, 'a-desktop', { maxWidth: VW, maxHeight: PH });
  const scene = (name, data) => report.scenes.push({ name, data, at: new Date().toISOString() });

  // 1) Empty state + pitch (~10 s)
  caption('GlarePilot: weather and sun glare where — and when — you’ll actually drive');
  await sleep(4000);
  caption('Two modes: Real-data planning (live route + forecast) and Manual demo scenarios');
  await moveTo(page, '.mode-switch', { pause: 2600 });
  await scrollTo(page, '.side', await sideY(page, '.presets-card'), 1300);

  // 2) Real forecast planning (~40 s)
  caption('Real-data planning: Amherst → Chicago, leaving 8:00 AM tomorrow');
  const chicago = await runPreset(page, 'chicago-sunset');
  await scrollTo(page, '.side', 0, 800);
  await scrollTo(page, 'window', 0, 400);
  const prov = await txt(page, '#prov');
  report.realProv = prov;
  scene('real-chicago', chicago.mode);
  log('prov:', prov);
  if (chicago.mode === 'snapshot') {
    caption('Recorded snapshot of a real route + forecast (live request failed) — each point at its projected arrival time');
  } else {
    caption('Live route + forecast retrieved now — each point evaluated at its projected arrival time');
  }
  await moveTo(page, '#prov', { pause: 4200 });
  caption(`Trip summary${tag(chicago)}: ${kpi(chicago.kpis, 'Drive')} drive, arrive ${kpi(chicago.kpis, 'Arrive')}`);
  await moveTo(page, '#kpis', { pause: 3600 });
  caption('Map: route colored by sun glare, with condition icons at forecast trouble spots');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1400);
  await moveTo(page, '#map', { pause: 2600 });
  await moveTo(page, '#cond-legend', { pause: 2200 });
  posterAt = globalNow() - 1.0;
  // Traffic delay assumption
  await scrollTo(page, 'window', 0, 1000);
  await scrollTo(page, '.side', await sideY(page, '#delay-min', 120), 1200);
  await moveTo(page, '#delay-min', { pause: 600 });
  await page.select('#delay-min', '60');
  await page.waitForSelector('#delay-card:not([hidden])', { timeout: 30000 }).catch(() => {});
  await sleep(500);
  report.realDelayCard = await txt(page, '#delay-card');
  caption('Assumed +1 h delay — your assumption, not traffic data — every later point re-timed');
  await moveTo(page, '#delay-card', { pause: 5200 });

  // 3) Optimizer glimpse (~15 s)
  await page.$eval('.optimizer-card', (e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(1600);
  caption('“When should I leave?” — same route, departures −3 h…+3 h, transparent exposure score');
  await moveTo(page, '.opt-bar.current', { pause: 3200 });
  if (await page.$('.opt-bar.best')) {
    caption('Lower bars = less glare, wet, wind and after-dark exposure; the best option is marked');
    await moveTo(page, '.opt-bar.best', { pause: 3000 });
  }
  await scrollTo(page, 'window', 0, 1000);

  // 4) Manual demo scenarios (~60 s)
  caption('Manual demo scenarios — hand-set synthetic data, no weather/route API calls');
  await scrollTo(page, '.side', 0, 800);
  await clickOn(page, '[data-mode="demo"]', { pause: 300 });
  await sleep(2600);
  const openScn = async (id) => {
    await clickOn(page, `[data-scenario="${id}"]`, { pause: 300 });
    await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
    await waitTiles(page, 5000);
    await sleep(600);
    scene(id, 'synthetic');
    report.scenes[report.scenes.length - 1].prov = await txt(page, '#prov');
  };
  await openScn('congestion-shift');
  caption('“Delay shifts the weather” (synthetic): an assumed 75 min delay pushes arrival into rain and dark');
  await scrollTo(page, 'window', 0, 400);
  if (await page.$('#delay-card:not([hidden])')) await moveTo(page, '#delay-card', { pause: 3600 });
  else await sleep(3600);
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 2600 });
  await scrollTo(page, 'window', 0, 900);
  await scrollTo(page, '.side', await sideY(page, '#scenario-card'), 600);
  await openScn('storm-crosswind');
  caption('“Heavy rain + crosswind” (synthetic): rain and wind icons where the hand-set squall hits the route');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 3400 });
  await moveTo(page, '#cond-legend', { pause: 1800 });
  await scrollTo(page, 'window', 0, 900);
  await scrollTo(page, '.side', await sideY(page, '#scenario-card'), 600);
  await openScn('sunset-glare');
  caption('“Westbound sunset glare” (synthetic) — now the 3D chase preview');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await clickOn(page, '[data-view="3d"]', { pause: 300 });
  await sleep(3000);
  caption('3D chase preview — simulated playback of the planned route, not GPS');
  await moveTo(page, '#chase canvas', { pause: 800 });
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: 240 });
    await sleep(500);
  }
  await sleep(800);
  report.hudAfterWheel = await txt(page, '[data-hud="state"]');
  caption(`Scroll to look ahead along the route${/preview/i.test(report.hudAfterWheel) ? ` — HUD: “${report.hudAfterWheel.split('\n')[0]}”` : ''}`);
  await sleep(3200);
  if (await page.$('[data-act="return"]:not([disabled])')) {
    await clickOn(page, '[data-act="return"]', { pause: 300 });
    await sleep(1500);
  }
  caption('Play: simulated drive along the planned route (not GPS)');
  await clickOn(page, '[data-act="play"]', { pause: 300 });
  await sleep(5200);
  await clickOn(page, '[data-act="play"]', { pause: 300 });
  await sleep(1200);

  // 5) Reduced motion (~8 s)
  caption('Animation toggle: turn motion off for a calmer, reduced-motion view');
  await clickOn(page, '#motion', { pause: 300 });
  await sleep(600);
  report.motionLabel = await txt(page, '#motion');
  await sleep(5200);
  await endSegment();

  // ======== Segment B: closing
  await scrollTo(page, 'window', 0, 10);
  await page.mouse.move(-50, -50);
  await sleep(400);
  await startSegment(page, 'c-closing', { maxWidth: VW, maxHeight: PH });
  caption('Free, keyless data: Open-Meteo forecasts · Valhalla/OSRM routing · SunCalc sun position', 'Manual demos use hand-set synthetic data. Planning aid, not a safety system. Built with Kiro.');
  await sleep(4500);
  await scrollTo(page, 'window', 99999, 2600);
  await sleep(2600);
  await endSegment();
  await page.close();
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

// ---------------------------------------------------------------- assemble
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const parts = [];
for (const s of segments) {
  const dur = s.end - s.start;
  if (!s.frames.length) throw new Error(`no frames captured for ${s.name}`);
  const lines = [];
  s.frames.forEach((f, i) => {
    const next = i + 1 < s.frames.length ? s.frames[i + 1].t : s.end;
    // The first frame also covers the gap between segment start and first frame.
    const d = i === 0 ? next - s.start : next - f.t;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
  });
  lines.push(`file '${s.frames[s.frames.length - 1].file}'`);
  const list = join(work, `${s.name}.txt`);
  writeFileSync(list, lines.join('\n') + '\n');
  const part = join(work, `${s.name}.mp4`);
  ff([
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${VW}:${PH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${VW}:${VH}:(ow-iw)/2:0:color=${BAR_COLOR},fps=30,format=yuv420p`,
    '-t', dur.toFixed(3), '-r', '30', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-an', part,
  ]);
  parts.push(part);
}
const joinList = join(work, 'parts.txt');
writeFileSync(joinList, parts.map((p) => `file '${p}'`).join('\n') + '\n');
const joined = join(work, 'joined.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', joinList, '-c', 'copy', joined]);

// Captions: drawtext per line (text files avoid escaping issues), plus an SRT.
const total = segments.reduce((s, x) => s + (x.end - x.start), 0);
const filters = [];
captions.forEach((c, i) => {
  const size = c.lines.length > 1 ? 26 : 28;
  const lineH = size + 10;
  const top = PH + Math.round((VH - PH - lineH * c.lines.length) / 2) + 4;
  c.lines.forEach((line, j) => {
    const f = join(work, `cap-${i}-${j}.txt`);
    writeFileSync(f, line);
    filters.push(
      `drawtext=fontfile=${FONT}:textfile=${f}:expansion=none:fontsize=${size}:fontcolor=white:` +
        `x=(w-text_w)/2:y=${top + j * lineH}:enable='between(t,${c.start.toFixed(3)},${(c.end - 0.001).toFixed(3)})'`
    );
  });
});
const filterFile = join(work, 'captions.filter');
writeFileSync(filterFile, filters.join(',\n'));
const mp4 = join(OUT, 'glarepilot-demo.mp4');
ff(['-i', joined, '-filter_script:v', filterFile, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', '-an', mp4]);

const ts = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
writeFileSync(
  join(OUT, 'glarepilot-demo.en.srt'),
  captions.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.lines.join('\n')}\n`).join('\n')
);
ff(['-ss', String((posterAt ?? 20).toFixed(2)), '-i', mp4, '-frames:v', '1', join(OUT, 'glarepilot-demo-poster.png')]);

report.durationSeconds = Number(total.toFixed(2));
report.segments = segments.map((s) => ({ name: s.name, seconds: Number((s.end - s.start).toFixed(2)), frames: s.frames.length }));
report.captions = captions.map((c) => ({ start: Number(c.start.toFixed(2)), end: Number(c.end.toFixed(2)), text: c.lines.join(' ') }));
writeFileSync(join(OUT, 'recording-log.json'), JSON.stringify(report, null, 2) + '\n');
log(`wrote ${mp4} (${(statSync(mp4).size / 1048576).toFixed(1)} MiB, ~${total.toFixed(1)} s)`);
rmSync(work, { recursive: true, force: true });
