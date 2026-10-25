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
import { createTerrainFx } from './terrainfx.js';
import { previewLabel, previewStep, handleViewKey } from './chase3d.js';

const LEVELS = [
  { name: 'Close', zoom: 14, pitch: 74, ahead: 350 },
  { name: 'Near', zoom: 12.8, pitch: 72, ahead: 900 },
  { name: 'Far', zoom: 11.5, pitch: 66, ahead: 2200 },
  { name: 'Wide', zoom: 10, pitch: 58, ahead: 5000 },
];
const CLEAR_COLOR = '#2f9e44';
const DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> (Mapzen; SRTM, USGS 3DEP and others)';
const OFM_ATTR = '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Post-load map errors (a missing tile, a flaky style source) are expected offline or on bad
// networks: log the first few, then at most one summary line per interval so the console is not
// flooded and the HUD keeps working.
export function makeErrorThrottle({ log = (...a) => console.warn(...a), first = 3, intervalMs = 30000, now = () => Date.now() } = {}) {
  let count = 0;
  let suppressed = 0;
  let lastLog = 0;
  return (err) => {
    count++;
    const t = now();
    if (count <= first) {
      lastLog = t;
      log('terrain view: map error (view keeps working):', err?.message || err);
    } else if (t - lastLog >= intervalMs) {
      log(`terrain view: ${suppressed + 1} further map errors suppressed`);
      lastLog = t;
      suppressed = 0;
    } else suppressed++;
    return count;
  };
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

const FLY_MS = 1800;
const TERRAIN = { source: 'dem', exaggeration: 1.4 };
// Top-left tag: simulated playback by default; while GPS follow is on (main.js gpsFollowing →
// setGpsLabel) the represented position is the GPS fix snapped to the planned route.
export const TERRAIN_TAG_SIM = 'Simulated playback of the planned route · real terrain (AWS Terrain Tiles) · not GPS';
export const TERRAIN_TAG_GPS = 'Snapped to your GPS position on the planned route · real terrain (AWS Terrain Tiles)';
const MAP_LABEL = '3D terrain view of the planned route. Scroll, swipe or use arrow keys to look ahead or behind; pinch, Ctrl+scroll or plus/minus change the camera distance; Space plays or pauses.';
const NARROW_MQ = '(max-width: 640px)';

export async function createTerrainView(root, { onAdvance, onPreview = () => {}, onLevel = () => {}, onStatus = () => {}, getFmt, reducedMotion, level: level0 = 1 }) {
  if (!hasWebGL()) throw new Error('WebGL unavailable');
  const motionOk = () => !reducedMotion() && !document.body.classList.contains('motion-off');
  const maplibregl = (await import('maplibre-gl')).default;
  await import('maplibre-gl/dist/maplibre-gl.css');

  root.innerHTML = `
    <div class="terrain-map" tabindex="0" role="application" aria-roledescription="3D map" aria-label="${MAP_LABEL} Simulated playback, not GPS."></div>
    <div class="chase-top">
      <span class="chase-tag" data-hud="tag">${TERRAIN_TAG_SIM}</span>
      <span class="chase-where" data-hud="where"></span>
      <span class="chase-state terrain-state" data-hud="state"></span>
      <button type="button" class="terrain-note-toggle" data-act="note" aria-expanded="true" aria-controls="terrain-note-text" aria-label="About this 3D terrain view" title="About this view">ⓘ</button>
      <span class="terrain-note" id="terrain-note-text" data-hud="note">Loads online map + elevation tiles; scenario weather stays hand-set · sky, sun glow, rain/snow, fog, night and wind effects and hillshade light follow the represented sample (visual only, not used for glare)</span>
    </div>
    <div class="chase-ahead terrain-ahead" data-hud="ahead"></div>
    <div class="chase-controls" role="group" aria-label="3D terrain controls">
      <button type="button" class="chip-btn" data-act="play" aria-pressed="false" title="Play / pause (Space)">Play</button>
      <button type="button" class="chip-btn" data-act="back" aria-label="Look behind" title="Look behind (← / ↓)">◀</button>
      <button type="button" class="chip-btn" data-act="fwd" aria-label="Look ahead" title="Look ahead (→ / ↑)">▶</button>
      <button type="button" class="chip-btn" data-act="return" disabled title="Return to playback position (Home / Esc)">Return to playback position</button>
      <span class="chase-zoom" role="group" aria-label="Camera distance"><button type="button" class="chip-btn" data-act="farther" aria-label="Camera farther (−)" title="Camera farther (− key)">−</button><span data-hud="level" aria-label="Camera level">Near</span><button type="button" class="chip-btn" data-act="nearer" aria-label="Camera nearer (+)" title="Camera nearer (+ key)">+</button></span>
    </div>
    <p class="terrain-lost" data-hud="lost" role="status" hidden style="position:absolute;inset:auto 10px 50%;z-index:3;margin:0;padding:10px 12px;border-radius:10px;background:#fff4e6;color:#7a3d00;font-size:13px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)"></p>`;
  const hud = {
    where: root.querySelector('[data-hud="where"]'),
    ahead: root.querySelector('[data-hud="ahead"]'),
    level: root.querySelector('[data-hud="level"]'),
    play: root.querySelector('[data-act="play"]'),
    ret: root.querySelector('[data-act="return"]'),
    state: root.querySelector('[data-hud="state"]'),
    lost: root.querySelector('[data-hud="lost"]'),
    note: root.querySelector('[data-hud="note"]'),
    noteBtn: root.querySelector('[data-act="note"]'),
    tag: root.querySelector('[data-hud="tag"]'),
    map: root.querySelector('.terrain-map'),
  };
  // Long data/visual-only note: expanded by default on desktop, collapsed behind the ⓘ toggle on
  // narrow screens (≤ 640 px) so it does not cover the mobile HUD. A user choice sticks.
  const narrow = window.matchMedia?.(NARROW_MQ);
  let noteChosen = false;
  const setNote = (open) => {
    hud.note.hidden = !open;
    hud.noteBtn.setAttribute('aria-expanded', String(open));
  };
  setNote(!narrow?.matches);
  hud.noteBtn.addEventListener('click', () => {
    noteChosen = true;
    setNote(hud.note.hidden);
  });
  const onNarrow = (e) => { if (!noteChosen) setNote(!e.matches); };
  narrow?.addEventListener?.('change', onNarrow);

  const map = new maplibregl.Map({
    container: root.querySelector('.terrain-map'),
    style: {
      version: 8,
      sources: {
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: OSM_ATTR },
        // 3D buildings: OpenFreeMap vector tiles (OpenMapTiles schema, 'building' layer, z14 max)
        ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: OFM_ATTR },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: DEM_ATTR },
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm' },
        { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315 } },
        {
          id: 'buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 14,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': '#d4d7dc',
            'fill-extrusion-opacity': 0.8,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          },
        },
      ],
      sky: {},
    },
    center: [-72.52, 42.37],
    zoom: 10,
    pitch: 60,
    maxPitch: 85,
    // the camera is driven by the shared playback/preview state: wheel/swipe preview ahead or
    // behind and pinch / Ctrl+wheel / +/− change the camera level (handled below), as in the chase
    interactive: false,
    attributionControl: { compact: true },
    // reduced motion / motion-off: no tile/label cross-fades
    fadeDuration: motionOk() ? 300 : 0,
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
  const logError = makeErrorThrottle();
  let errorCount = 0;
  map.on('error', (e) => { errorCount = logError(e?.error || e); }); // throttled post-load tile/style errors
  // WebGL context loss (GPU reset, too many contexts, tab backgrounded on mobile): never throw;
  // stop playback, show an explanation inside this view and recover if the context returns.
  let contextLost = false;
  const LOST_MSG = '3D terrain paused: the browser lost its WebGL graphics context. Switch to 3D or 2D view, or wait for it to recover.';
  map.on('webglcontextlost', () => {
    contextLost = true;
    stopPlayback(true);
    hud.lost.textContent = LOST_MSG;
    hud.lost.hidden = false;
  });
  // Restore: MapLibre 4.7 builds a new Painter on 'webglcontextrestored' but keeps map.terrain
  // (and its render-to-texture framebuffers) bound to the OLD painter/context, and tile
  // textures / hillshade FBOs of the dead context; the next terrain frame then throws
  // "Framebuffer is not complete" (seen in the SwiftShader visual suite). So, synchronously
  // (before that frame): drop the stale terrain, then rebuild the style from its own snapshot
  // (sources, layers, route data, hillshade light and terrain) so every GL resource is
  // recreated on the new context. Camera/HUD follow once the rebuilt style has loaded.
  let restoring = false;
  map.on('webglcontextrestored', () => {
    contextLost = false;
    hud.lost.hidden = true;
    hud.lost.textContent = '';
    restoring = true;
    let snapshot = null;
    try {
      snapshot = map.getStyle();
      map.setTerrain(null);
      map.setStyle(snapshot, { diff: false });
    } catch (err) {
      logError(err);
    }
    const done = () => {
      if (!restoring || destroyed) return;
      restoring = false;
      try { if (!map.getTerrain()) map.setTerrain(TERRAIN); } catch (err) { logError(err); }
      lastAz = null;
      if (model) try { map.getSource('route')?.setData(routeFeatures(model, ev)); } catch (err) { logError(err); }
      if (visible) safeFollow(true);
    };
    if (snapshot) map.once('style.load', done);
    else done();
    setTimeout(done, 15000); // style never finished loading (offline): still resume the view
  });
  // When the card is not very wide the expanded (now three-provider) attribution would cover the playback controls: start it
  // collapsed behind MapLibre's (i) button, which still shows the full credits on tap.
  if (root.clientWidth < 1200) root.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  map.setTerrain(TERRAIN);
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5.5 } });

  const carEl = document.createElement('div');
  carEl.className = 'terrain-car';
  carEl.setAttribute('aria-label', 'Simulated playback position');
  // weather / light / wind overlay for the represented row (visual only; see terrainfx.js)
  const fx = createTerrainFx(map.getCanvasContainer(), { map, motionOk, getFmt, after: map.getCanvas() });
  const car = new maplibregl.Marker({ element: carEl, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat([-72.52, 42.37]).addTo(map);

  let model = null;
  let ev = null;
  let cur = 0;
  let level = Math.max(0, Math.min(LEVELS.length - 1, level0));
  let preview = 0; // look-ahead offset in samples (as in the chase view)
  let lastStatus = '';
  let flying = false;
  let playing = false;
  let visible = false;
  let raf = 0;
  let lastT = 0;
  let lastAdvance = 0;
  let lastAz = null;
  let stepTimer = 0;
  let destroyed = false;
  const maxIdx = () => (model ? model.samples.length - 1 : 0);
  const displayIdx = () => Math.max(0, Math.min(maxIdx(), Math.round(cur + preview)));
  // preview marker (dashed ring) at the previewed sample; the car stays at the playback position
  const ghostEl = document.createElement('div');
  ghostEl.className = 'terrain-preview-pin';
  ghostEl.setAttribute('aria-hidden', 'true');
  const ghost = new maplibregl.Marker({ element: ghostEl }).setLngLat([-72.52, 42.37]);

  function safeFollow(instant) {
    try {
      follow(instant);
    } catch (err) {
      // a lost context or a half-loaded style must not break the controller
      logError(err);
    }
  }

  function stopPlayback(notify) {
    const was = playing;
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (stepTimer) clearInterval(stepTimer);
    stepTimer = 0;
    try { map.stop(); } catch { /* ignore */ }
    updateButtons();
    if (was && notify && model) onAdvance(Math.round(cur));
  }

  // Reduced motion / motion-off playback: discrete jumps (no per-frame camera animation).
  function step() {
    if (!playing || !visible || !model || contextLost) return stopPlayback(false);
    cur = Math.min(maxIdx(), cur + 12);
    safeFollow(true);
    onAdvance(Math.round(cur));
    if (cur >= maxIdx()) stopPlayback(false);
  }

  function cameraFor(i) {
    const smp = model.samples[i];
    const L = LEVELS[level];
    const ahead = pointAtDistance(model.route, Math.min(model.route.totalDistM, smp.distM + L.ahead));
    return { center: [ahead.lon, ahead.lat], bearing: smp.heading, pitch: L.pitch, zoom: L.zoom };
  }

  function follow(instant) {
    if (!model || destroyed || contextLost || restoring) return;
    const c = model.samples[Math.round(cur)];
    car.setLngLat([c.lon, c.lat]).setRotation(c.heading);
    const i = displayIdx();
    const smp = model.samples[i];
    if (i !== Math.round(cur)) ghost.setLngLat([smp.lon, smp.lat]).addTo(map);
    else ghost.remove();
    const opts = cameraFor(i);
    flying = false;
    if (instant || !motionOk()) map.jumpTo(opts);
    else map.easeTo({ ...opts, duration: 600 });
    const az = ev.rows[i]?.sun?.azimuth;
    if (Number.isFinite(az) && (lastAz == null || Math.abs(az - lastAz) > 2)) {
      lastAz = az;
      map.setPaintProperty('hillshade', 'hillshade-illumination-direction', ((az % 360) + 360) % 360);
    }
    fx.setRow(ev.rows[i], [smp.lon, smp.lat]);
    updateHud();
  }

  function updateHud() {
    if (!model) return;
    const fmt = getFmt();
    const i = displayIdx();
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
    const st = previewLabel(model, ev, Math.round(cur), i, fmt, playing);
    hud.state.textContent = st.text;
    hud.ret.disabled = !st.previewing;
    if (st.text !== lastStatus && visible) onStatus((lastStatus = st.text));
  }

  function setPreview(p, { notify = true } = {}) {
    if (!model || destroyed) return;
    if (playing) stopPlayback(true);
    preview = Math.max(-cur, Math.min(maxIdx() - cur, p));
    if (notify) onPreview(displayIdx() === Math.round(cur) ? null : displayIdx());
    if (visible) safeFollow(false);
  }

  function updateButtons() {
    hud.play.textContent = playing ? 'Pause' : model && cur >= maxIdx() ? 'Replay' : 'Play';
    hud.play.setAttribute('aria-pressed', String(playing));
  }

  function frame(now) {
    raf = 0;
    if (!playing || !visible || !model || contextLost) return;
    if (!motionOk()) {
      // motion was switched off during playback: continue as discrete steps
      stepTimer ||= setInterval(step, 600);
      return;
    }
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    cur = Math.min(maxIdx(), cur + 25 * dt);
    safeFollow(true);
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
      if (destroyed) return;
      // a new trip: stop any playback of the old one; the single 'route' source is replaced
      // in place (setData), so repeated trips never add duplicate sources, layers or markers
      stopPlayback(false);
      model = m;
      ev = e;
      lastAz = null;
      cur = Math.max(0, Math.min(cur, maxIdx()));
      try { map.getSource('route')?.setData(routeFeatures(model, ev)); } catch (err) { logError(err); }
      if (visible) safeFollow(true);
    },
    setCurrent(i) {
      if (playing || destroyed) return;
      cur = Math.max(0, Math.min(maxIdx(), i));
      preview = 0;
      if (visible) safeFollow(false);
    },
    // --- GPS follow label hook (b3-gps) ---
    /** Show the shared "Following your location (GPS)" label over the terrain view ('' hides it). */
    setGpsLabel(text) {
      if (destroyed) return;
      let el = root.querySelector('[data-hud="gps"]');
      if (!el) {
        el = document.createElement('div');
        el.className = 'chase-gps terrain-gps';
        el.dataset.hud = 'gps';
        el.setAttribute('role', 'status');
        root.appendChild(el);
      }
      el.textContent = text || '';
      el.hidden = !text;
      // keep the tag and the map's accessible name consistent with the GPS label
      hud.tag.textContent = text ? TERRAIN_TAG_GPS : TERRAIN_TAG_SIM;
      hud.map.setAttribute('aria-label', `${MAP_LABEL} ${text ? 'Following your GPS position snapped to the planned route; conditions are still the planned forecast.' : 'Simulated playback, not GPS.'}`);
    },
    // --- end GPS follow label hook ---
    /** Restore a shared preview (absolute sample index, or null) without changing playback. */
    setPreviewIdx(idx) {
      if (!model || playing || destroyed) return;
      preview = idx == null ? 0 : Math.max(-cur, Math.min(maxIdx() - cur, idx - Math.round(cur)));
      if (visible) safeFollow(true);
    },
    /**
     * Show / hide. `flyFrom` ({ center: [lon, lat], zoom }) animates the camera from the 2D map's
     * view to the chase-like camera (MapLibre flyTo); instant with reduced motion / Animation off.
     */
    show(on, { flyFrom = null } = {}) {
      if (destroyed) return;
      visible = on;
      if (!on) {
        // hidden: stop timers and any in-flight camera ease so nothing keeps re-rendering;
        // a running playback hands its reached position to the shared state
        stopPlayback(true);
        flying = false;
        fx.show(false);
      } else {
        fx.show(true);
        try { map.resize(); } catch (err) { logError(err); }
        updateHud();
        safeFollow(true);
        if (flyFrom && model && motionOk() && !contextLost) {
          try {
            const target = cameraFor(displayIdx());
            map.jumpTo({ center: flyFrom.center, zoom: flyFrom.zoom, pitch: 0, bearing: 0 });
            flying = true;
            map.flyTo({ ...target, duration: FLY_MS, curve: 1.3 });
            map.once('moveend', () => { flying = false; });
          } catch (err) {
            logError(err);
            safeFollow(true);
          }
        }
      }
    },
    togglePlay() {
      if (!model || destroyed || contextLost) return;
      if (playing) return stopPlayback(true);
      if (preview !== 0) {
        preview = 0;
        onPreview(null);
      }
      if (cur >= maxIdx()) cur = 0;
      playing = true;
      updateButtons();
      lastT = 0;
      if (motionOk()) raf ||= requestAnimationFrame(frame);
      else stepTimer ||= setInterval(step, 600);
    },
    returnToCurrent() {
      preview = 0;
      onPreview(null);
      safeFollow(false);
    },
    nudge(dir) {
      setPreview(preview + dir * previewStep(level) * 3);
    },
    setLevel(l, { silent = false } = {}) {
      const nl = Math.max(0, Math.min(LEVELS.length - 1, l));
      const changed = nl !== level;
      level = nl;
      if (model) updateHud();
      if (changed && !silent) onLevel(level);
      if (visible) safeFollow(false);
    },
    get level() {
      return level;
    },
    /** Release the map, marker, listeners and timers (e.g. before re-creating the view). */
    destroy() {
      if (destroyed) return;
      stopPlayback(false);
      destroyed = true;
      visible = false;
      window.removeEventListener('resize', onResize);
      narrow?.removeEventListener?.('change', onNarrow);
      try { fx.destroy(); } catch { /* ignore */ }
      try { car.remove(); } catch { /* ignore */ }
      try { ghost.remove(); } catch { /* ignore */ }
      try { map.remove(); } catch { /* ignore */ }
      root.innerHTML = '';
    },
    get state() {
      let camera = null;
      try {
        const c = map.getCenter();
        camera = { lon: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      } catch { /* ignore */ }
      return { cur: Math.round(cur), preview: displayIdx() - Math.round(cur), level, playing, flying, camera, visible, contextLost, errors: errorCount, restoring, terrain: (() => { try { return !!map.getTerrain(); } catch { return null; } })(), noteExpanded: !hud.note.hidden, destroyed, timers: Number(!!raf) + Number(!!stepTimer), fx: fx.state };
    },
    map,
  };

  function onResize() {
    if (visible && !destroyed) try { map.resize(); } catch { /* ignore */ }
  }
  root.querySelector('[data-act="play"]').addEventListener('click', () => api.togglePlay());
  root.querySelector('[data-act="return"]').addEventListener('click', () => api.returnToCurrent());
  root.querySelector('[data-act="nearer"]').addEventListener('click', () => api.setLevel(level - 1));
  root.querySelector('[data-act="farther"]').addEventListener('click', () => api.setLevel(level + 1));
  root.querySelector('[data-act="back"]').addEventListener('click', () => setPreview(preview - previewStep(level) * 5));
  root.querySelector('[data-act="fwd"]').addEventListener('click', () => setPreview(preview + previewStep(level) * 5));

  // Input parity with the chase view: wheel / one-finger swipe = look ahead/behind; pinch,
  // Ctrl+wheel (trackpad pinch) and +/− = camera level; keys as in the chase view.
  const surface = root.querySelector('.terrain-map');
  let zoomAcc = 0;
  surface.addEventListener('wheel', (e) => {
    if (!model) return;
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    if (e.ctrlKey) {
      zoomAcc += d;
      if (Math.abs(zoomAcc) >= 40) {
        api.setLevel(level + Math.sign(zoomAcc));
        zoomAcc = 0;
      }
      return;
    }
    setPreview(preview + Math.sign(d) * previewStep(level) * Math.max(1, Math.min(4, Math.abs(d) / 60)));
  }, { passive: false });
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  const pinchDist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  surface.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, p: preview };
    else if (pointers.size === 2) {
      drag = null;
      pinch = { d: pinchDist() };
    }
  });
  surface.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const r = pinchDist() / pinch.d;
      if (r > 1.3 || r < 0.77) {
        api.setLevel(level + (r > 1 ? -1 : 1));
        pinch.d = pinchDist();
      }
    } else if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const along = Math.abs(dx) > Math.abs(dy) ? -dx : -dy; // swipe left / drag up = look ahead
      if (Math.abs(along) > 4) setPreview(drag.p + (along / 12) * previewStep(level));
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  };
  surface.addEventListener('pointerup', endPointer);
  surface.addEventListener('pointercancel', endPointer);
  surface.addEventListener('keydown', (e) => handleViewKey(e, api));
  window.addEventListener('resize', onResize);
  // QA hook for the manual visual check (tests/e2e/terrain-visual.mjs): only with ?qa in the URL
  if (/[?&]qa\b/.test(location.search)) window.__gpTerrain = api;
  return api;
}
