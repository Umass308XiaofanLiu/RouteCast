// advice.js — deterministic, explainable driving guidance.
// Every recommendation carries the data that triggered it ("why"). No generative AI.
import { describeGlareWindow, placeLabel } from './trip.js';
import { formatClock, formatDuration } from './time.js';
import { compass } from './geo.js';
import { describeCode } from './weather.js';

const PRIORITY = { high: 0, medium: 1, info: 2 };

function span(ev, model, [a, b]) {
  const ra = ev.rows[a];
  const rb = ev.rows[b];
  const tz = ra.timezone || model.originTz;
  const tzb = rb.timezone || tz;
  const minutes = Math.max(1, Math.round((rb.t - ra.t) / 60000));
  return {
    when: `${formatClock(ra.t, tz)} – ${formatClock(rb.t, tzb, { weekday: false })}`,
    minutes,
    where: placeLabel(model, model.samples[a]).text,
    whereEnd: placeLabel(model, model.samples[b]).text,
  };
}

function glareActions(sev, vehicle, kind) {
  const acts = [
    'Clean the windshield inside and out before you leave — haze and streaks scatter low sun.',
    'Have sunglasses (polarized helps) and the visor ready before this stretch.',
    'Leave extra following distance: brake lights and signals ahead get washed out.',
  ];
  if (sev >= 3) acts.push('If you cannot see the lane or traffic ahead, slow down smoothly; a short stop before the stretch lets the sun move.');
  if (vehicle === 'motorcycle') acts[1] = 'Use a tinted visor or sunglasses before this stretch.';
  if (kind === 'sunrise') acts.push('Low morning sun also hides frost and dew glare on the road surface.');
  return acts;
}

/** Build prioritized recommendations from a trip evaluation (and optional optimizer result). */
export function buildAdvice(model, ev, { vehicle = 'car', optimizer = null, unitsFmt } = {}) {
  const recs = [];
  const fmt = unitsFmt;

  // 1. Sun glare windows.
  for (const w of ev.windows.glare) {
    const d = describeGlareWindow(model, ev, w);
    if (d.peakSeverity < 2 && d.minutes < 4) continue;
    const s = span(ev, model, w);
    const dir = compass(d.heading);
    const kindLabel = d.kind === 'sunrise' ? 'sunrise' : 'sunset';
    const expectedLabel = ['no', 'mild', 'strong', 'severe'][d.peakExpected];
    const geomLabel = ['no', 'mild', 'strong', 'severe'][d.peakSeverity];
    const muted = d.mutedShare > 0.5;
    const cloudTxt = d.avgCloud == null ? 'cloud cover not in forecast' : `forecast cloud cover ~${Math.round(d.avgCloud)}%`;
    recs.push({
      id: `glare-${w[0]}`,
      kind: 'glare',
      priority: muted ? (d.peakSeverity >= 3 ? 'medium' : 'info') : d.peakSeverity >= 2 ? 'high' : 'medium',
      severity: d.peakExpected,
      title: `${dir}-bound ${kindLabel} glare ${d.where.near ? d.where.near : ''}`.trim(),
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: s.where === s.whereEnd ? s.where : `${s.where} → ${s.whereEnd}`,
      why: `Sun ${Math.max(0, d.sunAltRange[0]).toFixed(0)}–${d.sunAltRange[1].toFixed(0)}° above the horizon and as close as ${d.minOffset.toFixed(0)}° to your heading (${dir}). Geometric risk: ${geomLabel}; ${cloudTxt}${muted ? `, so expected glare is ${expectedLabel}` : ''}.`,
      actions: muted
        ? ['Clouds will likely soften this, but keep sunglasses handy in case they break.']
        : glareActions(d.peakSeverity, vehicle, d.kind),
      focus: d.peak,
      range: w,
    });
  }

  // 2. Low sun behind the driver.
  for (const w of ev.windows.rear) {
    const s = span(ev, model, w);
    if (s.minutes < 5) continue;
    recs.push({
      id: `rear-${w[0]}`,
      kind: 'rear-sun',
      priority: 'info',
      title: 'Low sun behind you',
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: s.where,
      why: 'Sun is low and behind your direction of travel: traffic signals and brake lights can look unlit, and oncoming drivers face glare.',
      actions: ['Take extra care at signals and when other drivers turn across your lane.'],
      focus: w[0],
      range: w,
    });
  }

  // 3. Snow / ice.
  for (const w of ev.windows.snow) {
    const s = span(ev, model, w);
    const r = ev.rows[w[0]];
    let maxSnow = 0;
    let minT = Infinity;
    for (let i = w[0]; i <= w[1]; i++) {
      maxSnow = Math.max(maxSnow, ev.rows[i].wx?.snowfall ?? 0);
      if (ev.rows[i].wx?.temperature != null) minT = Math.min(minT, ev.rows[i].wx.temperature);
    }
    recs.push({
      id: `snow-${w[0]}`,
      kind: 'snow',
      priority: 'high',
      title: r.hz.ice ? 'Freezing precipitation / ice risk' : 'Snow on the route',
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: `${s.where} → ${s.whereEnd}`,
      why: `Forecast: ${describeCode(r.wx?.weatherCode)}, up to ${fmt.snow(maxSnow)}/h snowfall, temperature down to ${fmt.temp(minT)}.`,
      actions: ['Slow down and double your following distance.', 'Bridges and overpasses freeze first.', 'Check state DOT road conditions (511) before this stretch; consider delaying.'],
      focus: w[0],
      range: w,
    });
  }

  // 4. Rain (excluding snow windows).
  for (const w of ev.windows.wet) {
    let heavy = false;
    let snow = false;
    let maxP = 0;
    let maxProb = 0;
    for (let i = w[0]; i <= w[1]; i++) {
      const r = ev.rows[i];
      heavy ||= r.hz.heavyRain;
      snow ||= r.hz.snow;
      maxP = Math.max(maxP, r.wx?.precipitation ?? 0);
      maxProb = Math.max(maxProb, r.wx?.precipProbability ?? 0);
    }
    if (snow) continue;
    const s = span(ev, model, w);
    if (s.minutes < 5 && !heavy) continue;
    recs.push({
      id: `rain-${w[0]}`,
      kind: 'rain',
      priority: heavy ? 'high' : 'medium',
      title: heavy ? 'Heavy rain on the route' : 'Rain on the route',
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: `${s.where} → ${s.whereEnd}`,
      why: `Forecast up to ${fmt.precip(maxP)}/h${maxProb ? `, ${Math.round(maxProb)}% chance` : ''}.`,
      actions: heavy
        ? ['Slow down to reduce hydroplaning risk; avoid cruise control on wet roads.', 'Turn on headlights.']
        : ['Headlights on; leave extra stopping distance.'],
      focus: w[0],
      range: w,
    });
  }

  // 5. Thunderstorms and low visibility.
  for (const w of ev.windows.lowVis) {
    const s = span(ev, model, w);
    let minVis = Infinity;
    for (let i = w[0]; i <= w[1]; i++) if (ev.rows[i].wx?.visibility != null) minVis = Math.min(minVis, ev.rows[i].wx.visibility);
    recs.push({
      id: `vis-${w[0]}`,
      kind: 'visibility',
      priority: 'high',
      title: 'Low visibility (fog or heavy precipitation)',
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: s.where,
      why: Number.isFinite(minVis) ? `Forecast visibility down to ${fmt.dist(minVis)}.` : 'Fog in the forecast weather code.',
      actions: ['Use low beams, not high beams, in fog.', 'Slow down so you can stop within the distance you can see.'],
      focus: w[0],
      range: w,
    });
  }
  if (ev.totals.stormMin > 0) {
    const i = ev.rows.findIndex((r) => r.hz.storm);
    recs.push({
      id: 'storm',
      kind: 'storm',
      priority: 'high',
      title: 'Thunderstorms possible',
      when: formatClock(ev.rows[i].t, ev.rows[i].timezone || model.originTz),
      where: placeLabel(model, model.samples[i]).text,
      why: `Forecast weather code: ${describeCode(ev.rows[i].wx.weatherCode)}.`,
      actions: ['Check radar and NWS alerts before this stretch; do not drive through flooded roads.'],
      focus: i,
      range: [i, i],
    });
  }

  // 6. Crosswind gusts.
  for (const w of ev.windows.wind) {
    const s = span(ev, model, w);
    let peak = w[0];
    for (let i = w[0]; i <= w[1]; i++) if (ev.rows[i].hz.crossMph > ev.rows[peak].hz.crossMph) peak = i;
    const r = ev.rows[peak];
    recs.push({
      id: `wind-${w[0]}`,
      kind: 'wind',
      priority: 'medium',
      title: `Strong crosswind gusts from the ${r.hz.cross.side}`,
      when: `${s.when} (${formatDuration(s.minutes * 60)})`,
      where: `${s.where} → ${s.whereEnd}`,
      why: `Gusts ${fmt.speed(r.wx.windGusts)} from ${compass(r.wx.windDirection)} give a ~${fmt.speedMph(r.hz.crossMph)} crosswind component at your ${compass(model.samples[peak].heading)} heading.`,
      actions:
        vehicle === 'high-profile'
          ? ['High-profile vehicles are most affected: slow down, keep both hands on the wheel, be careful on bridges and open stretches.']
          : ['Keep both hands on the wheel; expect sudden pushes on bridges, open stretches and when passing trucks.'],
      focus: peak,
      range: w,
    });
  }

  // 7. Darkness and arrival.
  const nightShare = ev.totals.nightMin / Math.max(1, ev.driveSec / 60);
  const last = ev.rows[ev.rows.length - 1];
  if (ev.totals.nightMin >= 20) {
    const w = ev.windows.night[0];
    const s = span(ev, model, w);
    recs.push({
      id: 'night',
      kind: 'night',
      priority: nightShare > 0.4 ? 'medium' : 'info',
      title: `${formatDuration(ev.totals.nightMin * 60)} of driving after dark`,
      when: s.when,
      where: s.where,
      why: `Sun more than 6° below the horizon for ${Math.round(nightShare * 100)}% of the drive.`,
      actions: ['Watch for deer around dusk and dawn, especially in rural New England and the Midwest in autumn.', 'Dim dashboard lights and keep the windshield clean to cut glare from headlights.'],
      focus: w[0],
      range: w,
    });
  } else if (last.phase === 'twilight' || last.phase === 'night') {
    recs.push({
      id: 'arrive-dark',
      kind: 'night',
      priority: 'info',
      title: 'Arrival around dusk',
      when: formatClock(last.t, last.timezone || model.destTz),
      where: model.destLabel,
      why: `Sun ${last.sun.altitude.toFixed(0)}° at arrival.`,
      actions: ['Headlights on through twilight; pedestrians are hard to see.'],
      focus: ev.rows.length - 1,
      range: [ev.rows.length - 1, ev.rows.length - 1],
    });
  }

  // 8. Freezing temperatures without precipitation.
  if (ev.minTemp != null && ev.minTemp <= 0 && !ev.windows.snow.length) {
    const i = ev.rows.findIndex((r) => r.wx?.temperature != null && r.wx.temperature <= 0);
    recs.push({
      id: 'freezing',
      kind: 'cold',
      priority: 'medium',
      title: 'Below-freezing temperatures',
      when: formatClock(ev.rows[i].t, ev.rows[i].timezone || model.originTz),
      where: placeLabel(model, model.samples[i]).text,
      why: `Forecast low of ${fmt.temp(ev.minTemp)} on the route.`,
      actions: ['Bridges, overpasses and shaded curves can ice even without precipitation.'],
      focus: i,
      range: [i, i],
    });
  }

  // 9. Fatigue / breaks.
  if (ev.driveSec >= 2.5 * 3600) {
    recs.push({
      id: 'breaks',
      kind: 'fatigue',
      priority: ev.driveSec >= 9 * 3600 ? 'medium' : 'info',
      title: ev.driveSec >= 9 * 3600 ? 'Long day of driving' : 'Plan rest breaks',
      when: `${formatDuration(ev.driveSec)} of routed driving`,
      where: 'Whole trip',
      why: `Routed drive time is ${formatDuration(ev.driveSec)} before traffic, fuel and food stops.`,
      actions:
        ev.driveSec >= 9 * 3600
          ? ['Share the driving or split the trip if you can.', 'Take a break about every 2 hours, and pull over if you feel drowsy.']
          : ['Take a break about every 2 hours, and pull over if you feel drowsy.'],
      focus: null,
      range: null,
    });
  }

  // 10. Forecast gaps.
  if (ev.totals.missingMin > 1) {
    const w = ev.windows.missing[0];
    const s = span(ev, model, w);
    recs.push({
      id: 'missing',
      kind: 'data',
      priority: 'info',
      title: 'Part of the trip has no forecast yet',
      when: s.when,
      where: s.where,
      why: `${formatDuration(ev.totals.missingMin * 60)} of the drive falls outside the available forecast window; those stretches are shown as "no forecast".`,
      actions: ['Re-check closer to departure.'],
      focus: w[0],
      range: w,
    });
  }

  // 11. Departure optimizer.
  if (optimizer?.worthIt) {
    const b = optimizer.best;
    const c = optimizer.current;
    const sign = b.offsetMin < 0 ? 'earlier' : 'later';
    const deltas = [];
    if (Math.round(c.glareMin) !== Math.round(b.glareMin)) deltas.push(`strong/severe glare ${Math.round(c.glareMin)} → ${Math.round(b.glareMin)} min`);
    if (Math.round(c.wetMin) !== Math.round(b.wetMin)) deltas.push(`wet roads ${Math.round(c.wetMin)} → ${Math.round(b.wetMin)} min`);
    if (Math.round(c.snowMin) !== Math.round(b.snowMin)) deltas.push(`snow/ice ${Math.round(c.snowMin)} → ${Math.round(b.snowMin)} min`);
    if (Math.round(c.windMin) !== Math.round(b.windMin)) deltas.push(`strong crosswind ${Math.round(c.windMin)} → ${Math.round(b.windMin)} min`);
    if (Math.round(c.nightMin) !== Math.round(b.nightMin)) deltas.push(`after dark ${Math.round(c.nightMin)} → ${Math.round(b.nightMin)} min`);
    recs.push({
      id: 'optimizer',
      kind: 'depart',
      priority: 'high',
      title: `Leave ${formatDuration(Math.abs(b.offsetMin) * 60)} ${sign}: ${formatClock(b.departureUtc, model.originTz)}`,
      when: `Arrive ${formatClock(b.arrivalUtc, model.destTz)}`,
      where: 'Same route',
      why: `${deltas.join('; ')}. Exposure score ${Math.round(c.score)} → ${Math.round(b.score)} (weighted minutes; lower is better).`,
      actions: ['Use “Try this departure” to re-plan with this time.'],
      focus: null,
      range: null,
      applyDepartureUtc: b.departureUtc,
    });
  }

  recs.sort((x, y) => PRIORITY[x.priority] - PRIORITY[y.priority] || (y.severity ?? 0) - (x.severity ?? 0));
  return recs;
}
