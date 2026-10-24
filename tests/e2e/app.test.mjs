import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startServer, launch, openPage, text, visible, choosePlace, setDeparture, waitResult, SHOTS } from './helpers.mjs';

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
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });

test('normal flow: search places, set departure in origin time, plan Amherst -> Chicago', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url);
  await choosePlace(page, 'origin', 'Amherst, MA');
  assert.equal(await page.$eval('#origin-input', (e) => e.value), 'Amherst, MA');
  await choosePlace(page, 'dest', 'Chicago');
  assert.match(await text(page, '#dest-hint'), /America\/Chicago/);
  await setDeparture(page, '2026-10-25T08:00');
  assert.match(await text(page, '#departure-tz'), /EDT/);
  await page.click('#plan');
  await waitResult(page);
  assert.match(await text(page, '#provenance'), /Live forecast · Valhalla route/);
  const kpis = await text(page, '#kpis');
  assert.match(kpis, /Drive 14h 24m/i);
  assert.match(kpis, /Arrive 9:24 PM CDT/i);
  const advice = await text(page, '#advice');
  assert.match(advice, /sunset glare/i);
  assert.match(advice, /after dark/i);
  assert.ok(await page.$('#timeline svg'));
  assert.ok(await page.$('.leaflet-overlay-pane canvas'), 'route drawn on the map');
  assert.ok((await page.$$('#points-table tbody tr')).length >= 20);
  assert.match(await page.$eval('#points-table tbody tr:last-child td', (e) => e.textContent), /CDT/);
  assert.equal(calls.forecast, 1, 'one batched forecast request');
  assert.deepEqual(calls.blocked, []);
  assert.deepEqual(errors, []);
  await shot(page, 'e2e-desktop-normal');
  await page.close();
});

test('glare scenario: Albany -> Boston preset shows eastbound sunrise glare', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-preset="boston-sunrise"]');
  await waitResult(page);
  const first = await text(page, '#advice .rec:first-child');
  assert.match(first, /sunrise glare/i);
  assert.match(first, /above the horizon/);
  assert.match(await text(page, '#kpis'), /Sun glare \d+ min/i);
  assert.match(await text(page, '#compass'), /glare/i, 'cursor starts at the worst glare moment');
  assert.deepEqual(errors, []);
  await page.close();
});

test('night scenario: Amherst -> New York at 8 PM has no glare and flags darkness', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await choosePlace(page, 'dest', 'New York');
  await setDeparture(page, '2026-10-25T20:00');
  await page.click('#plan');
  await waitResult(page);
  const kpis = await text(page, '#kpis');
  assert.match(kpis, /Sun glare None/i);
  assert.match(kpis, /After dark 2h 55m 100%/i);
  const advice = await text(page, '#advice');
  assert.doesNotMatch(advice, /(sunrise|sunset) glare|sun behind/i);
  assert.match(advice, /after dark/i);
  await page.click('[data-layer="light"]');
  assert.match(await text(page, '#legend'), /Dark/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('invalid input: same place, unknown place, past and beyond-horizon departures', async () => {
  const { page, calls, errors } = await openPage(chrome.browser, srv.url);
  await choosePlace(page, 'dest', 'Amherst, MA');
  await page.click('#plan');
  await page.waitForSelector('#form-error:not([hidden])');
  assert.match(await text(page, '#form-error'), /same place/);
  assert.equal(await page.$eval('#dest-input', (e) => e.getAttribute('aria-invalid')), 'true');

  await page.click('#dest-input', { clickCount: 3 });
  await page.type('#dest-input', 'Zzyzxqq');
  await page.waitForFunction(() => /No US place found/.test(document.querySelector('#dest-list').textContent));
  await page.click('#plan');
  await page.waitForFunction(() => /Choose a destination/.test(document.querySelector('#form-error').textContent));

  await choosePlace(page, 'dest', 'Chicago');
  await setDeparture(page, '2026-10-24T08:00');
  await page.click('#plan');
  await page.waitForFunction(() => /in the past/.test(document.querySelector('#form-error').textContent));
  await setDeparture(page, '2026-11-20T08:00');
  await page.click('#plan');
  await page.waitForFunction(() => /two weeks|14 days/.test(document.querySelector('#form-error').textContent));
  assert.equal(calls.valhalla + calls.osrm + calls.forecast, 0, 'invalid input never hits routing/forecast');
  assert.equal(await visible(page, '#result'), false);
  await shot(page, 'e2e-invalid-input');
  assert.deepEqual(errors, []);
  await page.close();
});

test('service failures: no route -> error + recorded snapshot; forecast down -> retry; Valhalla down -> OSRM', async () => {
  const fail = { valhalla: true, osrm: true };
  const { page, errors } = await openPage(chrome.browser, srv.url, { fail });
  await page.click('[data-preset="chicago-sunset"]');
  await page.waitForSelector('#error:not([hidden])');
  assert.match(await text(page, '#error-msg'), /No driving route/);
  assert.equal(await visible(page, '#result'), false, 'no fake straight-line route');
  await shot(page, 'e2e-error-routing');
  await page.click('#error-snapshot');
  await waitResult(page);
  assert.match(await text(page, '#provenance'), /Recorded snapshot/);
  assert.match(await text(page, '#snapshot-banner'), /Recorded snapshot — not current conditions/);

  fail.valhalla = false;
  fail.osrm = false;
  fail.forecast = true;
  await page.click('[data-preset="boston-sunrise"]');
  await page.waitForSelector('#error:not([hidden])');
  assert.match(await text(page, '#error-msg'), /forecast/i);
  fail.forecast = false;
  await page.click('#retry');
  await waitResult(page);
  assert.match(await text(page, '#provenance'), /Live forecast · Valhalla route/);

  fail.valhalla = true;
  await page.click('[data-preset="nyc-evening"]');
  await waitResult(page);
  assert.match(await text(page, '#provenance'), /OSRM route/);
  assert.match(await text(page, '#snapshot-banner'), /used OSRM instead/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('route change and controls: new destination, optimizer, units, layers, swap, scrubber', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-preset="chicago-sunset"]');
  await waitResult(page);
  const before = await text(page, '#kpis');
  await choosePlace(page, 'dest', 'New York');
  await page.click('#plan');
  await page.waitForFunction((b) => document.querySelector('#kpis').textContent.replace(/\s+/g, ' ').trim() !== b && !document.querySelector('#result').hidden, {}, before);
  assert.match(await text(page, '#kpis'), /167 mi/);

  const dep0 = await page.$eval('#departure', (e) => e.value);
  const bar = await page.$('.opt-bar:not(.current):not(.na)');
  await bar.click();
  await page.waitForFunction((d) => document.querySelector('#departure').value !== d, {}, dep0);

  await page.click('[data-units="metric"]');
  assert.match(await text(page, '#kpis'), /°C/);
  assert.match(await text(page, '#kpis'), /km/);
  await page.click('[data-layer="weather"]');
  assert.match(await text(page, '#legend'), /Rain/);

  await page.focus('#scrub');
  await page.keyboard.press('End');
  const last = await page.$eval('#points-table tbody tr:last-child td', (e) => e.textContent.trim());
  assert.equal(await text(page, '.moment-time'), last);

  await page.click('#swap');
  assert.equal(await page.$eval('#origin-input', (e) => e.value), 'New York, NY');
  assert.equal(await page.$eval('#dest-input', (e) => e.value), 'Amherst, MA');
  assert.deepEqual(errors, []);
  await page.close();
});

test('unknown snapshot id shows an error instead of a different trip', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'snapshot=nope' });
  await page.waitForSelector('#error:not([hidden])');
  assert.match(await text(page, '#error-msg'), /no recorded snapshot called/);
  const ok = await openPage(chrome.browser, srv.url, { query: 'snapshot=albany-boston' });
  await waitResult(ok.page);
  assert.match(await text(ok.page, '#kpis'), /Boston, MA/);
  assert.match(await text(ok.page, '#provenance'), /Recorded snapshot/);
  assert.deepEqual([...errors, ...ok.errors], []);
  await page.close();
  await ok.page.close();
});

test('mobile layout: no horizontal overflow, stacked layout, readable result', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { mobile: true });
  await shot(page, 'e2e-mobile-empty');
  await page.click('[data-preset="chicago-sunset"]');
  await waitResult(page);
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    form: document.querySelector('.trip-card').getBoundingClientRect().toJSON(),
    map: document.querySelector('#map').getBoundingClientRect().toJSON(),
    btn: document.querySelector('#plan').getBoundingClientRect().height,
    seg: Math.min(...[...document.querySelectorAll('.seg-btn')].map((b) => b.getBoundingClientRect().height)),
  }));
  assert.ok(m.scrollW <= m.innerW + 1, `no horizontal scroll (${m.scrollW} > ${m.innerW})`);
  assert.ok(m.form.width <= 390 && m.map.width <= 390);
  assert.ok(m.map.height >= 250, 'map has a usable height');
  assert.ok(m.btn >= 44, 'primary button is a comfortable tap target');
  assert.ok(m.seg >= 24);
  const order = await page.evaluate(() => ['.trip-card', '#kpis', '#advice-card'].map((q) => document.querySelector(q).getBoundingClientRect().top + window.scrollY));
  assert.ok(order[0] < order[1] && order[1] < order[2], 'mobile order: form, results, advice');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'e2e-mobile-result', true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('accessibility basics: labelled controls, live status, keyboard-operable advice', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url);
  await page.click('[data-preset="boston-sunrise"]');
  await waitResult(page);
  const unlabeled = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, button')]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => !(el.labels?.length || el.getAttribute('aria-label') || el.textContent.trim() || el.title))
      .map((el) => el.outerHTML.slice(0, 80))
  );
  assert.deepEqual(unlabeled, []);
  assert.match(await text(page, '#status'), /Drive planned/);
  await page.focus('#advice .rec:first-child');
  await page.keyboard.press('Enter');
  assert.ok(await page.$('#advice .rec.active'));
  assert.equal(await page.$eval('#origin-input', (e) => e.getAttribute('role')), 'combobox');
  assert.deepEqual(errors, []);
  await page.close();
});
