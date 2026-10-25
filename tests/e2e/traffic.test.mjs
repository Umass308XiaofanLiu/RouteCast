// E2E: optional traffic-aware routing with a FAKE TomTom key. The TomTom host is answered by a
// fetch shim installed in this file's own page setup (helpers.mjs is unchanged); no real API call.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage, text, choosePlace, setDeparture, waitResult, SNAP } from './helpers.mjs';

const FAKE_KEY = 'fake-e2e-key-000';
const DELAY = 1800;
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

// Documented calculateRoute shape (see src/lib/traffic/tomtom.js), built from the recorded route.
function tomtomBody(s) {
  const r = s.route;
  const n = r.coords.length;
  const a = Math.floor(n * 0.45);
  const b = Math.floor(n * 0.55);
  const tAt = (i) => r.cumTime[i] + (i <= a ? 0 : i >= b ? DELAY : (DELAY * (i - a)) / (b - a));
  const instructions = [];
  for (let i = 0; i < n - 1; i += Math.floor(n / 30)) instructions.push({ pointIndex: i, travelTimeInSeconds: Math.round(tAt(i)), routeOffsetInMeters: Math.round(r.cumDist[i]), roadNumbers: ['I-90'] });
  instructions.push({ pointIndex: n - 1, travelTimeInSeconds: Math.round(r.totalSec + DELAY), routeOffsetInMeters: Math.round(r.totalDistM) });
  return {
    formatVersion: '0.0.12',
    routes: [{
      summary: { lengthInMeters: Math.round(r.totalDistM), travelTimeInSeconds: Math.round(r.totalSec + DELAY), trafficDelayInSeconds: DELAY, noTrafficTravelTimeInSeconds: Math.round(r.totalSec) },
      legs: [{ points: r.coords.map(([lat, lon]) => ({ latitude: lat, longitude: lon })) }],
      sections: [{ startPointIndex: a, endPointIndex: b, sectionType: 'TRAFFIC', delayInSeconds: DELAY, magnitudeOfDelay: 3, simpleCategory: 'JAM' }],
      guidance: { instructions },
    }],
  };
}

async function openTrafficPage() {
  const ctx = await openPage(chrome.browser, srv.url, { query: 'experimental=traffic' });
  await ctx.page.evaluateOnNewDocument((body) => {
    const real = window.fetch.bind(window);
    window.__tt = [];
    window.fetch = (input, init) => {
      const url = String(input?.url || input);
      if (url.startsWith('https://api.tomtom.com/')) {
        window.__tt.push(url);
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return real(input, init);
    };
  }, JSON.stringify(tomtomBody(SNAP['amherst-chicago'])));
  await ctx.page.reload({ waitUntil: 'domcontentloaded' });
  await ctx.page.waitForSelector('#presets .preset');
  return ctx;
}

test('traffic: fake TomTom key -> predictive provenance, later arrival, key not stored by default, cleared', async () => {
  const { page, errors, calls } = await openTrafficPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  await choosePlace(page, 'origin', 'Amherst, MA');
  await choosePlace(page, 'dest', 'Chicago');
  await setDeparture(page, '2026-10-25T08:00');
  // Without a key: unchanged free-flow behaviour.
  await page.$eval('#plan', (b) => b.click()); // DOM click: immune to layout shifts under the mouse
  await waitResult(page);
  assert.match(await text(page, '#kpis'), /Arrive 9:24 PM CDT/i);
  assert.match(await text(page, '#provenance'), /Valhalla route/);
  assert.equal(await page.$('#traffic-prov'), null);
  assert.equal(await page.evaluate(() => window.__tt.length), 0, 'no traffic request without a key');

  // Configure TomTom with a fake key (memory only by default). The section is experimental and labelled.
  assert.match(await text(page, '#traffic-experimental'), /Experimental — not verified against real provider responses/);
  await page.$eval('#traffic-cfg > summary', (s) => s.click());
  await page.select('#traffic-provider', 'tomtom');
  assert.equal(await page.$eval('#traffic-key', (e) => e.type), 'password');
  assert.equal(await page.$eval('#traffic-remember', (e) => e.checked), false);
  await page.type('#traffic-key', FAKE_KEY);
  await page.$eval('#plan', (b) => b.click()); // DOM click: immune to layout shifts under the mouse
  await page.waitForFunction(() => document.querySelector('#traffic-prov'));
  await waitResult(page);
  const tt = await page.evaluate(() => window.__tt);
  assert.equal(tt.length, 1);
  const u = new URL(tt[0]);
  assert.equal(u.searchParams.get('key'), FAKE_KEY);
  assert.equal(u.searchParams.get('traffic'), 'true');
  assert.match(u.searchParams.get('departAt'), /^2026-10-25T12:00:00Z$/);
  const prov = await text(page, '#prov');
  assert.match(prov, /TomTom · predictive/);
  assert.match(prov, /historical\/typical traffic/);
  assert.match(prov, /traffic delay \+30 min/);
  assert.match(await text(page, '#kpis'), /Arrive 9:54 PM CDT/i, 'arrival shifts by the traffic delay');
  assert.match(await text(page, '#optimizer'), /reuse this plan's traffic timing/);
  assert.equal(await page.evaluate(() => localStorage.getItem('glarepilot.traffic.v1')), null, 'key not stored by default');
  assert.ok(!logs.some((l) => l.includes(FAKE_KEY)), 'key never logged');
  assert.ok(!(await page.content()).includes(FAKE_KEY.slice(0, 12) + '</'), 'key not rendered as text');

  // Remember -> stored; Clear -> removed everywhere.
  await page.$eval('#traffic-remember', (c) => c.click());
  assert.match(await page.evaluate(() => localStorage.getItem('glarepilot.traffic.v1')), /tomtom/);
  await page.$eval('#traffic-clear', (c) => c.click());
  assert.equal(await page.evaluate(() => localStorage.getItem('glarepilot.traffic.v1')), null);
  assert.equal(await page.$eval('#traffic-key', (e) => e.value), '');
  assert.deepEqual(calls.blocked.filter((x) => x.includes('tomtom')), []);
  assert.deepEqual(errors, []);
  await page.close();
});

test('traffic: provider 401 -> visible warning and free-flow fallback (never silent)', async () => {
  const { page, errors } = await openPage(chrome.browser, srv.url, { query: 'experimental=traffic' });
  await page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => (String(input?.url || input).startsWith('https://api.tomtom.com/') ? Promise.resolve(new Response('{"error":{"description":"Invalid key"}}', { status: 401 })) : real(input, init));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#presets .preset');
  await choosePlace(page, 'origin', 'Amherst, MA');
  await choosePlace(page, 'dest', 'Chicago');
  await setDeparture(page, '2026-10-25T08:00');
  await page.$eval('#traffic-cfg > summary', (s) => s.click());
  await page.select('#traffic-provider', 'tomtom');
  await page.type('#traffic-key', 'bad-key');
  await page.$eval('#plan', (b) => b.click()); // DOM click: immune to layout shifts under the mouse
  await waitResult(page);
  assert.match(await text(page, '#snapshot-banner'), /Traffic-aware routing failed: TomTom rejected the API key \(401/);
  assert.match(await text(page, '#prov'), /Traffic: TomTom unavailable/);
  assert.match(await text(page, '#kpis'), /Arrive 9:24 PM CDT/i, 'free-flow Valhalla timing');
  assert.deepEqual(errors, []);
  await page.close();
});
