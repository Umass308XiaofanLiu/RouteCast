// Visual QA for scenarios, 2D/3D view, preview and reduced motion.
// Usage: node scripts/qa-views.mjs <baseUrl> <outDir>
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:4173/', out = '/tmp/gp_views'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gp-qa-'));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: 'new', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(q, { mobile = false, reduced = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 1000 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const external = [];
  const errors = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith('data:') && !u.includes('tile.openstreetmap.org')) external.push(u.slice(0, 90));
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
  await sleep(1200);
  return { page, external, errors };
}
try {
  for (const id of ['storm-crosswind', 'sunset-glare', 'snow-fog-night', 'congestion-shift']) {
    const { page, external, errors } = await open(`demo=${id}`);
    await page.evaluate(() => document.querySelector('.map-card').scrollIntoView({ block: 'center' }));
    await sleep(500);
    const card = await page.$('.map-card');
    await card.screenshot({ path: join(out, `${id}-2d.png`) });
    await page.click('[data-view="3d"]');
    await sleep(1500);
    await card.screenshot({ path: join(out, `${id}-3d.png`) });
    const canvas = await page.$('#chase canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let k = 0; k < 6; k++) await page.mouse.wheel({ deltaY: 240 });
    await sleep(900);
    await card.screenshot({ path: join(out, `${id}-3d-preview.png`) });
    const st = await page.$eval('[data-hud="state"]', (e) => e.textContent);
    await page.click('[data-act="return"]');
    await sleep(400);
    const st2 = await page.$eval('[data-hud="state"]', (e) => e.textContent);
    console.log(id, JSON.stringify({ external, errors, previewState: st, afterReturn: st2, badge: await page.$eval('#provenance', (e) => e.textContent) }));
    await page.close();
  }
  {
    const { page, external, errors } = await open('demo=congestion-shift');
    await page.screenshot({ path: join(out, 'congestion-desktop-full.png'), fullPage: true });
    console.log('full', JSON.stringify({ external, errors }));
    await page.close();
  }
  {
    const { page, errors } = await open('demo=sunset-glare', { mobile: true });
    await page.evaluate(() => document.querySelector('.map-card').scrollIntoView({ block: 'start' }));
    await sleep(500);
    await page.screenshot({ path: join(out, 'mobile-2d.png') });
    await page.tap('[data-view="3d"]');
    await sleep(1200);
    const c = await page.$('#chase canvas');
    const b = await c.boundingBox();
    await page.touchscreen.touchStart(b.x + b.width * 0.8, b.y + b.height * 0.5);
    for (let k = 1; k <= 8; k++) await page.touchscreen.touchMove(b.x + b.width * (0.8 - k * 0.07), b.y + b.height * 0.5);
    await page.touchscreen.touchEnd();
    await sleep(800);
    await page.evaluate(() => document.querySelector('.map-card').scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: join(out, 'mobile-3d-swipe.png') });
    console.log('mobile', JSON.stringify({ errors, state: await page.$eval('[data-hud="state"]', (e) => e.textContent), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }));
    await page.close();
  }
  {
    const { page, errors } = await open('demo=storm-crosswind', { reduced: true });
    const anim = await page.evaluate(() => {
      const el = document.querySelector('.cond-badge .a-drop, .cond-badge .a-gust');
      return { name: el ? getComputedStyle(el).animationName : 'none', button: document.querySelector('#motion').textContent, icons: document.querySelectorAll('.cond-icon').length };
    });
    console.log('reduced', JSON.stringify({ errors, anim }));
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
