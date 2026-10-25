// main.js — GlarePilot app controller.
import './styles.css';
import places from './data/us_places.json';
import { buildTripModel, fromSnapshot } from './lib/planner.js';
import { evaluateTrip, describeGlareWindow, placeLabel, BREAK_PLANS } from './lib/trip.js';
import { optimizeDeparture } from './lib/optimizer.js';
import { buildAdvice } from './lib/advice.js';
import { forecastHorizonEnd } from './lib/providers.js';
import { parseLocalInput, toLocalInput, zonedParts, zonedWallTimeToUtc, formatClock, formatDuration, tzAbbrev } from './lib/time.js';
import { describeCode } from './lib/weather.js';
import { compass, snapFix } from './lib/geo.js';
import { makeFormatter } from './lib/units.js';
import { PRESETS, PLACES } from './lib/presets.js';
import { createCombobox } from './ui/combobox.js';
import { createMap, legendHtml } from './ui/mapview.js';
import { createTimeline } from './ui/timeline.js';
import { compassSvg, compassText } from './ui/compass.js';
import { ICONS, GLARE_LABEL, PHASE_LABEL, WEATHER_LABEL, weatherCategory } from './ui/palette.js';
import { SCENARIOS, buildScenarioModel } from './lib/scenarios.js';
import { createConditionLayer, condLegendHtml, COND_SVG, COND_RING } from './ui/condlayer.js';
import { createChase } from './ui/chase3d.js';
import { rowConditions } from './lib/conditions.js';
import { createDemSampler } from './lib/demsampler.js';
import { checkGlareWindows, terrainLine, TERRAIN_SOURCE_NOTE, MAX_TOTAL_RAYS } from './lib/terraincheck.js';
import { terrainAdjustedGlare, terrainAdjustedLine, terrainKpiNote } from './lib/terrainglare.js';
import { OPTIMIZER_TRAFFIC_NOTE, MODE_LABEL } from './lib/traffic/index.js';
import L from 'leaflet';
import { fetchOverlays, evaluateOverlays, overlaySources } from './lib/traffic/overlays/index.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  units: 'us',
  layer: 'glare',
  model: null,
  ev: null,
  opt: null,
  recs: [],
  sel: 0,
  activeRec: null,
  glareWindows: [],
  inflight: null,
  lastRequest: null,
  mode: 'real',
  view: '2d',
  scenario: null,
  baseline: null,
};
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let fmt = makeFormatter('us');

// ---------- form ----------
const originBox = createCombobox({ input: $('origin-input'), list: $('origin-list'), hint: $('origin-hint'), onSelect: () => updateDepartureTz() });
const destBox = createCombobox({ input: $('dest-input'), list: $('dest-list'), hint: $('dest-hint') });

function updateDepartureTz() {
  const o = originBox.value;
  const el = $('departure-tz');
  if (!o) {
    el.textContent = '(origin local time)';
    return;
  }
  const dep = parseLocalInput($('departure').value, o.timezone) ?? Date.now();
  el.textContent = `(${tzAbbrev(dep, o.timezone)} · ${o.timezone.replace('_', ' ')})`;
}

function nextDayAt(hour, minute, tz) {
  const p = zonedParts(Date.now() + 864e5, tz);
  return zonedWallTimeToUtc({ year: p.year, month: p.month, day: p.day, hour, minute }, tz);
}

function setDeparture(utc, tz) {
  $('departure').value = toLocalInput(utc, tz);
  updateDepartureTz();
}

$('depart-now').addEventListener('click', () => {
  const tz = originBox.value?.timezone || 'America/New_York';
  const t = Math.ceil(Date.now() / 900e3) * 900e3;
  setDeparture(t, tz);
});
$('departure').addEventListener('change', updateDepartureTz);
$('swap').addEventListener('click', () => {
  const a = originBox.value;
  const b = destBox.value;
  const dep = a ? parseLocalInput($('departure').value, a.timezone) : null;
  originBox.set(b);
  destBox.set(a);
  if (b && dep) setDeparture(dep, b.timezone);
  updateDepartureTz();
});

function showFormError(msg, field) {
  const el = $('form-error');
  el.textContent = msg;
  el.hidden = !msg;
  for (const id of ['origin-input', 'dest-input', 'departure']) $(id).removeAttribute('aria-invalid');
  if (field) {
    $(field).setAttribute('aria-invalid', 'true');
    $(field).focus();
  }
}

async function readForm() {
  let origin;
  let dest;
  try {
    origin = await originBox.resolve();
    dest = await destBox.resolve();
  } catch {
    throw Object.assign(new Error('Place search is unavailable right now. Try a demo trip or a recorded snapshot.'), { field: null });
  }
  if (!origin) throw Object.assign(new Error('Choose a starting place from the list.'), { field: 'origin-input' });
  if (!dest) throw Object.assign(new Error('Choose a destination from the list.'), { field: 'dest-input' });
  if (Math.abs(origin.lat - dest.lat) < 0.02 && Math.abs(origin.lon - dest.lon) < 0.02) {
    throw Object.assign(new Error('Origin and destination are the same place.'), { field: 'dest-input' });
  }
  const dep = parseLocalInput($('departure').value, origin.timezone);
  if (dep == null) throw Object.assign(new Error('Enter a departure date and time.'), { field: 'departure' });
  if (dep < Date.now() - 15 * 60e3) throw Object.assign(new Error('That departure time is in the past. GlarePilot plans upcoming drives.'), { field: 'departure' });
  if (dep > forecastHorizonEnd() - 36 * 3600e3) {
    throw Object.assign(new Error('Forecasts only reach about two weeks ahead. Pick a departure within the next 13 days.'), { field: 'departure' });
  }
  return { origin, dest, departureUtc: dep, vehicle: $('vehicle').value, breaks: $('breaks').value };
}

// ---------- view states ----------
function show(view) {
  for (const id of ['empty', 'loading', 'error', 'result']) $(id).hidden = id !== view;
  $('advice-card').hidden = view !== 'result';
  if (view !== 'result') chase?.show(false);
  else if (state.view === '3d') chase?.show(true);
  // terrain view
  if (view !== 'result') terrain?.show(false);
  else if (state.view === 'terrain') terrain?.show(true);
  document.body.classList.toggle('has-result', view === 'result');
}
function setBusy(busy) {
  const b = $('plan');
  b.disabled = busy;
  b.classList.toggle('busy', busy);
  b.querySelector('.btn-label').textContent = busy ? 'Planning…' : 'See my drive';
}
function setStage(stage) {
  const order = ['route', 'forecast', 'compute'];
  const idx = order.indexOf(stage);
  document.querySelectorAll('.steps li').forEach((li) => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', i < idx);
  });
  const labels = { route: 'Routing the drive', forecast: 'Fetching forecasts along the route', compute: 'Computing sun position and glare' };
  $('status').textContent = labels[stage] || '';
}
function announce(msg) {
  $('status').textContent = msg;
}

// ---------- planning ----------
async function plan(req) {
  state.inflight?.abort();
  resetOverlays();
  const ctrl = new AbortController();
  state.inflight = ctrl;
  state.lastRequest = req;
  showFormError('');
  setBusy(true);
  show('loading');
  setStage('route');
  try {
    const model = await buildTripModel({ ...req, traffic: trafficConfig(), breakPlan: BREAK_PLANS[req.breaks], places, signal: ctrl.signal, onStage: setStage });
    if (ctrl.signal.aborted) return;
    setStage('compute');
    await new Promise((r) => requestAnimationFrame(() => r()));
    state.model = model;
    show('result');
    evaluate(req.departureUtc, { fit: true });
    focusResults();
    state.overlay.model = model;
    renderOverlays();
  } catch (e) {
    if (ctrl.signal.aborted) return;
    console.error(e);
    $('error-msg').textContent = friendlyError(e);
    show('error');
    announce(`Could not plan the drive. ${friendlyError(e)}`);
  } finally {
    if (state.inflight === ctrl) {
      state.inflight = null;
      setBusy(false);
    }
  }
}

function friendlyError(e) {
  const m = e?.message || String(e);
  if (/horizon/i.test(m)) return 'This trip is beyond the forecast horizon (about two weeks). Pick an earlier departure.';
  if (/No driving route/.test(m)) return 'No driving route was found between these places (the public routing servers may also be busy). Check the places or try again in a moment.';
  if (/forecast/i.test(m)) return `The forecast service did not respond (${m}). Try again, or open a recorded snapshot to explore the demo offline.`;
  return m;
}

function focusResults() {
  const r = $('results');
  r.focus({ preventScroll: true });
  if (window.matchMedia('(max-width: 1100px)').matches) $('kpis').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tripOpts() {
  if (state.model?.source.kind === 'synthetic') {
    const scn = SCENARIOS.find((x) => x.id === state.model.source.scenario);
    return { breakPlan: BREAK_PLANS.none, vehicle: scn.vehicle, delay: scn.delay, breaks: 'none' };
  }
  return { breakPlan: BREAK_PLANS[$('breaks').value], vehicle: $('vehicle').value, delay: { minutes: Number($('delay-min').value), where: $('delay-where').value }, breaks: $('breaks').value };
}

function evaluate(departureUtc, { fit = false } = {}) {
  const m = state.model;
  const opts = tripOpts();
  const vehicle = opts.vehicle;
  const nowMs = m.source.kind === 'synthetic' ? state.scenarioNow : m.source.kind === 'snapshot' ? m.source.capturedAt : Date.now();
  state.opt = optimizeDeparture(m, departureUtc, opts, { nowMs });
  state.ev = state.opt.base;
  state.baseline = opts.delay?.minutes ? evaluateTrip(m, departureUtc, { ...opts, delay: null }) : null;
  state.glareWindows = state.ev.windows.glare.map((w) => describeGlareWindow(m, state.ev, w)).filter((d) => d.peakSeverity >= 2 || d.minutes >= 4);
  state.recs = buildAdvice(m, state.ev, { vehicle, optimizer: state.opt, unitsFmt: fmt, synthetic: m.source.kind === 'synthetic' });
  state.activeRec = null;
  resetTerrainCheck();
  // Start the cursor at the most important glare moment, else at departure.
  const firstRec = state.recs.find((r) => r.focus != null);
  const top = state.glareWindows.slice().sort((a, b) => b.peakExpected - a.peakExpected || b.peakSeverity - a.peakSeverity)[0];
  state.sel = firstRec ? firstRec.focus : top ? top.peak : 0;
  renderAll({ fit });
  const ev = state.ev;
  announce(`Drive planned: ${formatDuration(ev.driveSec)} of driving, arriving ${formatClock(ev.arrivalUtc, m.destTz)}. ${state.recs.length} notes.`);
}

// ---------- rendering ----------
let mapView = null;
let timeline = null;
let condLayer = null;
let chase = null;
// terrain view: lazily created MapLibre view (src/ui/terrain3d.js)
let terrain = null;
let terrainLoading = null;

function renderAll({ fit = false } = {}) {
  const { model, ev } = state;
  mapView ??= createMap($('map'), { onPick: (i) => userSelect(i) });
  timeline ??= createTimeline($('timeline'), { onPick: (i) => userSelect(i) });
  condLayer ??= createConditionLayer(mapView.map, { onPick: (i, range) => userSelect(i, { range }) });
  chase ??= createChase($('chase'), {
    onAdvance: (i) => {
      gpsUserMoved();
      select(i, { fromChase: true });
    },
    onPreview: previewAt,
    // shared camera level across both 3D views (views: begin)
    onLevel: (l) => {
      state.level = l;
      terrain?.setLevel(l, { silent: true });
    },
    onStatus: announceView,
    level: state.level ?? 1,
    // (views: end)
    getFmt: () => fmt,
    reducedMotion,
  });
  renderProvenance();
  renderKpis();
  renderDelayCard();
  $('legend').innerHTML = legendHtml(state.layer);
  mapView.render(model, ev, state.layer, state.glareWindows, { fit });
  mapView.setJam(model, ev.windows.jam);
  requestAnimationFrame(() => {
    mapView.invalidate();
    condLayer.render(model, ev);
    $('cond-legend').innerHTML = condLegendHtml(condLayer.presentCategories());
  });
  chase.setTrip(model, ev);
  terrain?.setTrip(model, ev); // terrain view
  renderAdvice();
  renderOverlays();
  renderOptimizer();
  renderTable();
  $('scrub').max = String(ev.rows.length - 1);
  $('timeline-note').textContent = `Times shown in local time along the route · ${model.route.engine} drive times, no live traffic`;
  select(state.sel);
}

function provHtml() {
  const m = state.model;
  const ev = state.ev;
  const ny = (t) => `${formatClock(t, 'America/New_York')}, ${new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })}`;
  const tr = m.source.traffic;
  const dly = ev.delay?.minutes ? ` plus your assumed ${formatDuration(ev.delay.extraSec)} delay ${ev.delay.label}` : '';
  const timing = `Each point uses conditions at its <strong>projected arrival time</strong>: departure ${esc(formatClock(ev.departureUtc, m.originTz))} + routed drive time${$('breaks').value !== 'none' && m.source.kind !== 'synthetic' ? ' + breaks' : ''}${esc(dly)}.`;
  const what = `<details><summary>What is forecast, computed, estimated or assumed?</summary><ul>
      <li><strong>Weather</strong>: ${m.source.kind === 'synthetic' ? 'hand-set synthetic values (not a forecast)' : 'Open-Meteo model forecast for the hour each point is reached (not an observation, not current conditions)'}.</li>
      <li><strong>Sun position and glare</strong>: computed with SunCalc for each point's future arrival time and heading.</li>
      <li><strong>Arrival times</strong>: ${tr?.retrievedAt ? `estimated from ${esc(tr.provider)} traffic-aware routing (${esc(MODE_LABEL[tr.mode])}, ${esc(tr.timing)})${dly ? ' plus your separate delay assumption' : ''}` : `estimated from ${esc(m.route.engine)} free-flow routing${dly ? ' plus your delay assumption' : ''}; no live or predicted traffic is used`}.</li>
      <li><strong>Observed / live data</strong>: none. GlarePilot does not show current conditions and does not track your location.</li></ul></details>`;
  if (m.source.kind === 'synthetic') {
    return { cls: 'synthetic', html: `<strong>Manual demo scenario — synthetic data.</strong> “${esc(m.source.title)}”: ${esc(m.source.story)} Weather${state.ev.delay?.minutes ? ' and the traffic delay are' : ' is'} hand-set on purpose; no weather, routing or traffic API is called (only map tiles load). Route geometry and routed times come from a recorded real ${esc(m.route.engine)} route captured ${esc(ny(m.source.routeCapturedAt))}. ${timing}${what}` };
  }
  if (m.source.kind === 'snapshot') {
    return { cls: 'snapshot', html: `<strong>Recorded real data — not current.</strong> ${esc(m.route.engine)} route and Open-Meteo forecast retrieved ${esc(ny(m.source.capturedAt))}. ${timing}${what}` };
  }
  return { cls: 'live', html: `<strong>Real-data plan.</strong> ${esc(m.route.engine)} route and Open-Meteo forecast retrieved ${esc(ny(m.source.capturedAt))}. Trip departs ${esc(formatClock(ev.departureUtc, m.originTz))} and arrives ${esc(formatClock(ev.arrivalUtc, m.destTz))}. ${timing}${trafficLine(tr, ny)}${what}` };
}

// Traffic provenance line. Manual delay assumptions are never described as traffic.
function trafficLine(tr, ny) {
  if (!tr) return '';
  if (!tr.retrievedAt) return `<span class="traffic-line warn" id="traffic-prov">Traffic: ${esc(tr.provider)} unavailable — ${esc(tr.error || 'no data')} Free-flow routing used instead.</span>`;
  const min = (s) => (s == null ? 'n/a' : formatDuration(Math.max(0, s)));
  const ff = tr.freeFlowSec != null ? `free-flow ${min(tr.freeFlowSec)}` : tr.typicalSec != null ? `typical ${min(tr.typicalSec)} (no free-flow figure from ${esc(tr.provider)})` : 'free-flow n/a';
  const dl = tr.trafficDelaySec != null ? `traffic delay ${tr.trafficDelaySec < 0 ? '−' : '+'}${min(Math.abs(tr.trafficDelaySec))}` : 'traffic delay n/a';
  return `<span class="traffic-line" id="traffic-prov">Traffic: <strong>${esc(tr.provider)} · ${esc(tr.mode)}</strong> — ${esc(MODE_LABEL[tr.mode])}; ${esc(tr.timing)}. Retrieved ${esc(ny(tr.retrievedAt))}. With traffic ${min(tr.totalSec)} vs ${ff}; ${dl}.</span>`;
}

function renderProvenance() {
  const m = state.model;
  const b = $('provenance');
  b.hidden = false;
  const banner = $('snapshot-banner');
  const pv = provHtml();
  $('prov').className = `prov ${pv.cls}`;
  $('prov').innerHTML = pv.html;
  if (m.source.kind === 'synthetic') {
    b.className = 'badge synthetic';
    b.textContent = 'Manual demo · synthetic data';
    banner.hidden = true;
    return;
  }
  if (m.source.kind === 'snapshot') {
    b.className = 'badge snapshot';
    b.textContent = 'Recorded snapshot';
    banner.hidden = false;
    banner.innerHTML = `<strong>Recorded snapshot — not current conditions.</strong> Press “See my drive” for a fresh real-data plan.`;
  } else {
    b.className = 'badge live';
    b.textContent = `Live forecast · ${m.route.engine} route`;
    const msgs = [];
    const trWarn = m.warnings.find((w) => w.startsWith('Traffic-aware routing failed'));
    if (trWarn) msgs.push(trWarn);
    if (m.warnings.some((w) => w !== trWarn)) msgs.push(`Primary routing service unavailable; used ${m.route.engine} instead.`);
    banner.hidden = !msgs.length;
    banner.textContent = msgs.join(' ');
  }
}

function kpi(cls, label, value, sub, extra = '') {
  return `<div class="kpi ${cls}"><div class="k-label">${esc(label)}</div><div class="k-value">${esc(value)}</div><div class="k-sub">${esc(sub)}${extra ? ` <span class="k-terrain">${esc(extra)}</span>` : ''}</div></div>`;
}
// Glare KPI subtext suffix, only after a finished terrain check for the current evaluation.
function terrainKpiSuffix() {
  const tc = state.terrainCheck;
  if (tc?.status !== 'done' || (tc.adj && tc.adj.ev !== state.ev)) return '';
  return terrainKpiNote(tc.adj, { failed: tc.failed });
}

function renderKpis() {
  const { model, ev } = state;
  const t = ev.totals;
  const glareStrong = t.expectedGlareMin[2] + t.expectedGlareMin[3];
  const glareGeo = t.glareMin[1] + t.glareMin[2] + t.glareMin[3];
  const o = tripOpts();
  const breaksNote = [o.breaks === 'none' ? 'no stops' : `incl. ${BREAK_PLANS[o.breaks].label} breaks`, ev.delay?.minutes ? `+${formatDuration(ev.delay.extraSec)} assumed delay` : ''].filter(Boolean).join(' · ');
  $('kpis').innerHTML = [
    kpi('time', ev.delay?.minutes ? 'Drive + delay' : 'Drive', formatDuration(ev.movingSec, { compact: true }), `${fmt.dist(model.route.totalDistM)} · ${breaksNote}`),
    kpi('time', 'Arrive', formatClock(ev.arrivalUtc, model.destTz, { weekday: false }), `${new Intl.DateTimeFormat('en-US', { timeZone: model.destTz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ev.arrivalUtc))} · ${model.destLabel}`),
    kpi(
      'glare',
      'Sun glare',
      glareStrong >= 1 ? `${Math.round(glareStrong)} min` : t.glareMin[2] + t.glareMin[3] >= 1 ? 'Softened' : glareGeo >= 1 ? 'Mild only' : 'None',
      glareStrong >= 1 || glareGeo < 1
        ? glareGeo >= 1 ? `strong/severe · ${Math.round(glareGeo)} min sun in view` : 'sun never in your eyes'
        : t.glareMin[2] + t.glareMin[3] >= 1 ? `by clouds · ${Math.round(t.glareMin[2] + t.glareMin[3])} min low sun ahead` : `${Math.round(glareGeo)} min sun in view`,
      terrainKpiSuffix()
    ),
    kpi('night', 'After dark', ev.totals.nightMin >= 1 ? formatDuration(ev.totals.nightMin * 60, { compact: true }) : 'None', `${Math.round((ev.totals.nightMin / (ev.driveSec / 60)) * 100)}% of the drive`),
    kpi('wet', 'Wet / snowy', t.wetMin >= 1 ? formatDuration(t.wetMin * 60, { compact: true }) : 'Dry', t.snowMin >= 1 ? `${Math.round(t.snowMin)} min snow/ice` : t.missingMin > 1 ? `${Math.round(t.missingMin)} min no forecast` : model.source.kind === 'synthetic' ? 'scenario precipitation' : 'forecast precipitation'),
    kpi('temp', 'Temperature', ev.minTemp == null ? '—' : `${fmt.temp(ev.minTemp)} – ${fmt.temp(ev.maxTemp)}`, ev.maxCrossMph ? `crosswind gusts to ${fmt.speedMph(ev.maxCrossMph)}` : ''),
  ].join('');
}

function renderAdvice() {
  const list = $('advice');
  if (!state.recs.length) {
    list.innerHTML = '<li class="rec-empty">No notable glare, weather or darkness on this drive. Have a good trip!</li>';
    return;
  }
  list.innerHTML = state.recs
    .map(
      (r, i) => `<li class="rec ${r.priority}" data-i="${i}" tabindex="0" aria-label="${esc(r.title)}">
        <div class="rec-head"><span class="rec-icon">${ICONS[r.kind] || ICONS.data}</span>
          <div><h3>${esc(r.title)}</h3><div class="rec-when">${esc(r.when)}</div><div class="rec-where">${esc(r.where)}</div></div></div>
        <p class="rec-why">${esc(r.why)}</p>
        <ul>${r.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        ${r.kind === 'glare' && r.range ? terrainHtml(r.range[0]) : ''}
        ${r.applyDepartureUtc ? `<button type="button" class="ghost small apply" data-apply="${r.applyDepartureUtc}">Try this departure</button>` : ''}
      </li>`
    )
    .join('');
  list.querySelectorAll('.rec').forEach((li) => {
    const activate = () => focusRec(Number(li.dataset.i));
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-apply], .rec-terrain')) return;
      activate();
    });
    li.addEventListener('keydown', (e) => {
      if (e.target.closest('[data-apply], .rec-terrain')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
  list.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => applyDeparture(Number(b.dataset.apply))));
  bindTerrainControls();
}

// ---------- terrain check (approximate, separate from the glare score) ----------
// On demand by default: it loads AWS Terrain Tiles (a separate online dependency, also in synthetic mode).
// Optional auto-run after each evaluation only when the user ticked "Check terrain automatically"
// (localStorage 'glarepilot.terrainAuto' = '1', stored only while ticked).
// It never changes r.glare / r.expected, KPI values, advice severity, the exposure score or the optimizer:
// terrain-adjusted glare lives in state.terrainCheck.adj (keyed by sample index, see lib/terrainglare.js).
// NOTE: resetTerrainCheck()/terrainHtml() also run during module start-up (demo boot), before later
// module-level let/const bindings exist, so the auto preference lives in function scope / on state.
function terrainAutoKey() {
  return 'glarepilot.terrainAuto';
}
function terrainAuto() {
  try {
    return localStorage.getItem(terrainAutoKey()) === '1';
  } catch {
    return false;
  }
}
function setTerrainAuto(on) {
  try {
    if (on) localStorage.setItem(terrainAutoKey(), '1');
    else localStorage.removeItem(terrainAutoKey());
  } catch {
    /* storage unavailable: setting lasts for this page only */
  }
  state.terrainAutoSession = on;
}
function autoOn() {
  return state.terrainAutoSession ?? terrainAuto();
}
function resetTerrainCheck({ auto = true } = {}) {
  state.terrainCheck?.ctrl?.abort();
  const tc = { status: 'idle', results: new Map(), ctrl: null, adj: null, failed: false };
  state.terrainCheck = tc;
  // evaluate() renders right after this reset; start the automatic check afterwards if enabled.
  if (auto && autoOn()) setTimeout(() => state.terrainCheck === tc && tc.status === 'idle' && ['live', 'snapshot', 'synthetic'].includes(state.model?.source?.kind) && runTerrainCheck());
}
function terrainHtml(a) {
  const tc = state.terrainCheck || { status: 'idle', results: new Map() };
  const note = esc(TERRAIN_SOURCE_NOTE);
  let body;
  if (tc.status === 'pending') body = '<span class="terrain-pending">Checking terrain…</span>';
  else if (tc.status === 'done') {
    const r = tc.results.get(a);
    const adjLine = terrainAdjustedLine(tc.adj?.windows.get(a));
    body = `<span class="terrain-${esc(r?.status || 'unknown')}">${esc(terrainLine(r))}</span>${adjLine ? `<div class="terrain-adjusted">${esc(adjLine)}</div>` : ''}`;
  } else body = '<button type="button" class="ghost small" data-terrain-run>Check terrain (approximate)</button> <span class="fineprint">loads elevation tiles</span>';
  const first = state.recs.find((r) => r.kind === 'glare' && r.range)?.range[0] === a;
  const autoBox = first ? `<label class="terrain-auto fineprint"><input type="checkbox" data-terrain-auto${autoOn() ? ' checked' : ''}> Check terrain automatically after each plan</label>` : '';
  return `<div class="rec-terrain" data-terrain="${a}" title="${note}" aria-live="polite">${body}${autoBox}<div class="fineprint">${note}.</div></div>`;
}
function bindTerrainControls() {
  document.querySelectorAll('#advice [data-terrain-run]').forEach((b) => b.addEventListener('click', () => runTerrainCheck()));
  document.querySelectorAll('#advice [data-terrain-auto]').forEach((b) =>
    b.addEventListener('change', () => {
      setTerrainAuto(b.checked);
      if (b.checked && state.terrainCheck?.status === 'idle') runTerrainCheck();
    })
  );
}
function updateTerrainLines() {
  document.querySelectorAll('#advice [data-terrain]').forEach((el) => {
    el.outerHTML = terrainHtml(Number(el.dataset.terrain));
  });
  bindTerrainControls();
}
async function runTerrainCheck() {
  const m = state.model;
  const ev = state.ev;
  if (!m || !ev || state.terrainCheck?.status === 'pending') return;
  const descs = state.recs.filter((r) => r.kind === 'glare' && r.range).map((r) => describeGlareWindow(m, ev, r.range));
  if (!descs.length) return;
  resetTerrainCheck({ auto: false });
  const tc = state.terrainCheck;
  tc.status = 'pending';
  tc.ctrl = new AbortController();
  updateTerrainLines();
  // Reuse decoded DEM tiles across re-evaluations of the same route; drop them for a new route.
  if (state.demSampler && state.demRoute !== m.route) state.demSampler.clear();
  state.demSampler ??= createDemSampler({ zoom: 12 });
  state.demRoute = m.route;
  try {
    const res = await checkGlareWindows(m, ev, descs, { sampleElevation: state.demSampler, signal: tc.ctrl.signal, maxTotalRays: MAX_TOTAL_RAYS });
    if (state.terrainCheck !== tc) return; // stale (trip or departure changed)
    for (const r of res) tc.results.set(r.a, r);
    tc.adj = terrainAdjustedGlare(ev, res);
    tc.failed = res.every((r) => r.status === 'unknown' && !r.samples.some((x) => x.coverage > 0));
  } catch (e) {
    if (e?.name === 'AbortError' || state.terrainCheck !== tc) return;
    tc.failed = true;
  }
  tc.status = 'done';
  updateTerrainLines();
  renderKpis();
  timeline?.render({ terrain: tc.adj });
  announce(`Terrain check finished (approximate). ${terrainKpiNote(tc.adj, { failed: tc.failed }).replace(/^\(|\)$/g, '')}.`);
}

function focusRec(i) {
  const r = state.recs[i];
  state.activeRec = i;
  document.querySelectorAll('.rec').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === i));
  mapView.highlight(state.model, r.range);
  if (r.focus != null) userSelect(r.focus, { range: r.range });
  else timeline.render({ range: null });
  if (window.matchMedia('(max-width: 1100px)').matches) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyDeparture(utc) {
  setDeparture(utc, state.model.originTz);
  evaluate(utc);
  $('kpis').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Shared trip/time state for the three views (2D / 3D chase / 3D terrain): state.sel is the
// playback position, state.preview the previewed sample (null = at playback position) and
// state.level the 3D camera level. Previews made in either 3D view land here, so the 2D map
// keeps the dashed preview pin and every view shows "Previewing ahead +N min".
let liveTimer = 0;
let liveText = '';
let liveLast = 0;
function announceView(text) {
  // throttled polite announcement of the 3D HUD state (at most one per 1.5 s, trailing)
  liveText = text;
  if (liveTimer) return;
  const wait = Math.max(0, 1500 - (Date.now() - liveLast));
  liveTimer = setTimeout(() => {
    liveTimer = 0;
    liveLast = Date.now();
    const el = $('view-live');
    if (el && el.textContent !== liveText) el.textContent = liveText;
  }, wait);
}
function renderViewPreview() {
  const box = $('view-preview');
  if (!box || !state.model) return;
  const i = state.preview;
  if (i == null || i === state.sel) {
    box.hidden = true;
    return;
  }
  const { model, ev } = state;
  const dt = Math.abs(ev.rows[i].t - ev.rows[state.sel].t) / 1000;
  const dist = Math.abs(model.samples[i].distM - model.samples[state.sel].distM);
  box.querySelector('[data-hud="state"]').textContent = `Previewing ${i > state.sel ? 'ahead: +' : 'behind: −'}${formatDuration(dt)} · ${fmt.dist(dist)}`;
  box.hidden = state.view !== '2d';
}

function previewAt(i) {
  const { model, ev } = state;
  state.preview = i == null || i === state.sel ? null : i;
  renderViewPreview();
  if (i == null || i === state.sel) {
    mapView.setPreview(null);
    const row = ev.rows[state.sel];
    renderMoment(row, model.samples[state.sel]);
    $('compass').innerHTML = `${compassSvg(row, model.samples[state.sel])}<div class="compass-text">${compassText(row, model.samples[state.sel])}</div>`;
    return;
  }
  mapView.setPreview(model.samples[i]);
  renderMoment(ev.rows[i], model.samples[i], { preview: true });
  $('compass').innerHTML = `${compassSvg(ev.rows[i], model.samples[i])}<div class="compass-text">${compassText(ev.rows[i], model.samples[i])}</div>`;
}

function select(i, { range, fromChase = false, fromTerrain = false } = {}) {
  const { model, ev } = state;
  state.sel = Math.max(0, Math.min(ev.rows.length - 1, i));
  state.preview = null; // a new playback position ends any preview in every view
  if (!fromChase) chase?.setCurrent(state.sel);
  if (!fromTerrain) terrain?.setCurrent(state.sel); // terrain view
  mapView.setPreview(null);
  renderViewPreview();
  const row = ev.rows[state.sel];
  const smp = model.samples[state.sel];
  $('scrub').value = String(state.sel);
  $('scrub').setAttribute('aria-valuetext', `${formatClock(row.t, row.timezone || model.originTz)}, ${placeLabel(model, smp).text}`);
  timeline.render({ ev, model, fmt, sel: state.sel, range: range ?? (state.activeRec != null ? state.recs[state.activeRec]?.range : null) });
  mapView.setCar(smp);
  renderMoment(row, smp);
  $('compass').innerHTML = `${compassSvg(row, smp)}<div class="compass-text">${compassText(row, smp)}</div>`;
}

function renderMoment(row, smp, { preview = false } = {}) {
  const { model, ev } = state;
  const tz = row.timezone || model.originTz;
  const where = placeLabel(model, smp);
  const wx = row.wx;
  const chips = [`<span class="chip ${row.phase}">${PHASE_LABEL[row.phase]}</span>`];
  if (row.glare.severity) chips.push(`<span class="chip g${row.expected || 1}">${GLARE_LABEL[row.glare.severity]}${row.expected < row.glare.severity ? ' · softened by clouds' : ''}</span>`);
  const cat = weatherCategory(row);
  chips.push(`<span class="chip ${cat === 'dry' ? '' : cat === 'heavy' ? 'rain' : cat === 'fog' ? 'nodata' : cat}">${wx ? esc(describeCode(wx.weatherCode)) : WEATHER_LABEL.nodata}</span>`);
  const cross = row.hz.cross;
  const facts = wx
    ? [
        ['Temperature', fmt.temp(wx.temperature)],
        ['Precipitation', `${fmt.precip(wx.precipitation)}/h${wx.precipProbability != null ? ` · ${Math.round(wx.precipProbability)}%` : ''}`],
        ['Snowfall', wx.snowfall ? `${fmt.snow(wx.snowfall)}/h` : 'None'],
        ['Wind', `${fmt.speed(wx.windSpeed)} from ${wx.windDirection == null ? '—' : compass(wx.windDirection)}`],
        ['Gusts', fmt.speed(wx.windGusts)],
        ['Crosswind (gust)', cross?.crosswind == null ? '—' : `${fmt.speedMph(row.hz.crossMph)} from ${cross.side}`],
        ['Cloud cover', wx.cloudCover == null ? '—' : `${Math.round(wx.cloudCover)}%`],
        ['Visibility', wx.visibility == null ? '—' : fmt.dist(wx.visibility)],
      ]
    : [['Forecast', 'Outside the available forecast window']];
  const conds = rowConditions(row).filter((c) => c !== 'night');
  for (const c of conds) if (c === 'jam') chips.push(`<span class="chip" style="background:#fff0f6;color:#a61e4d">Assumed delay${model.source.kind === 'synthetic' ? ' (scenario)' : ''}</span>`);
  const srcNote = model.source.kind === 'synthetic' ? 'Hand-set synthetic value for this scenario — not a forecast.' : wx ? `Open-Meteo model forecast for ${esc(formatClock(wx.validTime, tz, { weekday: false }))} (nearest checkpoint). Not an observation.` : '';
  $('moment').innerHTML = `${preview ? '<div class="chip" style="display:inline-block;margin-bottom:6px;background:#fff4e6;color:#a34b00">Preview ahead · current position unchanged</div>' : ''}<div class="moment-head"><div><div class="moment-time">${esc(formatClock(row.t, tz))}</div>
      <div class="moment-where">${esc(where.text)} · ${formatDuration((row.t - ev.departureUtc) / 1000)} into the trip</div></div></div>
    <div class="chips">${chips.join('')}</div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="fineprint">${srcNote}${row.delaySec ? ` Arrival here includes ${formatDuration(row.delaySec)} of assumed delay.` : ''}</p>`;
}

function renderOptimizer() {
  const { opt, model } = state;
  const avail = opt.candidates.filter((c) => c.available);
  const max = Math.max(1, ...avail.map((c) => c.score));
  const bars = opt.candidates
    .map((c) => {
      const label = c.offsetMin === 0 ? 'Plan' : `${c.offsetMin > 0 ? '+' : '−'}${Math.abs(c.offsetMin) / 60}h`;
      const clock = formatClock(c.departureUtc, model.originTz, { weekday: false, zone: false });
      if (!c.available) return `<button type="button" class="opt-bar na" disabled title="${clock}: ${c.reason}" aria-label="Leave ${clock}: unavailable, ${c.reason}"><div class="bar"></div><small>${label}</small></button>`;
      const cls = [c.offsetMin === 0 ? 'current' : '', opt.best && c.offsetMin === opt.best.offsetMin && opt.worthIt ? 'best' : ''].join(' ');
      const h = Math.max(3, (c.score / max) * 100);
      const tip = `Leave ${clock}: strong glare ${Math.round(c.glareMin)} min, wet ${Math.round(c.wetMin)} min, dark ${Math.round(c.nightMin)} min (score ${Math.round(c.score)})`;
      return `<button type="button" class="opt-bar ${cls}" data-dep="${c.departureUtc}" title="${tip}" aria-label="${tip}"><div class="bar" style="height:${h}%"></div><small>${label}</small></button>`;
    })
    .join('');
  const b = opt.best;
  const summary = opt.worthIt
    ? `Leaving at <strong>${esc(formatClock(b.departureUtc, model.originTz))}</strong> lowers the exposure score from ${Math.round(opt.current.score)} to ${Math.round(b.score)}. Tap any bar to re-plan instantly.`
    : `Your planned time is already about as good as it gets within ±3 h (score ${Math.round(opt.current.score)}). Tap a bar to compare.`;
  const trNote = model.source.traffic?.retrievedAt ? `<p class="fineprint" id="opt-traffic-note">${esc(OPTIMIZER_TRAFFIC_NOTE)}</p>` : '';
  $('optimizer').innerHTML = `<div class="opt">${bars}</div><p class="opt-summary">${summary}</p>${trNote}`;
  $('optimizer').querySelectorAll('[data-dep]').forEach((el) => el.addEventListener('click', () => applyDeparture(Number(el.dataset.dep))));
}

function renderTable() {
  const { model, ev } = state;
  const head = '<thead><tr><th>Time</th><th>Where</th><th>Weather</th><th>Temp</th><th>Precip</th><th>Wind / gust</th><th>Crosswind</th><th>Cloud</th><th>Visibility</th><th>Sun</th><th>Glare</th></tr></thead>';
  const body = model.pointIdx
    .map((i) => {
      const r = ev.rows[i];
      const s = model.samples[i];
      const wx = r.wx;
      return `<tr><td>${esc(formatClock(r.t, r.timezone || model.originTz))}</td><td>${esc(placeLabel(model, s).text)}</td>
        <td>${wx ? esc(describeCode(wx.weatherCode)) : 'No forecast'}</td><td>${fmt.temp(wx?.temperature)}</td><td>${wx ? fmt.precip(wx.precipitation) : '—'}</td>
        <td>${wx ? `${fmt.speed(wx.windSpeed)} / ${fmt.speed(wx.windGusts)}` : '—'}</td><td>${wx ? fmt.speedMph(r.hz.crossMph) : '—'}</td>
        <td>${wx?.cloudCover == null ? '—' : `${Math.round(wx.cloudCover)}%`}</td><td>${wx?.visibility == null ? '—' : fmt.dist(wx.visibility)}</td>
        <td>${r.sun.altitude.toFixed(0)}° ${PHASE_LABEL[r.phase]}</td><td>${GLARE_LABEL[r.glare.severity]}</td></tr>`;
    })
    .join('');
  $('points-table').innerHTML = `<caption class="sr-only">Forecast checkpoints along the route</caption>${head}<tbody>${body}</tbody>`;
}

// ---------- controls ----------
$('trip-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const req = await readForm();
    plan(req);
  } catch (err) {
    showFormError(err.message, err.field);
  }
});
$('retry').addEventListener('click', () => state.lastRequest && plan(state.lastRequest));
$('scrub').addEventListener('input', (e) => userSelect(Number(e.target.value)));
document.querySelectorAll('[data-layer]').forEach((b) =>
  b.addEventListener('click', () => {
    state.layer = b.dataset.layer;
    document.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('legend').innerHTML = legendHtml(state.layer);
    if (state.model) mapView.recolor(state.model, state.ev, state.layer);
  })
);
document.querySelectorAll('[data-units]').forEach((b) =>
  b.addEventListener('click', () => {
    state.units = b.dataset.units;
    fmt = makeFormatter(state.units);
    document.querySelectorAll('[data-units]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (state.model) {
      state.recs = buildAdvice(state.model, state.ev, { vehicle: tripOpts().vehicle, optimizer: state.opt, unitsFmt: fmt, synthetic: state.model.source.kind === 'synthetic' });
      renderKpis();
      renderDelayCard();
      renderAdvice();
      renderTable();
      select(state.sel);
    }
  })
);
for (const id of ['vehicle', 'breaks', 'delay-min', 'delay-where']) {
  $(id).addEventListener('change', () => {
    if (state.model && !state.inflight) evaluate(state.ev.departureUtc);
  });
}

// ---------- delay impact ----------
function renderDelayCard() {
  const card = $('delay-card');
  const ev = state.ev;
  const base = state.baseline;
  if (!base || !ev.delay?.minutes) {
    card.hidden = true;
    return;
  }
  const m = state.model;
  const strong = (e) => e.totals.expectedGlareMin[2] + e.totals.expectedGlareMin[3];
  let hourShift = 0;
  for (const i of m.pointIdx) {
    if (ev.rows[i].wx && base.rows[i].wx && ev.rows[i].wx.validTime !== base.rows[i].wx.validTime) hourShift++;
  }
  const cell = (label, a, b, unit = 'min', lowerBetter = true) => {
    const d = Math.round(b) - Math.round(a);
    const cls = d === 0 ? '' : (d > 0) === lowerBetter ? 'worse' : 'better';
    return `<div><dt>${label}</dt><dd class="${cls}">${Math.round(a)} → ${Math.round(b)} ${unit}</dd></div>`;
  };
  const synthetic = m.source.kind === 'synthetic';
  card.hidden = false;
  card.innerHTML = `<div class="card-head"><h3 class="card-title">What the assumed delay changes</h3><span class="fineprint">${synthetic ? 'Scenario delay (hand-set)' : 'Your assumption'} — not measured or predicted traffic</span></div>
    <p class="fineprint" style="margin-top:0">+${formatDuration(ev.delay.extraSec)} ${esc(ev.delay.label)}. Every point after the slow stretch is reached later, so ${hourShift} of ${m.pointIdx.length} ${synthetic ? 'checkpoints read a different (hand-set) hour' : 'forecast checkpoints move to a different forecast hour'} and the sun angles are recomputed.</p>
    <dl class="delay-grid">
      <div><dt>Arrival</dt><dd class="worse">${esc(formatClock(base.arrivalUtc, m.destTz, { weekday: false }))} → ${esc(formatClock(ev.arrivalUtc, m.destTz, { weekday: false }))}</dd></div>
      ${cell('Wet roads', base.totals.wetMin, ev.totals.wetMin)}
      ${cell('Strong glare', strong(base), strong(ev))}
      ${cell('After dark', base.totals.nightMin, ev.totals.nightMin)}
      ${cell('Strong crosswind', base.totals.windMin, ev.totals.windMin)}
      ${cell('Snow / ice', base.totals.snowMin + base.totals.iceMin, ev.totals.snowMin + ev.totals.iceMin)}
    </dl>`;
}

// ---------- modes, scenarios, views, motion ----------
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('scenario-card').hidden = mode !== 'demo';
  $('trip-form').hidden = mode === 'demo';
  document.querySelector('.presets-card').hidden = mode === 'demo';
  if (mode === 'real' && state.model?.source.kind === 'synthetic') {
    state.model = null;
    state.scenario = null;
    renderScenarioButtons();
    show('empty');
    $('provenance').hidden = true;
  }
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function renderScenarioButtons() {
  const icon = { 'storm-crosswind': 'rain', 'sunset-glare': 'glare', 'snow-fog-night': 'snow', 'congestion-shift': 'jam' };
  $('scenarios').innerHTML = SCENARIOS.map(
    (x) => `<button type="button" class="scenario" data-scenario="${x.id}" aria-pressed="${state.scenario === x.id}"><span class="cond-badge static" style="--ring:${COND_RING[icon[x.id]]};width:36px;height:36px">${COND_SVG[icon[x.id]]}</span><span><strong>${esc(x.title)}</strong><span class="sub">${esc(x.subtitle)} · synthetic</span></span></button>`
  ).join('');
  $('scenarios').querySelectorAll('[data-scenario]').forEach((b) => b.addEventListener('click', () => openScenario(b.dataset.scenario)));
}

async function openScenario(id) {
  const scn = SCENARIOS.find((x) => x.id === id);
  state.inflight?.abort();
  resetOverlays();
  setMode('demo');
  if (!scn) {
    $('error-msg').textContent = `There is no manual demo scenario called “${id}”. Available: ${SCENARIOS.map((x) => x.id).join(', ')}`;
    show('error');
    return;
  }
  const ctrl = new AbortController();
  state.inflight = ctrl;
  show('loading');
  setStage('compute');
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${scn.route}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`route file missing (HTTP ${res.status})`);
    const snap = await res.json();
    if (ctrl.signal.aborted) return;
    const built = buildScenarioModel(scn, snap, places);
    state.model = built.model;
    state.scenarioNow = built.nowMs;
    state.scenario = id;
    renderScenarioButtons();
    show('result');
    evaluate(built.departureUtc, { fit: true });
    focusResults();
  } catch (e) {
    if (ctrl.signal.aborted) return;
    $('error-msg').textContent = `Could not open the demo scenario: ${e.message}`;
    show('error');
  } finally {
    if (state.inflight === ctrl) state.inflight = null;
  }
}

function setView(view) {
  const prev = state.view;
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  const is3d = view === '3d';
  const motionOn = !reducedMotion() && !document.body.classList.contains('motion-off');
  // short cross-fade of the entering view (instant with reduced motion / Animation off)
  const fadeIn = (el) => {
    el.classList.remove('view-enter');
    void el.offsetWidth;
    if (motionOn) el.classList.add('view-enter');
  };
  // terrain view: hide 2D map, chase and layer controls; lazily create the MapLibre view
  const isTerrain = view === 'terrain';
  $('terrain').hidden = !isTerrain;
  $('view-preview').hidden = true;
  if (isTerrain) {
    // 2D → terrain: the MapLibre camera flies in from the 2D map's centre/zoom
    let flyFrom = null;
    if (prev === '2d' && mapView?.map) {
      try {
        const c = mapView.map.getCenter();
        flyFrom = { center: [c.lng, c.lat], zoom: Math.max(1, mapView.map.getZoom() - 1) }; // Leaflet 256 px → MapLibre 512 px tiles
      } catch { /* ignore */ }
    }
    $('map').hidden = true;
    $('chase').hidden = true;
    document.querySelector('.map-toolbar [aria-label="Map layer"]').hidden = true;
    $('legend').hidden = true;
    chase?.show(false);
    fadeIn($('terrain'));
    openTerrain({ flyFrom });
    return;
  }
  terrain?.show(false);
  if (view === '2d') $('terrain-msg').hidden = true; // the WebGL fallback note only explains the 3D chase fallback
  $('map').hidden = is3d;
  $('chase').hidden = !is3d;
  document.querySelector('.map-toolbar [aria-label="Map layer"]').hidden = is3d;
  $('legend').hidden = is3d;
  fadeIn(is3d ? $('chase') : $('map'));
  if (is3d) {
    chase?.setCurrent(state.sel);
    chase?.setLevel(state.level ?? 1, { silent: true });
    chase?.setPreviewIdx(state.preview ?? null);
    chase?.show(true);
    $('chase').querySelector('canvas').focus({ preventScroll: true });
  } else {
    chase?.show(false);
    // keep a preview made in either 3D view: the 2D map shows its dashed pin and label
    previewAt(state.preview ?? null);
    requestAnimationFrame(() => mapView?.invalidate());
  }
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('view-preview').querySelector('[data-act="return"]').addEventListener('click', () => {
  chase?.setPreviewIdx(null);
  terrain?.setPreviewIdx(null);
  previewAt(null);
});

// ---------- terrain view (begin) ----------
const TERRAIN_FALLBACK = '3D terrain needs WebGL and online tiles — showing the lightweight 3D chase preview instead';
function openTerrain({ flyFrom = null } = {}) {
  if (terrain) {
    gpsSyncTerrain(); // GPS follow label (b3-gps)
    if (state.model) {
      terrain.setTrip(state.model, state.ev);
      terrain.setCurrent(state.sel);
      terrain.setLevel(state.level ?? 1, { silent: true });
      terrain.setPreviewIdx(state.preview ?? null);
    }
    terrain.show(true, { flyFrom });
    $('terrain').querySelector('.terrain-map')?.focus({ preventScroll: true });
    return;
  }
  if (terrainLoading) return;
  $('terrain-msg').hidden = true;
  terrainLoading = import('./ui/terrain3d.js')
    .then((m) =>
      m.createTerrainView($('terrain'), {
        onAdvance: (i) => { gpsUserMoved(); select(i, { fromTerrain: true }); },
        onPreview: previewAt,
        onLevel: (l) => {
          state.level = l;
          chase?.setLevel(l, { silent: true });
        },
        onStatus: announceView,
        level: state.level ?? 1,
        getFmt: () => fmt,
        reducedMotion,
      })
    )
    .then((t) => {
      terrain = t;
      if (state.view === 'terrain') openTerrain({ flyFrom });
    })
    .catch((err) => {
      console.warn('terrain view unavailable:', err?.message || err);
      $('terrain').innerHTML = '';
      $('terrain-msg').textContent = TERRAIN_FALLBACK;
      $('terrain-msg').hidden = false;
      if (state.view === 'terrain') setView('3d');
    })
    .finally(() => {
      terrainLoading = null;
    });
}
// ---------- terrain view (end) ----------

function setMotion(on) {
  document.body.classList.toggle('motion-off', !on);
  const b = $('motion');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Animation: on' : reducedMotion() ? 'Animation: off (reduced motion)' : 'Animation: off';
  chase?.redraw();
}
$('motion').addEventListener('click', () => setMotion(document.body.classList.contains('motion-off')));
setMotion(!reducedMotion());

// ---------- optional "follow my location" (GPS) ----------
// Off by default; starts only on an explicit click. Fixes are snapped to the planned route in
// memory (lib/geo.js snapFix, with hysteresis) and then discarded: coordinates are never stored,
// logged or sent anywhere. The only place a fix lives is the 2D accuracy circle of the latest
// fix (an in-memory map layer), removed on Stop. Heading from consecutive fixes is NOT used for
// glare: conditions always stay the planned forecast for the trip timeline.
const GPS_FOLLOW_LABEL = "Following your location (GPS) — conditions are still the PLANNED forecast for this trip's timeline";
const GPS_WRONG_WAY = 'You seem to be moving against the planned direction';
const GPS_CHASE_TAG = 'Simulated playback of the planned route · not GPS';
let gpsWatch = null;
// In-memory only: the route sample index matched to the latest fix plus hysteresis counters
// (indices, no coordinates), keyed to the trip model they refer to.
const gps = { idx: null, paused: false, match: null, model: null };
/** A user-driven move (scrub, map/timeline/icon pick, advice, playback) pauses GPS following. */
function gpsUserMoved() {
  if (gpsWatch == null || gps.idx == null || gps.paused) return;
  gps.paused = true;
  gpsFollowing(false);
  $('gps-return').hidden = false;
  gpsStatus('GPS following paused while you explore the plan — “Return to my location” resumes it.');
}
function userSelect(i, opts) {
  gpsUserMoved();
  select(i, opts);
}
function gpsAcc(m) {
  return m == null || !(m > 0) ? '' : ` · accuracy ±${fmt.dist(m)}`;
}

function gpsStatus(msg, warn = false) {
  const el = $('gps-status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
}
function gpsLabel(wrongWay = false) {
  return wrongWay ? `${GPS_FOLLOW_LABEL} · ${GPS_WRONG_WAY}?` : GPS_FOLLOW_LABEL;
}
let gpsLabelNow = '';
/** Same follow label in every view: 3D chase HUD and (when created) the 3D terrain HUD. */
function gpsFollowing(on, wrongWay = false) {
  gpsLabelNow = on ? gpsLabel(wrongWay) : '';
  const hud = $('chase').querySelector('[data-hud="gps"]');
  hud.hidden = !on;
  hud.textContent = gpsLabelNow;
  $('chase').querySelector('.chase-tag').textContent = on ? 'Snapped to your GPS position on the planned route' : GPS_CHASE_TAG;
  gpsSyncTerrain();
}
function gpsSyncTerrain() {
  terrain?.setGpsLabel?.(gpsLabelNow);
}
function gpsStop(msg = '') {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  gps.idx = null;
  gps.paused = false;
  gps.match = null;
  gps.model = null;
  mapView?.clearAccuracy();
  $('gps-start').hidden = false;
  $('gps-stop').hidden = true;
  $('gps-return').hidden = true;
  gpsFollowing(false);
  gpsStatus(msg, Boolean(msg));
}
function gpsOnFix(pos) {
  if (gpsWatch == null) return; // a late fix after Stop is dropped
  const { model, ev } = state;
  const { latitude: lat, longitude: lon, accuracy: acc } = pos.coords;
  mapView?.setAccuracy(lat, lon, acc); // latest fix only, in-memory layer
  if (!model || !ev) {
    gpsFollowing(false);
    gpsStatus('Location received — plan or open a trip to follow it on the route.');
    return;
  }
  if (gps.model !== model) {
    gps.model = model;
    gps.match = null;
  }
  const at = new Date(pos.timestamp || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const r = snapFix(model.samples, { lat, lon, accuracy: acc }, gps.match);
  gps.match = r.state;
  if (r.status === 'none') return;
  if (r.status === 'imprecise') {
    gps.idx = null;
    gpsFollowing(false);
    gpsStatus(`Location too imprecise to place you on the route${gpsAcc(acc)} (fix ${at}) — position unchanged`, true);
    return;
  }
  if (r.status === 'off') {
    gps.idx = null;
    gpsFollowing(false);
    gpsStatus(`You are off this planned route (${(r.distM / 1609.344).toFixed(r.distM < 160934 ? 1 : 0)} mi away${gpsAcc(acc)}) — playback position unchanged`, true);
    return;
  }
  gps.idx = r.index;
  if (gps.paused) {
    gpsStatus(`GPS following paused while you explore the plan — latest fix ${at}${gpsAcc(acc)}. “Return to my location” resumes it.`);
    return;
  }
  gpsFollowing(true, r.wrongWay);
  const held = r.held ? ' · holding position (fix behind the route progress)' : '';
  gpsStatus(`${gpsLabel(r.wrongWay)} · fix ${at}${gpsAcc(acc)} · ${fmt.dist(r.distM)} from the route line${held}`);
  if (r.index !== state.sel) select(r.index);
}
function gpsOnError(err) {
  const msg =
    err.code === 1
      ? 'Location permission denied — the planned-route playback still works'
      : err.code === 3
        ? 'Location timed out — the planned-route playback still works'
        : 'Location unavailable — the planned-route playback still works';
  if (err.code === 1) gpsStop(msg);
  else {
    // Keep watching after a transient failure; the browser may deliver a fix later.
    gpsFollowing(false);
    gpsStatus(msg, true);
  }
}
$('gps-start').addEventListener('click', () => {
  if (!window.isSecureContext || !('geolocation' in navigator)) {
    gpsStatus('Location needs HTTPS and browser support', true);
    return;
  }
  if (gpsWatch != null) return;
  gpsStatus('Waiting for your location…');
  $('gps-start').hidden = true;
  $('gps-stop').hidden = false;
  try {
    gpsWatch = navigator.geolocation.watchPosition(gpsOnFix, gpsOnError, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 });
  } catch {
    gpsStop('Location needs HTTPS and browser support');
  }
});
$('gps-stop').addEventListener('click', () => gpsStop());
$('gps-return').addEventListener('click', () => {
  gps.paused = false;
  $('gps-return').hidden = true;
  if (gps.idx == null) {
    gpsStatus('Waiting for an on-route location fix…');
    return;
  }
  gpsFollowing(true);
  gpsStatus(GPS_FOLLOW_LABEL);
  select(gps.idx);
});

// ---------- presets & snapshots ----------
function renderPresets() {
  $('presets').innerHTML = PRESETS.map(
    (p) => `<button type="button" class="preset" data-preset="${p.id}"><span class="p-icon">${ICONS.sunPreset}</span><span><strong>${esc(p.title)}</strong><span>${esc(p.subtitle)} · tomorrow ${p.hour > 12 ? p.hour - 12 : p.hour}:${String(p.minute).padStart(2, '0')} ${p.hour >= 12 ? 'PM' : 'AM'}</span></span><span class="p-go" aria-hidden="true">›</span></button>`
  ).join('');
  $('presets').querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => runPreset(b.dataset.preset)));
}

function fillForm(origin, dest, dep) {
  originBox.set(origin);
  destBox.set(dest);
  setDeparture(dep, origin.timezone);
}

function runPreset(id) {
  setMode('real');
  const p = PRESETS.find((x) => x.id === id);
  const origin = PLACES[p.origin];
  const dest = PLACES[p.dest];
  const dep = nextDayAt(p.hour, p.minute, origin.timezone);
  fillForm(origin, dest, dep);
  plan({ origin, dest, departureUtc: dep, vehicle: $('vehicle').value, breaks: $('breaks').value });
}

async function openSnapshot(id = PRESETS[0].id) {
  setMode('real');
  const p = PRESETS.find((x) => x.id === id || x.snapshot === `${id}.json`);
  state.inflight?.abort();
  resetOverlays();
  const ctrl = new AbortController();
  state.inflight = ctrl;
  showFormError('');
  setBusy(true);
  show('loading');
  setStage('compute');
  try {
    if (!p) throw new Error(`there is no recorded snapshot called “${id}”. Available: ${PRESETS.map((x) => x.id).join(', ')}`);
    const res = await fetch(`${import.meta.env.BASE_URL}fixtures/${p.snapshot}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Snapshot file missing (HTTP ${res.status})`);
    const snap = await res.json();
    const model = fromSnapshot(snap, places);
    if (ctrl.signal.aborted) return;
    state.model = model;
    fillForm(model.origin, model.dest, snap.departureUtc);
    show('result');
    evaluate(snap.departureUtc, { fit: true });
    focusResults();
  } catch (e) {
    if (ctrl.signal.aborted) return;
    $('error-msg').textContent = `Could not open the recorded snapshot: ${e.message}`;
    show('error');
  } finally {
    if (state.inflight === ctrl) {
      state.inflight = null;
      setBusy(false);
    }
  }
}
$('use-snapshot').addEventListener('click', () => openSnapshot());
$('error-snapshot').addEventListener('click', () => openSnapshot(state.lastRequest ? PRESETS.find((p) => PLACES[p.origin].label === state.lastRequest.origin.label && PLACES[p.dest].label === state.lastRequest.dest.label)?.id : undefined));

// ---------- optional traffic provider key (never logged; memory only unless "Remember" is ticked) ----------
// Experimental: the provider-key UI is hidden (and no provider is ever called) unless the URL has
// ?experimental=traffic or localStorage 'glarepilot.experimental.traffic' is '1'.
const TRAFFIC_STORE = 'glarepilot.traffic.v1';
const TRAFFIC_EXPERIMENTAL = (() => {
  if (new URLSearchParams(location.search).get('experimental') === 'traffic') return true;
  try {
    return localStorage.getItem('glarepilot.experimental.traffic') === '1';
  } catch {
    return false;
  }
})();
$('traffic-cfg').hidden = !TRAFFIC_EXPERIMENTAL;
const trafficMem = { provider: 'none', key: '' };
function trafficConfig() {
  if (!TRAFFIC_EXPERIMENTAL) return null;
  return trafficMem.provider !== 'none' && trafficMem.key ? { provider: trafficMem.provider, apiKey: trafficMem.key } : null;
}
function saveTraffic() {
  trafficMem.provider = $('traffic-provider').value;
  trafficMem.key = $('traffic-key').value.trim();
  try {
    if ($('traffic-remember').checked && trafficMem.key) localStorage.setItem(TRAFFIC_STORE, JSON.stringify({ provider: trafficMem.provider, key: trafficMem.key }));
    else localStorage.removeItem(TRAFFIC_STORE);
  } catch {
    /* storage unavailable: memory only */
  }
}
if (TRAFFIC_EXPERIMENTAL) {
  try {
    const saved = JSON.parse(localStorage.getItem(TRAFFIC_STORE) || 'null');
    if (saved?.key) {
      $('traffic-provider').value = saved.provider;
      $('traffic-key').value = saved.key;
      $('traffic-remember').checked = true;
    }
  } catch {
    /* ignore */
  }
  saveTraffic();
  for (const id of ['traffic-provider', 'traffic-key', 'traffic-remember']) $(id).addEventListener('change', saveTraffic);
  $('traffic-key').addEventListener('input', saveTraffic);
  $('traffic-clear').addEventListener('click', () => {
    $('traffic-key').value = '';
    $('traffic-remember').checked = false;
    saveTraffic();
    announce('Traffic key cleared from this page and this device.');
  });
}

// ---------- keyless live overlays (NYC DOT speeds, WZDx work zones) — real-data plans only ----------
// Never fetched in synthetic demo or snapshot mode. They never change timing by themselves: the
// "Add as delay assumption" button copies a suggestion into the manual delay control.
state.overlay = { ctrl: null, raw: null, model: null, status: 'idle' };
let overlayLayer = null;
function resetOverlays() {
  state.overlay.ctrl?.abort();
  state.overlay = { ctrl: null, raw: null, model: null, status: 'idle' };
  renderOverlays();
}
// On demand (one click), like the terrain check: a plain plan makes no overlay requests.
async function startOverlays() {
  const model = state.model;
  if (!model || model.source.kind !== 'live' || state.overlay.status === 'pending') return;
  const departureUtc = state.ev.departureUtc;
  const ctrl = new AbortController();
  state.overlay = { ctrl, raw: null, model, status: 'pending' };
  renderOverlays();
  try {
    const raw = await fetchOverlays(model, { departureUtc, signal: ctrl.signal });
    if (state.overlay.ctrl !== ctrl || state.model !== model) return;
    state.overlay.raw = raw;
    state.overlay.status = 'done';
  } catch (e) {
    if (e?.name === 'AbortError' || state.overlay.ctrl !== ctrl) return;
    state.overlay.raw = { nyc: null, nycError: null, wz: [], wzErrors: [{ agency: 'Live overlay', error: e?.message || String(e) }] };
    state.overlay.status = 'done';
  }
  renderOverlays();
}
const ny = (t) => formatClock(t, 'America/New_York', { weekday: false });
function renderOverlays() {
  const box = $('overlay-notes');
  if (!box) return;
  if (mapView && !overlayLayer) overlayLayer = L.layerGroup().addTo(mapView.map);
  overlayLayer?.clearLayers();
  const o = state.overlay;
  if (!state.model || !state.ev || o.model !== state.model || state.model.source.kind !== 'live') {
    box.innerHTML = '';
    return;
  }
  if (o.status !== 'done' || !o.raw) {
    const src = overlaySources(state.model, state.ev.departureUtc);
    box.innerHTML = !src.length
      ? ''
      : o.status === 'pending'
        ? '<p class="ov-muted" id="ov-pending">Checking live overlays…</p>'
        : `<div class="ov-run"><button type="button" class="ghost small" id="ov-run">Check live traffic overlays</button> <span class="fineprint">${esc(src.join(' · '))} — current/reported conditions, never applied to timing automatically</span></div>`;
    $('ov-run')?.addEventListener('click', startOverlays);
    return;
  }
  const res = evaluateOverlays(o.raw, state.model, state.ev);
  const parts = [];
  if (res.speed) {
    const n = res.speed.slow.length;
    const sug = res.speed.suggestion;
    parts.push(`<div class="ov-line ov-speed" id="ov-speed"><strong>NYC DOT speeds as of ${esc(ny(res.speed.asOf))} (current, not a forecast)</strong>: ${n ? `${n} slow link${n > 1 ? 's' : ''} on your route — ${esc(res.speed.slow.slice(0, 3).map((l) => `${l.name} ${Math.round(l.speedMph)} mph`).join('; '))}${n > 3 ? '…' : ''}.` : 'no slow links on your route.'}${sug ? ` Rough extra time ≈ ${sug.estimatedMin} min. <button type="button" class="ghost small" id="ov-add-delay" data-min="${sug.minutes}" data-where="${sug.where}">Add as delay assumption (+${sug.minutes} min)</button>` : ''}</div>`);
    for (const l of res.speed.slow) {
      L.polyline(l.pts, { color: '#c92a2a', weight: 6, opacity: 0.85, className: 'ov-slow-line' }).bindTooltip(`NYC DOT: ${esc(l.name)} — ${esc(Math.round(l.speedMph))} mph as of ${esc(ny(res.speed.asOf))} (current, not a forecast)`).addTo(overlayLayer);
    }
  } else if (res.speedNote?.kind === 'stale') {
    parts.push(`<p class="ov-muted" id="ov-speed-stale">NYC DOT speeds are as of ${esc(ny(res.speedNote.asOf))}, too old to use.</p>`);
  }
  for (const z of res.zones) {
    const when = [z.start ? `from ${new Date(z.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '', z.end ? `until ${new Date(z.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'no end date given'].filter(Boolean).join(' ');
    const feedT = z.feedTime ? formatClock(z.feedTime, state.model.originTz, { weekday: false }) : 'unknown';
    const label = `Work zone reported by ${z.agency} (as of feed time ${feedT})`;
    parts.push(`<div class="ov-line ov-wz" data-wz="${esc(z.id)}"><strong>${esc(label)}</strong>: ${esc(z.road || 'road not named')}${z.direction ? ` ${esc(z.direction)}` : ''} — ${esc(z.description || 'work zone')} (${esc(when)}). Not a timing input.</div>`);
    L.marker([z.lat, z.lon], { icon: L.divIcon({ className: '', html: '<div class="wz-pin" aria-hidden="true">WZ</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: label, alt: `${label}: ${z.road}` })
      .bindTooltip(`${esc(label)}: ${esc(z.road)} — ${esc(z.description)}`)
      .addTo(overlayLayer);
  }
  for (const n of res.notes) parts.push(`<p class="ov-muted ov-err">${esc(n.text)}</p>`);
  box.innerHTML = parts.join('');
  $('ov-add-delay')?.addEventListener('click', (e) => {
    $('delay-min').value = e.currentTarget.dataset.min;
    $('delay-where').value = e.currentTarget.dataset.where;
    evaluate(state.ev.departureUtc);
    announce(`Added your delay assumption of ${e.currentTarget.dataset.min} min based on current NYC DOT speeds.`);
  });
}

// ---------- init ----------
renderPresets();
{
  const tz = 'America/New_York';
  fillForm(PLACES.amherst, PLACES.chicago, nextDayAt(8, 0, tz));
  const q = new URLSearchParams(location.search);
  renderScenarioButtons();
  if (q.get('demo')) openScenario(q.get('demo'));
  else if (q.get('mode') === 'demo') setMode('demo');
  else if (q.get('snapshot')) openSnapshot(q.get('snapshot'));
  else if (q.get('preset')) runPreset(q.get('preset'));
  if (q.get('view') === '3d') setView('3d');
  else if (q.get('view') === 'terrain') setView('terrain'); // terrain view
}
