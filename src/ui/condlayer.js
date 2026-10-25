// condlayer.js — small animated condition icons placed along the route at the samples where
// that condition is PROJECTED for the driver's arrival time. Icons are original inline SVGs
// written for GlarePilot (no third-party assets). Animation is pure CSS (transform/opacity
// only), slow (≥1.6 s cycles, no flashing), and disabled by prefers-reduced-motion or the
// Motion toggle (body.motion-off).
import L from 'leaflet';
import { conditionCandidates, thinByDistance, COND_LABEL } from '../lib/conditions.js';
import { formatClock } from '../lib/time.js';
import { placeLabel } from '../lib/trip.js';

const S = (inner) => `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${inner}</svg>`;

export const COND_SVG = {
  glare: S(`<g class="a-spin"><g stroke="#f08c00" stroke-width="2.2" stroke-linecap="round">
      <path d="M16 3.5v3.2M16 25.3v3.2M3.5 16h3.2M25.3 16h3.2M7.2 7.2l2.2 2.2M22.6 22.6l2.2 2.2M7.2 24.8l2.2-2.2M22.6 9.4l2.2-2.2"/></g></g>
      <circle class="a-pulse" cx="16" cy="16" r="6.3" fill="#ffd43b" stroke="#f08c00" stroke-width="1.6"/>`),
  'sun-aligned': S(`<circle cx="13" cy="12.5" r="6" fill="#ffe8a3" stroke="#f0b400" stroke-width="1.4"/>
      <path class="a-drift" d="M9 24.5h13.2a4.3 4.3 0 0 0 .4-8.6 5.8 5.8 0 0 0-11.1 1.7A3.5 3.5 0 0 0 9 24.5z" fill="#e9ecef" stroke="#adb5bd" stroke-width="1.3"/>`),
  rain: S(`<path d="M8.5 17h14.8a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.5 1.6A3.7 3.7 0 0 0 8.5 17z" fill="#d0ebff" stroke="#1c7ed6" stroke-width="1.4"/>
      <g stroke="#1c7ed6" stroke-width="2" stroke-linecap="round"><path class="a-drop d1" d="M11 20.5l-1.2 3.2"/><path class="a-drop d2" d="M16.2 20.5l-1.2 3.2"/><path class="a-drop d3" d="M21.4 20.5l-1.2 3.2"/></g>`),
  snow: S(`<path d="M8.5 16h14.8a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.5 1.6A3.7 3.7 0 0 0 8.5 16z" fill="#f3d9fa" stroke="#9c36b5" stroke-width="1.4"/>
      <g fill="#9c36b5"><circle class="a-flake d1" cx="11" cy="21" r="1.6"/><circle class="a-flake d2" cx="16.5" cy="20" r="1.6"/><circle class="a-flake d3" cx="22" cy="21.5" r="1.6"/></g>`),
  fog: S(`<g stroke="#868e96" stroke-width="2.4" stroke-linecap="round"><path class="a-band d1" d="M6 11h17"/><path class="a-band d2" d="M9 16h17"/><path class="a-band d3" d="M6 21h17"/></g>`),
  wind: S(`<g fill="none" stroke="#0ca678" stroke-width="2.2" stroke-linecap="round"><path class="a-gust d1" d="M4 12h14.5a3.2 3.2 0 1 0-3.2-3.2"/><path class="a-gust d2" d="M4 17h19a3.2 3.2 0 1 1-3.2 3.2"/><path class="a-gust d3" d="M4 22h9"/></g>`),
  jam: S(`<g class="a-creep"><rect x="5" y="13" width="10" height="7" rx="2" fill="#c2255c"/><circle cx="7.5" cy="21" r="1.6" fill="#343a40"/><circle cx="12.5" cy="21" r="1.6" fill="#343a40"/></g>
      <g class="a-creep d2"><rect x="17" y="13" width="10" height="7" rx="2" fill="#e64980"/><circle cx="19.5" cy="21" r="1.6" fill="#343a40"/><circle cx="24.5" cy="21" r="1.6" fill="#343a40"/></g>
      <path d="M8 9.5h16" stroke="#c2255c" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/>`),
  night: S(`<path d="M21.5 20.5A8.5 8.5 0 0 1 13.2 8a8.5 8.5 0 1 0 8.3 12.5z" fill="#dbe4ff" stroke="#2b2f77" stroke-width="1.5"/>
      <path class="a-twinkle" d="M23.5 7.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="#f5c400"/>`),
};

export const COND_RING = {
  glare: '#f08c00', 'sun-aligned': '#adb5bd', rain: '#1c7ed6', snow: '#9c36b5', fog: '#868e96', wind: '#0ca678', jam: '#c2255c', night: '#2b2f77',
};

export function condLegendHtml(cats) {
  return cats
    .map((c) => `<span class="cl-item"><span class="cond-badge static" style="--ring:${COND_RING[c]}">${COND_SVG[c]}</span>${COND_LABEL[c]}${c === 'jam' ? ' (scenario)' : ''}</span>`)
    .join('');
}

export function createConditionLayer(map, { onPick }) {
  const layer = L.layerGroup().addTo(map);
  let state = null;

  function draw() {
    layer.clearLayers();
    if (!state) return;
    const { model, ev, cands } = state;
    const z = map.getZoom();
    const minPx = z >= 9 ? 40 : z >= 7 ? 46 : 52;
    const project = (i) => map.latLngToContainerPoint([model.samples[i].lat, model.samples[i].lon]);
    const kept = thinByDistance(cands, project, { minPx, max: z >= 8 ? 70 : 40 });
    // Keyboard: ONE tab stop per condition window (the first kept icon of that window) with a
    // descriptive name (condition, projected time, place); the other icons of the same window are
    // mouse/touch only and hidden from assistive tech, so Tab is not flooded with repeats.
    const stops = new Set();
    for (const k of kept) {
      const s = model.samples[k.idx];
      const r = ev.rows[k.idx];
      const label = `${COND_LABEL[k.cat]}${k.cat === 'jam' ? ' (assumed delay scenario)' : ''}`;
      const key = `${k.cat}:${k.range[0]}-${k.range[1]}`;
      const isStop = !stops.has(key);
      if (isStop) stops.add(key);
      const near = placeLabel(model, s).near;
      const name = `${label}, ${formatClock(r.t, r.timezone || model.originTz, { weekday: false })}${near ? ` ${near}` : ''}`;
      const m = L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: 'cond-icon',
          html: `<span class="cond-badge cond-${k.cat}" style="--ring:${COND_RING[k.cat]}">${COND_SVG[k.cat]}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 36],
        }),
        title: name,
        keyboard: isStop,
        riseOnHover: true,
        zIndexOffset: k.cat === 'glare' ? 300 : k.cat === 'night' ? -100 : 100,
      });
      m.on('add', (e) => {
        const el = e.target.getElement();
        if (!el) return;
        el.dataset.condStop = String(isStop);
        if (isStop) el.setAttribute('aria-label', name);
        else el.setAttribute('aria-hidden', 'true');
      });
      m.on('click', () => onPick(k.idx, k.range));
      m.on('keypress', (e) => {
        if (e.originalEvent.key === 'Enter') onPick(k.idx, k.range);
      });
      m.bindTooltip(label, { direction: 'top', offset: [0, -34] });
      layer.addLayer(m);
    }
  }

  map.on('zoomend moveend', () => draw());

  return {
    render(model, ev) {
      state = { model, ev, cands: conditionCandidates(ev) };
      draw();
    },
    presentCategories() {
      return state ? [...new Set(state.cands.map((c) => c.cat))] : [];
    },
    clear() {
      state = null;
      layer.clearLayers();
    },
  };
}
