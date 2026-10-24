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
import { compass, nearestSample } from './lib/geo.js';
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
  const ctrl = new AbortController();
  state.inflight = ctrl;
  state.lastRequest = req;
  showFormError('');
  setBusy(true);
  show('loading');
  setStage('route');
  try {
    const model = await buildTripModel({ ...req, breakPlan: BREAK_PLANS[req.breaks], places, signal: ctrl.signal, onStage: setStage });
    if (ctrl.signal.aborted) return;
    setStage('compute');
    await new Promise((r) => requestAnimationFrame(() => r()));
    state.model = model;
    show('result');
    evaluate(req.departureUtc, { fit: true });
    focusResults();
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

function renderAll({ fit = false } = {}) {
  const { model, ev } = state;
  mapView ??= createMap($('map'), { onPick: select });
  timeline ??= createTimeline($('timeline'), { onPick: select });
  condLayer ??= createConditionLayer(mapView.map, { onPick: (i, range) => select(i, { range }) });
  chase ??= createChase($('chase'), {
    onAdvance: (i) => select(i, { fromChase: true }),
    onPreview: previewAt,
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
  renderAdvice();
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
  const dly = ev.delay?.minutes ? ` plus your assumed ${formatDuration(ev.delay.extraSec)} delay ${ev.delay.label}` : '';
  const timing = `Each point uses conditions at its <strong>projected arrival time</strong>: departure ${esc(formatClock(ev.departureUtc, m.originTz))} + routed drive time${$('breaks').value !== 'none' && m.source.kind !== 'synthetic' ? ' + breaks' : ''}${esc(dly)}.`;
  const what = `<details><summary>What is forecast, computed, estimated or assumed?</summary><ul>
      <li><strong>Weather</strong>: ${m.source.kind === 'synthetic' ? 'hand-set synthetic values (not a forecast)' : 'Open-Meteo model forecast for the hour each point is reached (not an observation, not current conditions)'}.</li>
      <li><strong>Sun position and glare</strong>: computed with SunCalc for each point's future arrival time and heading.</li>
      <li><strong>Arrival times</strong>: estimated from ${esc(m.route.engine)} free-flow routing${dly ? ' plus your delay assumption' : ''}; no live or predicted traffic is used.</li>
      <li><strong>Observed / live data</strong>: none. GlarePilot does not show current conditions and does not track your location.</li></ul></details>`;
  if (m.source.kind === 'synthetic') {
    return { cls: 'synthetic', html: `<strong>Manual demo scenario — synthetic data.</strong> “${esc(m.source.title)}”: ${esc(m.source.story)} Weather${state.ev.delay?.minutes ? ' and the traffic delay are' : ' is'} hand-set on purpose; no weather, routing or traffic API is called (only map tiles load). Route geometry and routed times come from a recorded real ${esc(m.route.engine)} route captured ${esc(ny(m.source.routeCapturedAt))}. ${timing}${what}` };
  }
  if (m.source.kind === 'snapshot') {
    return { cls: 'snapshot', html: `<strong>Recorded real data — not current.</strong> ${esc(m.route.engine)} route and Open-Meteo forecast retrieved ${esc(ny(m.source.capturedAt))}. ${timing}${what}` };
  }
  return { cls: 'live', html: `<strong>Real-data plan.</strong> ${esc(m.route.engine)} route and Open-Meteo forecast retrieved ${esc(ny(m.source.capturedAt))}. Trip departs ${esc(formatClock(ev.departureUtc, m.originTz))} and arrives ${esc(formatClock(ev.arrivalUtc, m.destTz))}. ${timing}${what}` };
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
    banner.hidden = !m.warnings.length;
    banner.textContent = m.warnings.length ? `Primary routing service unavailable; used ${m.route.engine} instead.` : '';
  }
}

function kpi(cls, label, value, sub) {
  return `<div class="kpi ${cls}"><div class="k-label">${esc(label)}</div><div class="k-value">${esc(value)}</div><div class="k-sub">${esc(sub)}</div></div>`;
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
        : t.glareMin[2] + t.glareMin[3] >= 1 ? `by clouds · ${Math.round(t.glareMin[2] + t.glareMin[3])} min low sun ahead` : `${Math.round(glareGeo)} min sun in view`
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
        ${r.applyDepartureUtc ? `<button type="button" class="ghost small apply" data-apply="${r.applyDepartureUtc}">Try this departure</button>` : ''}
      </li>`
    )
    .join('');
  list.querySelectorAll('.rec').forEach((li) => {
    const activate = () => focusRec(Number(li.dataset.i));
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-apply]')) return;
      activate();
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
  list.querySelectorAll('[data-apply]').forEach((b) => b.addEventListener('click', () => applyDeparture(Number(b.dataset.apply))));
}

function focusRec(i) {
  const r = state.recs[i];
  state.activeRec = i;
  document.querySelectorAll('.rec').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === i));
  mapView.highlight(state.model, r.range);
  if (r.focus != null) select(r.focus, { range: r.range });
  else timeline.render({ range: null });
  if (window.matchMedia('(max-width: 1100px)').matches) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function applyDeparture(utc) {
  setDeparture(utc, state.model.originTz);
  evaluate(utc);
  $('kpis').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function previewAt(i) {
  const { model, ev } = state;
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

function select(i, { range, fromChase = false } = {}) {
  const { model, ev } = state;
  state.sel = Math.max(0, Math.min(ev.rows.length - 1, i));
  if (!fromChase) chase?.setCurrent(state.sel);
  mapView.setPreview(null);
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
  $('optimizer').innerHTML = `<div class="opt">${bars}</div><p class="opt-summary">${summary}</p>`;
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
$('scrub').addEventListener('input', (e) => select(Number(e.target.value)));
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
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  const is3d = view === '3d';
  $('map').hidden = is3d;
  $('chase').hidden = !is3d;
  document.querySelector('.map-toolbar [aria-label="Map layer"]').hidden = is3d;
  $('legend').hidden = is3d;
  const el = is3d ? $('chase') : $('map');
  el.classList.remove('view-enter');
  void el.offsetWidth;
  if (!reducedMotion()) el.classList.add('view-enter');
  if (is3d) {
    chase?.setCurrent(state.sel);
    chase?.show(true);
    $('chase').querySelector('canvas').focus({ preventScroll: true });
  } else {
    chase?.show(false);
    previewAt(null);
    requestAnimationFrame(() => mapView?.invalidate());
  }
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

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
// Off by default; starts only on an explicit click. Fixes are snapped to the nearest planned-route
// sample in memory and then discarded: coordinates are never stored, logged or sent anywhere.
const GPS_OFF_ROUTE_M = 2000;
const GPS_FOLLOW_LABEL = "Following your location (GPS) — conditions are still the PLANNED forecast for this trip's timeline";
const GPS_CHASE_TAG = 'Simulated playback of the planned route · not GPS';
let gpsWatch = null;

function gpsStatus(msg, warn = false) {
  const el = $('gps-status');
  el.textContent = msg;
  el.classList.toggle('warn', warn);
}
function gpsFollowing(on) {
  const hud = document.querySelector('[data-hud="gps"]');
  hud.hidden = !on;
  hud.textContent = on ? GPS_FOLLOW_LABEL : '';
  document.querySelector('.chase-tag').textContent = on ? 'Snapped to your GPS position on the planned route' : GPS_CHASE_TAG;
}
function gpsStop(msg = '') {
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = null;
  $('gps-start').hidden = false;
  $('gps-stop').hidden = true;
  gpsFollowing(false);
  gpsStatus(msg, Boolean(msg));
}
function gpsOnFix(pos) {
  const { model, ev } = state;
  if (!model || !ev) {
    gpsFollowing(false);
    gpsStatus('Location received — plan or open a trip to follow it on the route.');
    return;
  }
  const hit = nearestSample(model.samples, pos.coords.latitude, pos.coords.longitude);
  if (!hit) return;
  if (hit.distM > GPS_OFF_ROUTE_M) {
    gpsFollowing(false);
    gpsStatus(`You are off this planned route (${(hit.distM / 1609.344).toFixed(hit.distM < 160934 ? 1 : 0)} mi away) — playback position unchanged`, true);
    return;
  }
  gpsFollowing(true);
  gpsStatus(GPS_FOLLOW_LABEL);
  if (hit.index !== state.sel) select(hit.index);
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
}
