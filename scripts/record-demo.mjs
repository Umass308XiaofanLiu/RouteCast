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
// - Narration: offline Piper TTS (see PIPER_BIN / PIPER_VOICE); one WAV per caption cue,
//   cues never overlap; mixed to AAC 128 kbps. NARRATE=0 records captions only.
//
// Outputs: MP4 at $FINAL_MP4 (default /tmp/gp_release/glarepilot-demo.mp4 — never in the repo);
// docs/media/: glarepilot-demo.en.srt, TRANSCRIPT.md, glarepilot-demo-poster.png, recording-log.json
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] || 'https://umass308xiaofanliu.github.io/glarepilot/';
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const OUT = resolve('docs/media');
const VW = 1440; // video width
const VH = 900; // video height
const PH = 810; // page viewport height (desktop); the remaining 90 px is the caption bar
const BAR_COLOR = '0x0f1b33';
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

// Narration (optional): an offline Piper TTS voice. Every caption cue is also spoken; the
// recording waits until a cue's audio has finished before the next cue starts, so lines
// never overlap. Set NARRATE=0 to record captions only.
const NARRATE = process.env.NARRATE !== '0';
const PIPER = process.env.PIPER_BIN || '/tmp/gp_tts/bin/piper';
const VOICE = process.env.PIPER_VOICE || '/tmp/gp_voice/en_US-ljspeech-medium.onnx';
const FINAL = process.env.FINAL_MP4 || '/tmp/gp_release/glarepilot-demo.mp4'; // never inside the repo
const GAP = 0.45; // silence after each spoken cue (s)

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
  await waitSpeech();
  await sleep(200);
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
// Spoken text for each caption key (written for the ear; the caption shows the same words).
const SAY = {
  problem: 'Long drives go wrong in predictable ways: low sun in your eyes, a storm at the wrong hour, or darkness arriving before you do.',
  pitch: 'GlarePilot checks weather and sun glare where, and when, you will actually be driving.',
  modes: 'It has two clearly separated modes: real data planning, and manual demo scenarios.',
  preset: 'Real data planning first. We pick a preset: Amherst to Chicago, leaving at eight A.M. tomorrow.',
  prov: 'The route and the forecast are retrieved live, right now. Each point is evaluated at its projected arrival time.',
  kpis: 'The trip summary shows the drive time and the expected arrival.',
  map: 'On the map, the route is colored by sun glare, and animated icons mark forecast trouble spots.',
  delay: 'Traffic is not predicted. Instead, you state a delay. Here we assume one extra hour.',
  delayCard: 'The delay card shows the new arrival, and every later point is re-timed against the forecast.',
  advice: 'Advice cards turn the conditions along the route into short, specific recommendations.',
  opt: 'When should I leave? compares the same route with departures from three hours earlier to three hours later, using a transparent exposure score.',
  optBest: 'Lower bars mean less glare, wet road, wind and after-dark exposure. The best option is marked.',
  demo: 'Next, manual demo scenarios. They use hand-set synthetic weather on a recorded real route, with no weather or route API calls.',
  congestion: 'Delay shifts the weather. An assumed seventy-five minute delay pushes the arrival into rain and darkness.',
  storm: 'Heavy rain and crosswind. Rain and wind icons appear where the hand-set squall crosses the route.',
  snow: 'Snow, fog and night. Hand-set snow over the Berkshires and freezing fog near Worcester, all after dark.',
  sunset: 'Westbound sunset glare. Now we switch from the 2D overview to the 3D chase preview.',
  chase: 'The chase preview is a simulated playback of the planned route. It is not GPS.',
  wheel: 'Scrolling the wheel previews the road ahead. Return jumps back to the playback position.',
  play: 'Play runs a simulated drive along the planned route.',
  sources: 'GlarePilot uses free, keyless data: Open-Meteo forecasts, Valhalla and OSRM routing, and SunCalc for sun position.',
  closing: 'It is a planning aid, not a safety system. Manual demos use hand-set data. Built with Kiro for Hackachusetts 2026.',
};
// Caption text where the on-screen form differs from the spoken form.
const SHOW = {
  preset: 'Real-data planning first. Preset: Amherst → Chicago, leaving 8:00 AM tomorrow.',
  opt: '“When should I leave?” compares the same route departing −3 h … +3 h, using a transparent exposure score.',
  congestion: '“Delay shifts the weather” (synthetic): an assumed 75-minute delay pushes the arrival into rain and darkness.',
  storm: '“Heavy rain + crosswind” (synthetic): rain and wind icons appear where the hand-set squall crosses the route.',
  snow: '“Snow, fog and night” (synthetic): hand-set snow over the Berkshires, freezing fog near Worcester, all after dark.',
  sunset: '“Westbound sunset glare” (synthetic). Now we switch from the 2D overview to the 3D chase preview.',
  sources: 'Free, keyless data: Open-Meteo forecasts · Valhalla/OSRM routing · SunCalc sun position.',
  closing: 'A planning aid, not a safety system. Manual demos use hand-set data. Built with Kiro for Hackachusetts 2026.',
};
const voice = {}; // key -> { wav, dur }
function synthAll() {
  const dir = join(work, 'voice');
  mkdirSync(dir, { recursive: true });
  for (const [k, text] of Object.entries(SAY)) {
    const wav = join(dir, `${k}.wav`);
    execFileSync(PIPER, ['-m', VOICE, '-f', wav], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString().trim());
    voice[k] = { wav, dur };
  }
  log(`synthesized ${Object.keys(voice).length} cues, ${Object.values(voice).reduce((s, v) => s + v.dur, 0).toFixed(1)} s of speech`);
}
const cues = []; // spoken cues: { key, start, dur, wav } in global video seconds
let speakingUntil = 0;
async function waitSpeech() {
  while (seg && globalNow() < speakingUntil) await sleep(50);
}
async function caption(key) {
  await waitSpeech();
  closeCaption();
  const text = SHOW[key] || SAY[key];
  const lines = wrap(text);
  const start = globalNow();
  captions.push({ start, end: null, lines, key });
  if (voice[key]) {
    cues.push({ key, start, ...voice[key] });
    speakingUntil = start + voice[key].dur + GAP;
  }
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
if (NARRATE) synthAll();
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

  // 1) Problem + pitch
  await caption('problem');
  await sleep(2500);
  await caption('pitch');
  await sleep(1500);
  await caption('modes');
  await moveTo(page, '.mode-switch', { pause: 1500 });
  await scrollTo(page, '.side', await sideY(page, '.presets-card'), 1300);

  // 2) Real forecast planning
  await caption('preset');
  const chicago = await runPreset(page, 'chicago-sunset');
  await scrollTo(page, '.side', 0, 800);
  await scrollTo(page, 'window', 0, 400);
  const prov = await txt(page, '#prov');
  report.realProv = prov;
  scene('real-chicago', chicago.mode);
  log('prov:', prov);
  if (chicago.mode === 'snapshot') throw new Error('live request failed; narration assumes live data — rerun later or edit SAY.prov');
  await caption('prov');
  await moveTo(page, '#prov', { pause: 1500 });
  await caption('kpis');
  await moveTo(page, '#kpis', { pause: 1200 });
  await caption('map');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1400);
  await moveTo(page, '#map', { pause: 1500 });
  await moveTo(page, '#cond-legend', { pause: 800 });
  posterAt = globalNow() - 0.5;
  // Traffic delay assumption
  await caption('delay');
  await scrollTo(page, 'window', 0, 1000);
  await scrollTo(page, '.side', await sideY(page, '#delay-min', 120), 1200);
  await moveTo(page, '#delay-min', { pause: 600 });
  await page.select('#delay-min', '60');
  await page.waitForSelector('#delay-card:not([hidden])', { timeout: 30000 }).catch(() => {});
  await sleep(400);
  report.realDelayCard = await txt(page, '#delay-card');
  await caption('delayCard');
  await moveTo(page, '#delay-card', { pause: 1500 });
  // Advice cards
  await caption('advice');
  await page.$eval('#advice-card', (e) => e.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  await sleep(1400);
  report.realAdvice = await txt(page, '#advice');
  if (await page.$('#advice .rec')) await moveTo(page, '#advice .rec', { pause: 1200 });

  // 3) Optimizer
  await caption('opt');
  await page.$eval('.optimizer-card', (e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(1600);
  await moveTo(page, '.opt-bar.current', { pause: 1500 });
  if (await page.$('.opt-bar.best')) {
    await caption('optBest');
    await moveTo(page, '.opt-bar.best', { pause: 1500 });
  }

  // 4) Manual demo scenarios (synthetic)
  await caption('demo');
  await scrollTo(page, 'window', 0, 1000);
  await scrollTo(page, '.side', 0, 800);
  await clickOn(page, '[data-mode="demo"]', { pause: 300 });
  await sleep(1200);
  const openScn = async (id) => {
    await waitSpeech();
    await clickOn(page, `[data-scenario="${id}"]`, { pause: 300 });
    await page.waitForSelector('#result:not([hidden])', { timeout: 30000 });
    await waitTiles(page, 5000);
    await sleep(400);
    scene(id, 'synthetic');
    report.scenes[report.scenes.length - 1].prov = await txt(page, '#prov');
  };
  const backToScenarios = async () => {
    await waitSpeech();
    await scrollTo(page, 'window', 0, 800);
    await scrollTo(page, '.side', await sideY(page, '#scenario-card'), 500);
  };
  await openScn('congestion-shift');
  await caption('congestion');
  await scrollTo(page, 'window', 0, 400);
  if (await page.$('#delay-card:not([hidden])')) await moveTo(page, '#delay-card', { pause: 1800 });
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 800 });
  await backToScenarios();
  await openScn('storm-crosswind');
  await caption('storm');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 1500 });
  await moveTo(page, '#cond-legend', { pause: 800 });
  await backToScenarios();
  await openScn('snow-fog-night');
  await caption('snow');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 1500 });
  await backToScenarios();
  await openScn('sunset-glare');
  await caption('sunset');
  await scrollTo(page, 'window', await docY(page, '.map-card'), 1200);
  await moveTo(page, '#map', { pause: 600 });
  await clickOn(page, '[data-view="3d"]', { pause: 300 });
  await sleep(1200);
  await caption('chase');
  await moveTo(page, '#chase canvas', { pause: 800 });
  await caption('wheel');
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel({ deltaY: 240 });
    await sleep(450);
  }
  await sleep(500);
  report.hudAfterWheel = await txt(page, '[data-hud="state"]');
  if (await page.$('[data-act="return"]:not([disabled])')) {
    await clickOn(page, '[data-act="return"]', { pause: 300 });
    report.returned = true;
  }
  await caption('play');
  await clickOn(page, '[data-act="play"]', { pause: 300 });
  await sleep(4500);
  await clickOn(page, '[data-act="play"]', { pause: 300 });
  await sleep(600);
  await endSegment();

  // ======== Segment B: closing
  await scrollTo(page, 'window', 0, 10);
  await page.mouse.move(-50, -50);
  await sleep(400);
  await startSegment(page, 'c-closing', { maxWidth: VW, maxHeight: PH });
  await caption('sources');
  await sleep(1500);
  await scrollTo(page, 'window', 99999, 2600);
  await caption('closing');
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
mkdirSync(dirname(FINAL), { recursive: true });
const mp4 = FINAL;
const vargs = ['-filter_script:v', filterFile, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30'];
if (NARRATE && cues.length) {
  // One input per spoken cue, delayed to its caption start, mixed (no music), AAC 128 kbps.
  const ins = cues.flatMap((c) => ['-i', c.wav]);
  const mix = cues.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`);
  mix.push(`${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  const afile = join(work, 'audio.filter');
  writeFileSync(afile, mix.join(';\n'));
  ff(['-i', joined, ...ins, ...vargs, '-filter_complex_script', afile, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', mp4]);
} else {
  ff(['-i', joined, ...vargs, '-movflags', '+faststart', '-an', mp4]);
}

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
writeFileSync(
  join(OUT, 'TRANSCRIPT.md'),
  '# GlarePilot demo — narration transcript\n\n' +
    'Narration is a synthetic text-to-speech voice (Piper, `en_US-ljspeech-medium`). Captions show the same words; ' +
    'a few on-screen captions use written forms (for example “8:00 AM”, “−3 h … +3 h”, “(synthetic)”).\n\n' +
    captions.map((c) => `- [${ts(c.start).slice(3, 8)}] ${SAY[c.key]}`).join('\n') + '\n'
);
report.narration = NARRATE ? { engine: 'piper-tts 1.3.0', voice: VOICE.split('/').pop(), cues: cues.map((c) => ({ key: c.key, start: Number(c.start.toFixed(2)), seconds: Number(c.dur.toFixed(2)) })) } : null;
report.output = mp4;

report.durationSeconds = Number(total.toFixed(2));
report.segments = segments.map((s) => ({ name: s.name, seconds: Number((s.end - s.start).toFixed(2)), frames: s.frames.length }));
report.captions = captions.map((c) => ({ start: Number(c.start.toFixed(2)), end: Number(c.end.toFixed(2)), text: c.lines.join(' ') }));
writeFileSync(join(OUT, 'recording-log.json'), JSON.stringify(report, null, 2) + '\n');
log(`wrote ${mp4} (${(statSync(mp4).size / 1048576).toFixed(1)} MiB, ~${total.toFixed(1)} s)`);
rmSync(work, { recursive: true, force: true });
