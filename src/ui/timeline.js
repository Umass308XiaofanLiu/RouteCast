// timeline.js — compact SVG timeline of the drive.
import { C, PHASE_COLOR, weatherCategory } from './palette.js';
import { formatClock, tzAbbrev } from '../lib/time.js';

const LABEL_W = 84;
const ROWS = [
  { key: 'light', label: 'Daylight', h: 14 },
  { key: 'glare', label: 'Sun glare', h: 14 },
  { key: 'precip', label: 'Rain / snow', h: 34 },
  { key: 'temp', label: 'Temperature', h: 46 },
  { key: 'wind', label: 'Crosswind', h: 30 },
];
const GAP = 8;
const TOP = 22;

function runs(rows, cat) {
  const out = [];
  let s = 0;
  let c = cat(rows[0]);
  for (let i = 1; i <= rows.length; i += 1) {
    const ci = i < rows.length ? cat(rows[i]) : null;
    if (i === rows.length || ci !== c) {
      out.push([s, i - 1, c]);
      s = i;
      c = ci;
    }
  }
  return out;
}

export function createTimeline(el, { onPick }) {
  let state = null;
  let width = el.clientWidth || 800;

  function xOf(t) {
    const { ev } = state;
    const span = ev.arrivalUtc - ev.departureUtc || 1;
    return LABEL_W + ((t - ev.departureUtc) / span) * (width - LABEL_W - 8);
  }

  function indexAtX(x) {
    const { ev } = state;
    const span = ev.arrivalUtc - ev.departureUtc || 1;
    const t = ev.departureUtc + ((x - LABEL_W) / (width - LABEL_W - 8)) * span;
    let lo = 0;
    let hi = ev.rows.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ev.rows[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return Math.abs(ev.rows[lo].t - t) < Math.abs(ev.rows[hi].t - t) ? lo : hi;
  }

  function draw() {
    if (!state) return;
    const { ev, model, fmt, sel, range } = state;
    width = Math.max(320, el.clientWidth || 800);
    const rows = ev.rows;
    const edges = rows.map((r, i) => (i === 0 ? r.t : (rows[i - 1].t + r.t) / 2));
    edges.push(rows[rows.length - 1].t);
    const x0 = (i) => xOf(edges[i]);
    const x1 = (i) => xOf(edges[i + 1]);
    let y = TOP;
    const parts = [];
    const rowsDef = ev.delay?.extraSec ? [...ROWS, { key: 'jam', label: 'Delay (set)', h: 10 }] : ROWS;
    const totalH = TOP + rowsDef.reduce((a, r) => a + r.h + GAP, 0) + 14;

    // Highlighted range (from a selected recommendation).
    if (range) parts.push(`<rect x="${x0(range[0])}" y="4" width="${Math.max(2, x1(range[1]) - x0(range[0]))}" height="${totalH - 8}" fill="#ffe8cc" opacity=".55" rx="4"/>`);

    for (const row of rowsDef) {
      parts.push(`<text class="row-label" x="0" y="${y + Math.min(row.h, 14) - 2}">${row.label}</text>`);
      if (row.key === 'light') {
        for (const [a, b, c] of runs(rows, (r) => r.phase)) parts.push(`<rect x="${x0(a)}" y="${y}" width="${Math.max(0.5, x1(b) - x0(a))}" height="${row.h}" fill="${PHASE_COLOR[c]}"/>`);
      } else if (row.key === 'glare') {
        parts.push(`<rect x="${LABEL_W}" y="${y}" width="${width - LABEL_W - 8}" height="${row.h}" fill="#f1f3f5"/>`);
        for (const [a, b, c] of runs(rows, (r) => `${r.glare.severity}|${r.expected}`)) {
          const [geo, exp] = c.split('|').map(Number);
          if (geo === 0) continue;
          const muted = exp < geo;
          parts.push(`<rect x="${x0(a)}" y="${y}" width="${Math.max(1, x1(b) - x0(a))}" height="${row.h}" fill="${C.g[Math.max(exp, 1)]}" opacity="${muted ? 0.4 : 1}"><title>${muted ? 'Geometric glare, likely muted by clouds' : 'Expected glare'}</title></rect>`);
        }
      } else if (row.key === 'precip') {
        const maxP = Math.max(2, ...rows.map((r) => r.wx?.precipitation ?? 0));
        if (!rows.some((r) => (r.wx?.precipitation ?? 0) >= 0.05 || !r.wx)) parts.push(`<text x="${LABEL_W + 6}" y="${y + row.h / 2 + 4}">Dry the whole way</text>`);
        parts.push(`<line x1="${LABEL_W}" x2="${width - 8}" y1="${y + row.h}" y2="${y + row.h}" stroke="#dee2e6"/>`);
        for (const [a, b, c] of runs(rows, (r) => `${weatherCategory(r)}|${(r.wx?.precipitation ?? 0).toFixed(1)}`)) {
          const [cat, p] = c.split('|');
          if (cat === 'nodata') {
            parts.push(`<rect x="${x0(a)}" y="${y}" width="${Math.max(1, x1(b) - x0(a))}" height="${row.h}" fill="url(#nodata)"/>`);
            continue;
          }
          const v = Number(p);
          if (v < 0.05) continue;
          const h = Math.max(2, (v / maxP) * row.h);
          const col = cat === 'snow' ? C.snow : cat === 'heavy' ? C.heavy : C.rain;
          parts.push(`<rect x="${x0(a)}" y="${y + row.h - h}" width="${Math.max(1, x1(b) - x0(a))}" height="${h}" fill="${col}"/>`);
        }
      } else if (row.key === 'temp') {
        const vals = rows.map((r) => (r.wx?.temperature == null ? null : fmt.tempValue(r.wx.temperature)));
        const finite = vals.filter((v) => v != null);
        if (finite.length) {
          const lo = Math.min(...finite);
          const hi = Math.max(...finite);
          const pad = Math.max(2, (hi - lo) * 0.15);
          const sy = (v) => y + row.h - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * row.h;
          let d = '';
          vals.forEach((v, i) => {
            if (v == null) return;
            d += `${d && vals[i - 1] != null ? 'L' : 'M'}${xOf(rows[i].t).toFixed(1)},${sy(v).toFixed(1)}`;
          });
          parts.push(`<path d="${d}" fill="none" stroke="${C.temp}" stroke-width="2"/>`);
          parts.push(`<text x="0" y="${y + 28}">${Math.round(lo)}–${Math.round(hi)}${fmt.tempUnit}</text>`);
        }
      } else if (row.key === 'jam') {
        parts.push(`<rect x="${LABEL_W}" y="${y}" width="${width - LABEL_W - 8}" height="${row.h}" fill="#f8f0f4"/>`);
        for (const [a, b, c] of runs(rows, (r) => (r.congested ? 1 : 0))) {
          if (c) parts.push(`<rect x="${x0(a)}" y="${y}" width="${Math.max(1, x1(b) - x0(a))}" height="${row.h}" fill="#c2255c"><title>Assumed delay (scenario, not measured traffic)</title></rect>`);
        }
      } else if (row.key === 'wind') {
        const maxW = Math.max(40, ...rows.map((r) => r.hz.crossMph || 0));
        let d = `M${xOf(rows[0].t)},${y + row.h}`;
        rows.forEach((r) => {
          d += `L${xOf(r.t).toFixed(1)},${(y + row.h - ((r.hz.crossMph || 0) / maxW) * row.h).toFixed(1)}`;
        });
        d += `L${xOf(rows[rows.length - 1].t)},${y + row.h}Z`;
        parts.push(`<path d="${d}" fill="${C.wind}" opacity=".35" stroke="${C.wind}" stroke-width="1.2"/>`);
        parts.push(`<text x="0" y="${y + 26}">0–${fmt.speedMph(maxW)}</text>`);
      }
      y += row.h + GAP;
    }

    // Clock ticks in local time of each position.
    const hours = (ev.arrivalUtc - ev.departureUtc) / 3600e3;
    const step = hours <= 5 ? 1 : hours <= 12 ? 2 : 3;
    let t = Math.ceil(ev.departureUtc / 3600e3) * 3600e3;
    let lastTz = null;
    const tickMinGap = 46;
    let lastX = -1e9;
    while (t <= ev.arrivalUtc) {
      const x = xOf(t);
      const i = indexAtX(x);
      const tz = rows[i].timezone || model.originTz;
      const hourLocal = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)));
      if (hourLocal % step === 0 && x - lastX >= tickMinGap) {
        const label = formatClock(t, tz, { weekday: false, zone: false }).replace(':00', '');
        const zoneChange = lastTz && tz !== lastTz ? ` ${tzAbbrev(t, tz)}` : '';
        parts.push(`<line x1="${x}" x2="${x}" y1="${TOP - 4}" y2="${y - GAP}" stroke="#e9ecef"/>`);
        parts.push(`<text x="${x}" y="12" text-anchor="middle">${label}${zoneChange}</text>`);
        lastX = x;
        lastTz = tz;
      }
      if (!lastTz) lastTz = tz;
      t += 3600e3;
    }

    // Cursor.
    const cx = xOf(rows[sel].t);
    parts.push(`<line x1="${cx}" x2="${cx}" y1="${TOP - 6}" y2="${y - GAP + 2}" stroke="${C.ink}" stroke-width="2"/>`);
    parts.push(`<circle cx="${cx}" cy="${TOP - 6}" r="4.5" fill="${C.ink}"/>`);

    el.innerHTML = `<svg viewBox="0 0 ${width} ${totalH}" height="${totalH}" role="img" aria-label="Timeline of daylight, sun glare, precipitation, temperature and crosswind along the drive">
      <defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f1f3f5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#ced4da" stroke-width="2"/></pattern></defs>
      ${parts.join('')}</svg>`;
    const svgEl = el.firstElementChild;
    const pick = (e) => {
      const rect = svgEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * width;
      if (x < LABEL_W - 4) return;
      onPick(indexAtX(Math.max(LABEL_W, x)));
    };
    svgEl.addEventListener('pointerdown', (e) => {
      pick(e);
      const move = (m) => pick(m);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  const ro = new ResizeObserver(() => {
    if (Math.abs((el.clientWidth || 0) - width) > 4) draw();
  });
  ro.observe(el);

  return {
    render(next) {
      state = { ...state, ...next };
      draw();
    },
  };
}
