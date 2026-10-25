// mapview.js — Leaflet route map colored by the selected condition layer.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { C, PHASE_COLOR, PHASE_LABEL, WEATHER_COLOR, WEATHER_LABEL, GLARE_LABEL, weatherCategory } from './palette.js';
import { formatClock } from '../lib/time.js';
import { placeLabel } from '../lib/trip.js';

/**
 * Accessible name for a divIcon marker (Leaflet's `alt` only applies to <img> icons, so a
 * keyboard marker would otherwise be announced by its visible glyph, e.g. "A").
 * Re-applied on every add because Leaflet recreates the icon element.
 */
export function markerA11y(marker, label) {
  return marker.on('add', (e) => e.target.getElement()?.setAttribute('aria-label', label));
}

export const LAYERS = {
  glare: {
    category: (r) => `g${r.expected}`,
    color: (cat) => C.g[Number(cat.slice(1))],
    legend: [0, 1, 2, 3].map((i) => [C.g[i], i === 0 ? 'No glare' : GLARE_LABEL[i]]),
  },
  weather: {
    category: weatherCategory,
    color: (cat) => WEATHER_COLOR[cat],
    legend: ['dry', 'rain', 'heavy', 'snow', 'fog', 'wind', 'nodata'].map((k) => [WEATHER_COLOR[k], WEATHER_LABEL[k]]),
  },
  light: {
    category: (r) => r.phase,
    color: (cat) => PHASE_COLOR[cat],
    legend: ['day', 'low-sun', 'twilight', 'night'].map((k) => [PHASE_COLOR[k], PHASE_LABEL[k]]),
  },
};

export function createMap(el, { onPick }) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true });
  map.setView([41.5, -78], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const casing = L.layerGroup().addTo(map);
  const route = L.layerGroup().addTo(map);
  const marks = L.layerGroup().addTo(map);
  const highlight = L.layerGroup().addTo(map);
  const jam = L.layerGroup().addTo(map);
  const previewPin = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="preview-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false, interactive: false });
  const car = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="car-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), keyboard: false, interactive: false });
  let samples = [];

  map.on('click', (e) => {
    if (!samples.length) return;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < samples.length; i += 1) {
      const d = (samples[i].lat - e.latlng.lat) ** 2 + ((samples[i].lon - e.latlng.lng) * Math.cos((e.latlng.lat * Math.PI) / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (Math.sqrt(bestD) < 0.6) onPick(best);
  });

  function drawRoute(model, ev, layer) {
    samples = model.samples;
    casing.clearLayers();
    route.clearLayers();
    const all = samples.map((s) => [s.lat, s.lon]);
    L.polyline(all, { color: C.casing, weight: 9, opacity: 0.95, interactive: false }).addTo(casing);
    const spec = LAYERS[layer];
    let start = 0;
    let cat = spec.category(ev.rows[0]);
    const flush = (end) => {
      const pts = all.slice(start, end + 1);
      if (pts.length > 1) L.polyline(pts, { color: spec.color(cat), weight: 5.5, opacity: 1, lineCap: 'round', interactive: false }).addTo(route);
    };
    for (let i = 1; i < ev.rows.length; i += 1) {
      const c = spec.category(ev.rows[i]);
      if (c !== cat) {
        flush(i);
        start = i;
        cat = c;
      }
    }
    flush(ev.rows.length - 1);
  }

  function drawMarkers(model, ev, glareWindows) {
    marks.clearLayers();
    const a = model.samples[0];
    const b = model.samples[model.samples.length - 1];
    const ra = ev.rows[0];
    const rb = ev.rows[ev.rows.length - 1];
    const clock = (r) => formatClock(r.t, r.timezone || model.originTz, { weekday: false });
    // Keyboard: start/end are the only tab stops here (descriptive names with place + time);
    // glare windows get their single keyboard stop from the condition layer (condlayer.js).
    markerA11y(L.marker([a.lat, a.lon], { icon: L.divIcon({ className: '', html: '<div class="pin a" aria-hidden="true">A</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: model.originLabel }),
      `Start: ${model.originLabel}, departs ${clock(ra)}`).addTo(marks);
    markerA11y(L.marker([b.lat, b.lon], { icon: L.divIcon({ className: '', html: '<div class="pin b" aria-hidden="true">B</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: model.destLabel }),
      `Destination: ${model.destLabel}, arrives ${clock(rb)}`).addTo(marks);
    for (const w of glareWindows) {
      const s = model.samples[w.peak];
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({ className: '', html: `<div class="sun-pin" style="box-shadow:0 0 0 3px ${C.g[w.peakExpected] || C.g[1]}">sun</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        title: `Sun glare peak, ${clock(ev.rows[w.peak])} ${placeLabel(model, s).near}`.trim(),
        keyboard: false,
      })
        .on('add', (e) => e.target.getElement()?.setAttribute('aria-hidden', 'true'))
        .on('click', () => onPick(w.peak))
        .addTo(marks);
    }
    car.addTo(map);
  }

  // GPS accuracy circle (latest fix only). SVG renderer so it is a real DOM element; the fix is
  // held only by this in-memory Leaflet layer and dropped on clearAccuracy() — never stored.
  let accCircle = null;
  let accRenderer = null;

  return {
    map,
    /** Show/move the accuracy circle: radius in meters from coords.accuracy (min 5 m). */
    setAccuracy(lat, lon, radiusM) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radiusM > 0)) return this.clearAccuracy();
      const r = Math.max(5, radiusM);
      if (!accCircle) {
        accRenderer ??= L.svg({ padding: 0.5 });
        accCircle = L.circle([lat, lon], { radius: r, renderer: accRenderer, className: 'gps-accuracy', color: '#0c5a3c', weight: 2, fillColor: '#1aa36f', fillOpacity: 0.15, interactive: false }).addTo(map);
      } else accCircle.setLatLng([lat, lon]).setRadius(r);
      el.dataset.gpsAccuracy = String(Math.round(r));
    },
    clearAccuracy() {
      if (accCircle) accCircle.remove();
      accCircle = null;
      delete el.dataset.gpsAccuracy;
    },
    render(model, ev, layer, glareWindows, { fit = false } = {}) {
      map.invalidateSize();
      drawRoute(model, ev, layer);
      drawMarkers(model, ev, glareWindows);
      if (fit) map.fitBounds(L.latLngBounds(model.samples.map((s) => [s.lat, s.lon])), { padding: [28, 28] });
    },
    recolor(model, ev, layer) {
      drawRoute(model, ev, layer);
    },
    setCar(sample) {
      car.setLatLng([sample.lat, sample.lon]);
    },
    setPreview(sample) {
      if (!sample) previewPin.remove();
      else previewPin.setLatLng([sample.lat, sample.lon]).addTo(map);
    },
    setJam(model, windows) {
      jam.clearLayers();
      for (const [a, b] of windows || []) {
        const pts = model.samples.slice(a, b + 1).map((s) => [s.lat, s.lon]);
        if (pts.length > 1) L.polyline(pts, { color: '#c2255c', weight: 3, opacity: 0.95, dashArray: '2 7', lineCap: 'round', className: 'jam-line', interactive: false }).addTo(jam);
      }
    },
    highlight(model, range) {
      highlight.clearLayers();
      if (!range) return;
      const pts = model.samples.slice(range[0], range[1] + 1).map((s) => [s.lat, s.lon]);
      if (pts.length > 1) {
        L.polyline(pts, { color: C.ink, weight: 11, opacity: 0.25, interactive: false }).addTo(highlight);
        map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 10 });
      } else if (pts.length === 1) {
        map.setView(pts[0], Math.max(map.getZoom(), 9));
      }
    },
    invalidate() {
      map.invalidateSize();
    },
  };
}

export function legendHtml(layer) {
  return LAYERS[layer].legend.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
}
