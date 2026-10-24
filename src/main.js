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
import { compass } from './lib/geo.js';
import { makeFormatter } from './lib/units.js';
import { PRESETS, PLACES } from './lib/presets.js';
import { createCombobox } from './ui/combobox.js';
import { createMap, legendHtml } from './ui/mapview.js';
import { createTimeline } from './ui/timeline.js';
import { compassSvg, compassText } from './ui/compass.js';
import { ICONS, GLARE_LABEL, PHASE_LABEL, WEATHER_LABEL, weatherCategory } from './ui/palette.js';

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
};
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

function evaluate(departureUtc, { fit = false } = {}) {
  const m = state.model;
  const vehicle = $('vehicle').value;
  const opts = { breakPlan: BREAK_PLANS[$('breaks').value], vehicle };
  const nowMs = m.source.kind === 'snapshot' ? m.source.capturedAt : Date.now();
  state.opt = optimizeDeparture(m, departureUtc, opts, { nowMs });
  state.ev = state.opt.base;
  state.glareWindows = state.ev.windows.glare.map((w) => describeGlareWindow(m, state.ev, w)).filter((d) => d.peakSeverity >= 2 || d.minutes >= 4);
  state.recs = buildAdvice(m, state.ev, { vehicle, optimizer: state.opt, unitsFmt: fmt });
  state.activeRec = null;
  // Start the cursor at the most important glare moment, else at departure.
  const top = state.glareWindows.slice().sort((a, b) => b.peakExpected - a.peakExpected || b.peakSeverity - a.peakSeverity)[0];
  state.sel = top ? top.peak : 0;
  renderAll({ fit });
  const ev = state.ev;
  announce(`Drive planned: ${formatDuration(ev.driveSec)} of driving, arriving ${formatClock(ev.arrivalUtc, m.destTz)}. ${state.recs.length} notes.`);
}

// ---------- rendering ----------
let mapView = null;
let timeline = null;

function renderAll({ fit = false } = {}) {
  const { model, ev } = state;
  mapView ??= createMap($('map'), { onPick: select });
  timeline ??= createTimeline($('timeline'), { onPick: select });
  renderProvenance();
  renderKpis();
  $('legend').innerHTML = legendHtml(state.layer);
  mapView.render(model, ev, state.layer, state.glareWindows, { fit });
  requestAnimationFrame(() => mapView.invalidate());
  renderAdvice();
  renderOptimizer();
  renderTable();
  $('scrub').max = String(ev.rows.length - 1);
  $('timeline-note').textContent = `Times shown in local time along the route · ${model.route.engine} drive times, no live traffic`;
  select(state.sel);
}

function renderProvenance() {
  const m = state.model;
  const b = $('provenance');
  b.hidden = false;
  const banner = $('snapshot-banner');
  if (m.source.kind === 'snapshot') {
    b.className = 'badge snapshot';
    b.textContent = 'Recorded snapshot';
    banner.hidden = false;
    banner.innerHTML = `<strong>Recorded snapshot — not current conditions.</strong> Route (${esc(m.route.engine)}) and Open-Meteo forecast were captured ${esc(formatClock(m.source.capturedAt, 'America/New_York'))} on ${new Date(m.source.capturedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}. Sun positions are computed for this snapshot's departure. Press “See my drive” for live data.`;
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
  const breaksNote = $('breaks').value === 'none' ? 'no stops' : `incl. ${BREAK_PLANS[$('breaks').value].label} breaks`;
  $('kpis').innerHTML = [
    kpi('time', 'Drive', formatDuration(ev.driveSec, { compact: true }), `${fmt.dist(model.route.totalDistM)} · ${breaksNote}`),
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
    kpi('wet', 'Wet / snowy', t.wetMin >= 1 ? formatDuration(t.wetMin * 60, { compact: true }) : 'Dry', t.snowMin >= 1 ? `${Math.round(t.snowMin)} min snow/ice` : t.missingMin > 1 ? `${Math.round(t.missingMin)} min no forecast` : 'forecast precipitation'),
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

function select(i, { range } = {}) {
  const { model, ev } = state;
  state.sel = Math.max(0, Math.min(ev.rows.length - 1, i));
  const row = ev.rows[state.sel];
  const smp = model.samples[state.sel];
  $('scrub').value = String(state.sel);
  $('scrub').setAttribute('aria-valuetext', `${formatClock(row.t, row.timezone || model.originTz)}, ${placeLabel(model, smp).text}`);
  timeline.render({ ev, model, fmt, sel: state.sel, range: range ?? (state.activeRec != null ? state.recs[state.activeRec]?.range : null) });
  mapView.setCar(smp);
  renderMoment(row, smp);
  $('compass').innerHTML = `${compassSvg(row, smp)}<div class="compass-text">${compassText(row, smp)}</div>`;
}

function renderMoment(row, smp) {
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
  $('moment').innerHTML = `<div class="moment-head"><div><div class="moment-time">${esc(formatClock(row.t, tz))}</div>
      <div class="moment-where">${esc(where.text)} · ${formatDuration((row.t - ev.departureUtc) / 1000)} into the trip</div></div></div>
    <div class="chips">${chips.join('')}</div>
    <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="fineprint">${wx ? `Open-Meteo model forecast for ${esc(formatClock(wx.validTime, tz, { weekday: false }))} (nearest checkpoint). Not an observation.` : ''}</p>`;
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
      state.recs = buildAdvice(state.model, state.ev, { vehicle: $('vehicle').value, optimizer: state.opt, unitsFmt: fmt });
      renderKpis();
      renderAdvice();
      renderTable();
      select(state.sel);
    }
  })
);
for (const id of ['vehicle', 'breaks']) {
  $(id).addEventListener('change', () => {
    if (state.model && !state.inflight) evaluate(state.ev.departureUtc);
  });
}

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
  const p = PRESETS.find((x) => x.id === id);
  const origin = PLACES[p.origin];
  const dest = PLACES[p.dest];
  const dep = nextDayAt(p.hour, p.minute, origin.timezone);
  fillForm(origin, dest, dep);
  plan({ origin, dest, departureUtc: dep, vehicle: $('vehicle').value, breaks: $('breaks').value });
}

async function openSnapshot(id = PRESETS[0].id) {
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
  if (q.get('snapshot')) openSnapshot(q.get('snapshot'));
  else if (q.get('preset')) runPreset(q.get('preset'));
}
