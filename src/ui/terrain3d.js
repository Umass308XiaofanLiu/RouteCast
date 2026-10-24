// terrain3d.js — "3D terrain" view: the PLANNED route draped on real elevation (AWS Terrain
// Tiles, terrarium encoding) in MapLibre GL, with the camera behind/above the SIMULATED
// playback position looking along the heading. Not GPS. The hillshade light direction follows
// the represented point's sun azimuth purely as visual shading; it is NOT used for glare.
// MapLibre is loaded with a dynamic import so the main bundle stays small and any failure
// here (no WebGL, no network) cannot break the rest of the app: the caller falls back.
import { pointAtDistance, compass } from '../lib/geo.js';
import { rowConditions, COND_ORDER, COND_LABEL } from '../lib/conditions.js';
import { COND_RING } from './condlayer.js';
import { formatClock, formatDuration } from '../lib/time.js';

const LEVELS = [
  { name: 'Close', zoom: 14, pitch: 74, ahead: 350 },
  { name: 'Near', zoom: 12.8, pitch: 72, ahead: 900 },
  { name: 'Far', zoom: 11.5, pitch: 66, ahead: 2200 },
  { name: 'Wide', zoom: 10, pitch: 58, ahead: 5000 },
];
const CLEAR_COLOR = '#2f9e44';
const DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (Mapzen; SRTM, USGS 3DEP and others)';
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function topCondition(row) {
  const cs = rowConditions(row);
  return COND_ORDER.find((c) => cs.includes(c)) || null;
}

/** Consecutive samples with the same top condition become one colored LineString. */
function routeFeatures(model, ev) {
  const feats = [];
  const s = model.samples;
  let start = 0;
  let cond = topCondition(ev.rows[0]);
  for (let i = 1; i <= s.length; i++) {
    const c = i < s.length ? topCondition(ev.rows[Math.min(i, ev.rows.length - 1)]) : Symbol('end');
    if (c !== cond) {
      const coords = s.slice(start, Math.min(i + 1, s.length)).map((p) => [p.lon, p.lat]);
      if (coords.length >= 2) feats.push({ type: 'Feature', properties: { color: cond ? COND_RING[cond] : CLEAR_COLOR }, geometry: { type: 'LineString', coordinates: coords } });
      start = i;
      cond = c;
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

export async function createTerrainView(root, { onAdvance, getFmt, reducedMotion }) {
  if (!hasWebGL()) throw new Error('WebGL unavailable');
  const maplibregl = (await import('maplibre-gl')).default;
  await import('maplibre-gl/dist/maplibre-gl.css');

  root.innerHTML = `
    <div class="terrain-map"></div>
    <div class="chase-top">
      <span class="chase-tag">Simulated playback of the planned route · real terrain (AWS Terrain Tiles) · not GPS</span>
      <span class="chase-where" data-hud="where"></span>
    </div>
    <div class="terrain-note" data-hud="note">Loads online map + elevation tiles; scenario weather stays hand-set · hillshade light follows the sun azimuth (visual only, not used for glare)</div>
    <div class="chase-ahead terrain-ahead" data-hud="ahead"></div>
    <div class="chase-controls" role="group" aria-label="3D terrain controls">
      <button type="button" class="chip-btn" data-act="play" aria-pressed="false">Play</button>
      <button type="button" class="chip-btn" data-act="return">Return to playback position</button>
      <span class="chase-zoom"><button type="button" class="chip-btn" data-act="nearer" aria-label="Camera nearer">−</button><span data-hud="level">Near</span><button type="button" class="chip-btn" data-act="farther" aria-label="Camera farther">+</button></span>
    </div>`;
  const hud = {
    where: root.querySelector('[data-hud="where"]'),
    ahead: root.querySelector('[data-hud="ahead"]'),
    level: root.querySelector('[data-hud="level"]'),
    play: root.querySelector('[data-act="play"]'),
  };

  const map = new maplibregl.Map({
    container: root.querySelector('.terrain-map'),
    style: {
      version: 8,
      sources: {
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: OSM_ATTR },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: DEM_ATTR },
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm' },
        { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315 } },
      ],
      sky: {},
    },
    center: [-72.52, 42.37],
    zoom: 10,
    pitch: 60,
    maxPitch: 85,
    attributionControl: { compact: true },
  });

  // Resolve on 'load'; reject on an error before load or a 20 s timeout. Errors after load
  // (e.g. a missing tile) are ignored so the view keeps working.
  await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('terrain map load timeout')), 20000);
    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('error', onErr);
      if (err) {
        try { map.remove(); } catch { /* ignore */ }
        reject(err);
      } else resolve();
    }
    function onErr(e) { finish(e?.error || new Error('terrain map error')); }
    map.on('error', onErr);
    map.once('load', () => finish(null));
  });
  map.on('error', () => {}); // swallow post-load tile errors
  map.setTerrain({ source: 'dem', exaggeration: 1.4 });
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5.5 } });

  const carEl = document.createElement('div');
  carEl.className = 'terrain-car';
  carEl.setAttribute('aria-label', 'Simulated playback position');
  const car = new maplibregl.Marker({ element: carEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([-72.52, 42.37]).addTo(map);

  let model = null;
  let ev = null;
  let cur = 0;
  let level = 1;
  let playing = false;
  let visible = false;
  let raf = 0;
  let lastT = 0;
  let lastAdvance = 0;
  let lastAz = null;
  const motionOk = () => !reducedMotion() && !document.body.classList.contains('motion-off');
  const maxIdx = () => (model ? model.samples.length - 1 : 0);

  function follow(instant) {
    if (!model) return;
    const i = Math.round(cur);
    const smp = model.samples[i];
    const L = LEVELS[level];
    const ahead = pointAtDistance(model.route, Math.min(model.route.totalDistM, smp.distM + L.ahead));
    car.setLngLat([smp.lon, smp.lat]).setRotation(smp.heading);
    const opts = { center: [ahead.lon, ahead.lat], bearing: smp.heading, pitch: L.pitch, zoom: L.zoom };
    if (instant || !motionOk()) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 600 });
    const az = ev.rows[i]?.sun?.azimuth;
    if (Number.isFinite(az) && (lastAz == null || Math.abs(az - lastAz) > 2)) {
      lastAz = az;
      map.setPaintProperty('hillshade', 'hillshade-illumination-direction', ((az % 360) + 360) % 360);
    }
    updateHud();
  }

  function updateHud() {
    if (!model) return;
    const fmt = getFmt();
    const i = Math.round(cur);
    const row = ev.rows[i];
    const smp = model.samples[i];
    const tz = row.timezone || model.originTz;
    hud.where.textContent = root.clientWidth < 520
      ? `${formatClock(row.t, tz, { weekday: false })} · +${formatDuration((row.t - ev.departureUtc) / 1000, { compact: true })} · ${compass(smp.heading)}`
      : `${formatClock(row.t, tz)} · ${formatDuration((row.t - ev.departureUtc) / 1000)} into the trip · heading ${compass(smp.heading)}`;
    const ahead = [];
    const seen = new Set(rowConditions(row));
    for (let j = i + 1; j < ev.rows.length && ahead.length < 3; j++) {
      for (const c of rowConditions(ev.rows[j])) {
        if (seen.has(c) || c === 'night' || c === 'sun-aligned') continue;
        seen.add(c);
        ahead.push(`${COND_LABEL[c]} in ${fmt.dist(model.samples[j].distM - smp.distM)}`);
      }
    }
    hud.ahead.textContent = ahead.length ? `Ahead (projected): ${ahead.join(' · ')}` : 'No new projected conditions ahead';
    hud.level.textContent = LEVELS[level].name;
  }

  function updateButtons() {
    hud.play.textContent = playing ? 'Pause' : 'Play';
    hud.play.setAttribute('aria-pressed', String(playing));
  }

  function frame(now) {
    raf = 0;
    if (!playing || !visible || !model) return;
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    cur = Math.min(maxIdx(), cur + 25 * dt);
    follow(true);
    if (now - lastAdvance > 200) {
      lastAdvance = now;
      onAdvance(Math.round(cur));
    }
    if (cur >= maxIdx()) {
      playing = false;
      updateButtons();
      onAdvance(Math.round(cur));
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  const api = {
    setTrip(m, e) {
      model = m;
      ev = e;
      cur = Math.min(cur, maxIdx());
      map.getSource('route')?.setData(routeFeatures(model, ev));
      if (visible) follow(true);
    },
    setCurrent(i) {
      if (playing) return;
      cur = Math.max(0, Math.min(maxIdx(), i));
      if (visible) follow(false);
    },
    show(on) {
      visible = on;
      if (!on) {
        playing = false;
        updateButtons();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        map.resize();
        follow(true);
      }
    },
    togglePlay() {
      if (!model) return;
      if (!playing && cur >= maxIdx()) cur = 0;
      playing = !playing;
      updateButtons();
      lastT = 0;
      if (playing) raf ||= requestAnimationFrame(frame);
      else onAdvance(Math.round(cur));
    },
    returnToCurrent() {
      follow(false);
    },
    setLevel(l) {
      level = Math.max(0, Math.min(LEVELS.length - 1, l));
      follow(false);
    },
    get state() {
      return { cur: Math.round(cur), level, playing, visible };
    },
    map,
  };

  root.querySelector('[data-act="play"]').addEventListener('click', () => api.togglePlay());
  root.querySelector('[data-act="return"]').addEventListener('click', () => api.returnToCurrent());
  root.querySelector('[data-act="nearer"]').addEventListener('click', () => api.setLevel(level - 1));
  root.querySelector('[data-act="farther"]').addEventListener('click', () => api.setLevel(level + 1));
  window.addEventListener('resize', () => visible && map.resize());
  return api;
}
