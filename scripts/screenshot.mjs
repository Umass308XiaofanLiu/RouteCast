// Visual QA: capture screenshots of key states with isolated headless Chrome.
// Usage: node scripts/screenshot.mjs <baseUrl> <outDir> [query...]
// Example: node scripts/screenshot.mjs http://127.0.0.1:4173/ docs/screenshots "snapshot=chicago-sunset"
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:4173/', out = 'docs/screenshots', ...queries] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gp-shot-'));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: profile, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] });
try {
  const views = [
    { name: 'desktop', width: 1440, height: 1000, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
  ];
  for (const q of queries.length ? queries : ['']) {
    for (const v of views) {
      const page = await browser.newPage();
      await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: 1, isMobile: v.mobile, hasTouch: v.mobile });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${base}${q ? `?${q}` : ''}`, { waitUntil: 'networkidle2', timeout: 90000 });
      if (q) await page.waitForSelector('#result:not([hidden]), #error:not([hidden])', { timeout: 90000 });
      await new Promise((r) => setTimeout(r, 1500));
      const tag = (q || 'empty').replace(/[^a-z0-9]+/gi, '-');
      await page.screenshot({ path: join(out, `${tag}-${v.name}.png`), fullPage: true });
      await page.screenshot({ path: join(out, `${tag}-${v.name}-fold.png`) });
      console.log(`${tag}-${v.name}: errors=${JSON.stringify(errors)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
