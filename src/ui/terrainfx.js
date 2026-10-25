// terrainfx.js — lightweight weather / light / wind effects for the MapLibre "3D terrain" view.
// A transparent 2D <canvas> above the map (pointer-events:none) draws rain/snow particles slanted
// by the wind relative to the camera bearing, a fog veil from visibility, night darkening with a
// headlight cone at the car, a low-sun glow/wash at the screen position of the sun direction and
// a small wind gauge. The sky above the horizon is MapLibre's own sky (setSky, available in
// MapLibre GL 4.x), coloured here from the represented row. Everything is VISUAL ONLY and comes
// from the represented sample (scenario/forecast row); it is not used for any glare decision.
// Pure helpers are exported for unit tests (tests/unit/terrainfx.test.mjs).

export const DEFAULT_FOV = 36.87; // MapLibre's default vertical field of view (degrees)
export const MAX_PARTICLES = 300;
const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Signed difference a − b in degrees, in (−180, 180]. */
export function signedAngle(a, b) {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** 0 by day, 1 at night (sun below −6°), linear through civil twilight. */
export function nightFactor(altitude) {
  if (!Number.isFinite(altitude)) return 0;
  if (altitude < -6) return 1;
  if (altitude < -0.833) return (-0.833 - altitude) / 5.167;
  return 0;
}

/**
 * Pixels from the top of the viewport to the horizon line for a MapLibre camera (pitch measured
 * from nadir, 0 = top-down). Negative when the horizon is above the top edge.
 */
export function horizonY({ pitch, fov = DEFAULT_FOV, height }) {
  const F = height / 2 / Math.tan((fov * RAD) / 2);
  const dep = (90 - pitch) * RAD; // depression of the view axis below horizontal
  if (dep <= 0) return height / 2;
  return height / 2 - F * Math.tan(dep);
}

/**
 * Screen position of the sun direction (at infinity) for a camera with `bearing` (deg from
 * north, clockwise) and `pitch` (deg from nadir). Returns null when the sun is below the horizon
 * (apparent, −0.833°) or behind the camera; otherwise {x, y, depth, onScreen}. x/y may lie
 * outside the viewport (e.g. a sun ahead but above the top edge at high pitch).
 */
export function sunScreen({ azimuth, altitude, bearing, pitch, fov = DEFAULT_FOV, width, height }) {
  if (!Number.isFinite(azimuth) || !Number.isFinite(altitude) || altitude <= -0.833) return null;
  const rel = signedAngle(azimuth, bearing) * RAD;
  const alt = altitude * RAD;
  const e = (90 - pitch) * RAD;
  // world (right, forward, up) relative to the bearing
  const sr = Math.sin(rel) * Math.cos(alt);
  const sf = Math.cos(rel) * Math.cos(alt);
  const su = Math.sin(alt);
  const depth = sf * Math.cos(e) - su * Math.sin(e); // · camera forward (0, cos e, −sin e)
  if (depth <= 0.02) return null;
  const up = sf * Math.sin(e) + su * Math.cos(e); // · camera up (0, sin e, cos e)
  const F = height / 2 / Math.tan((fov * RAD) / 2);
  const x = width / 2 + (F * sr) / depth;
  const y = height / 2 - (F * up) / depth;
  return { x, y, depth, onScreen: x >= 0 && x <= width && y >= 0 && y <= height };
}

/** Number of rain/snow particles drawn for a precipitation rate (mm/h), capped at `max`. */
export function particleCount(precip, snowing = false, max = MAX_PARTICLES) {
  if (!Number.isFinite(precip) || precip < 0.1) return 0;
  return Math.min(max, Math.round(40 + precip * (snowing ? 60 : 45)));
}

/** Opacity of the fog veil for a visibility in metres (0 at ≥ 8 km, at most 0.8). */
export function fogAlpha(visibility) {
  if (!Number.isFinite(visibility) || visibility >= 8000) return 0;
  return clamp((8000 - Math.max(0, visibility)) / 8000, 0, 0.8);
}

/**
 * Wind relative to the camera: `rel` is the direction the wind blows TOWARD, relative to the
 * bearing (0 = blowing ahead/away, 90 = to the right); `slant` (−1..1) is the screen-x drift
 * per unit fall used for rain streaks; `speed` is gusts (or mean wind) in km/h.
 */
export function windRelative(wx, bearing) {
  const speed = wx?.windGusts ?? wx?.windSpeed ?? 0;
  if (wx?.windDirection == null) return { rel: null, slant: 0, speed };
  const rel = signedAngle(wx.windDirection + 180, bearing);
  return { rel, slant: Math.sin(rel * RAD) * Math.min(1, speed / 60), speed };
}

/** Low-sun glow strength: brighter for expected glare ≥ 2, dimmed by cloud cover. */
export function glowStrength(expected = 0, cloud = 0) {
  const dim = cloud >= 85 ? 0.35 : cloud >= 60 ? 0.6 : 1;
  const strong = expected >= 2;
  return { alpha: (strong ? 0.95 : 0.6) * dim, radius: strong ? 0.75 : 0.32, wash: strong ? (expected >= 3 ? 0.6 : 0.45) * dim : 0 };
}

function mixHex(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * clamp(t, 0, 1)).toString(16).padStart(2, '0')).join('');
}

/** MapLibre sky specification for the represented row (sun altitude, cloud cover, visibility). */
export function skySpec(row) {
  const alt = row?.sun?.altitude ?? 30;
  const cloud = row?.wx?.cloudCover ?? 0;
  const night = nightFactor(alt);
  const low = alt > -0.833 && alt < 12 ? 1 - Math.max(0, alt) / 12 : 0; // golden hour tint
  let sky = mixHex('#4a8fd8', '#0b1430', night);
  let horizon = mixHex(mixHex('#bcd8f0', '#ffb070', low), '#2a3150', night);
  const grey = night > 0.5 ? '#2c3142' : '#b8bec8';
  const c = clamp((cloud - 30) / 70, 0, 1) * 0.8;
  sky = mixHex(sky, grey, c);
  horizon = mixHex(horizon, grey, c * 0.8);
  const fa = fogAlpha(row?.wx?.visibility);
  const fog = night > 0.5 ? '#3a4054' : '#dde1e7';
  return {
    'sky-color': sky,
    'horizon-color': horizon,
    'fog-color': mixHex(horizon, fog, Math.min(1, fa * 1.4)),
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.5 + fa * 0.5,
    // fog-ground-blend: 1 = fog only at the horizon; lower values pull it toward the camera
    'fog-ground-blend': Number((0.9 - fa * 0.8).toFixed(3)),
    'atmosphere-blend': 0.6,
  };
}

/** Everything the overlay needs for one frame, derived from the row and camera. */
export function fxParams(row, cam) {
  const wx = row?.wx || null;
  const alt = row?.sun?.altitude;
  const night = nightFactor(alt);
  const snowing = !!row?.hz?.snow;
  const precip = wx?.precipitation ?? 0;
  const wind = windRelative(wx, cam.bearing);
  const sun = row?.sun ? sunScreen({ azimuth: row.sun.azimuth, altitude: alt, ...cam }) : null;
  return {
    night,
    snowing,
    precip,
    particles: particleCount(precip, snowing),
    fog: fogAlpha(wx?.visibility),
    wind,
    sun,
    glow: glowStrength(row?.expected ?? 0, wx?.cloudCover ?? 0),
    streaks: wind.speed >= 30 ? Math.min(24, Math.round((wind.speed - 20) / 3)) : 0,
    hasWx: !!wx,
  };
}

/** Deterministic pseudo-random seeds so static (reduced-motion) frames are stable. */
function seeds(n, k) {
  let s = k;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({ x: r(), y: r(), s: 0.6 + r() * 0.8, l: 0.04 + r() * 0.06 }));
}

/**
 * Overlay controller. `map` is the MapLibre map; `motionOk()` says whether continuous animation
 * is allowed; `getFmt()` supplies unit formatting for the wind gauge. Call setRow() whenever the
 * represented sample changes, show() on visibility changes and destroy() on teardown.
 */
export function createTerrainFx(container, { map, motionOk, getFmt, after = null }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'terrain-fx';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  // inserted right after the map's WebGL canvas so markers (the car) and controls stay on top
  if (after) after.after(canvas);
  else container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const drops = seeds(MAX_PARTICLES, 7);
  const streaks = seeds(24, 11);
  let row = null;
  let carLngLat = null;
  let visible = false;
  let raf = 0;
  let t0 = 0;
  let lastSky = '';
  let destroyed = false;
  let frames = 0;

  function cam() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    let fov = DEFAULT_FOV;
    try { fov = Number.isFinite(map.transform?.fov) ? map.transform.fov : DEFAULT_FOV; } catch { /* ignore */ }
    return { bearing: map.getBearing(), pitch: map.getPitch(), fov, width: W, height: H };
  }

  function applySky() {
    if (!row || typeof map.setSky !== 'function') return;
    const spec = skySpec(row);
    const key = JSON.stringify(spec);
    if (key === lastSky) return;
    lastSky = key;
    try { map.setSky(spec); } catch { /* style not ready / unsupported: overlay still works */ }
  }

  function draw(time) {
    if (destroyed || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = cam();
    const W = Math.max(1, Math.round(c.width * dpr));
    const H = Math.max(1, Math.round(c.height * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.clearRect(0, 0, W, H);
    if (!row) return;
    frames++;
    const p = fxParams(row, c);
    const moving = motionOk() && visible;
    const tm = moving ? time / 1000 : 0;
    const hy = horizonY(c) * dpr;

    // Night darkening with a headlight cone ahead of the car (screen "up" = heading).
    if (p.night > 0) {
      ctx.fillStyle = `rgba(4,8,24,${0.5 * p.night})`;
      ctx.fillRect(0, 0, W, H);
      let cp = null;
      try { cp = carLngLat && map.project(carLngLat); } catch { /* ignore */ }
      if (cp && cp.x >= 0 && cp.x <= c.width && cp.y >= 0 && cp.y <= c.height) {
        const x0 = cp.x * dpr;
        const y0 = cp.y * dpr;
        const len = Math.max(60 * dpr, (y0 - Math.max(0, hy)) * 0.8);
        const g = ctx.createRadialGradient(x0, y0, 0, x0, y0, len);
        g.addColorStop(0, `rgba(255,240,190,${0.55 * p.night})`);
        g.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x0 - 4 * dpr, y0);
        ctx.lineTo(x0 - len * 0.32, y0 - len);
        ctx.lineTo(x0 + len * 0.32, y0 - len);
        ctx.lineTo(x0 + 4 * dpr, y0);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Fog veil, thicker toward the horizon.
    if (p.fog > 0) {
      const fc = p.night > 0.5 ? '70,76,96' : '222,226,232';
      const g = ctx.createLinearGradient(0, Math.max(0, hy), 0, H);
      g.addColorStop(0, `rgba(${fc},${p.fog})`);
      g.addColorStop(1, `rgba(${fc},${p.fog * 0.35})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Low-sun glow at the sun direction's screen position (may sit just above the top edge).
    const s = p.sun;
    if (s && s.x > -c.width * 0.5 && s.x < c.width * 1.5) {
      // a sun ahead but above the top edge (typical at the map's steep camera pitch) still
      // washes in from the top: its glow is centred just above the visible area
      const sx = s.x * dpr;
      const sy = Math.max(s.y, -c.height * 0.04) * dpr;
      const R = Math.max(W, H) * p.glow.radius;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
      g.addColorStop(0, `rgba(255,238,175,${p.glow.alpha})`);
      g.addColorStop(0.25, `rgba(255,214,140,${p.glow.alpha * 0.5})`);
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (s.onScreen) {
        ctx.beginPath();
        ctx.arc(sx, sy, H * 0.025, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,246,210,${Math.min(1, p.glow.alpha + 0.1)})`;
        ctx.fill();
      }
      if (p.glow.wash > 0) {
        const w = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.9);
        w.addColorStop(0, `rgba(255,248,220,${p.glow.wash})`);
        w.addColorStop(1, 'rgba(255,248,220,0)');
        ctx.fillStyle = w;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Rain streaks / snowflakes (screen space, slanted by the cross-wind).
    if (p.particles) {
      const sl = p.wind.slant;
      ctx.strokeStyle = 'rgba(215,232,255,.72)';
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 1.4 * dpr;
      ctx.beginPath();
      for (let k = 0; k < p.particles; k++) {
        const d = drops[k];
        const fall = tm * (p.snowing ? 0.08 : 0.9) * d.s;
        const y = (((d.y + fall) % 1) + 1) % 1;
        const x = (((d.x + tm * sl * (p.snowing ? 0.05 : 0.2) + y * sl * 0.15) % 1) + 1) % 1;
        if (p.snowing) {
          ctx.moveTo(x * W + 1.9 * dpr * d.s, y * H);
          ctx.arc(x * W, y * H, 1.9 * dpr * d.s, 0, Math.PI * 2);
        } else {
          ctx.moveTo(x * W, y * H);
          ctx.lineTo(x * W + sl * 12 * dpr, y * H + 17 * dpr * d.s);
        }
      }
      if (p.snowing) ctx.fill();
      else ctx.stroke();
    }
    // Wind streaks for strong gusts.
    if (p.streaks) {
      const dir = (p.wind.rel ?? 90) >= 0 ? 1 : -1;
      const side = Math.abs(Math.sin(((p.wind.rel ?? 90) * Math.PI) / 180));
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      for (let k = 0; k < p.streaks; k++) {
        const st = streaks[k];
        const x = (((st.x + tm * 0.25 * dir * (0.4 + side)) % 1) + 1) % 1;
        const y = 0.15 + st.y * 0.7;
        ctx.moveTo(x * W, y * H);
        ctx.quadraticCurveTo((x + dir * st.l * 0.5) * W, y * H - 4 * dpr, (x + dir * st.l) * W, y * H);
      }
      ctx.stroke();
    }

    // Wind gauge (left edge, mid-height: clear of the top HUD, controls and attribution).
    const r = 30 * dpr;
    // left edge (the right edge can be clipped by the card / attribution in narrow layouts)
    const gx = r + 12 * dpr;
    const gy = Math.round(H * 0.56);
    ctx.fillStyle = 'rgba(15,27,51,.62)';
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.wind.rel != null) {
      const a = p.wind.rel * RAD;
      const L = r * 0.62;
      const tx = gx + Math.sin(a) * L;
      const ty = gy - Math.cos(a) * L;
      ctx.strokeStyle = '#38d9a9';
      ctx.fillStyle = '#38d9a9';
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(gx - Math.sin(a) * L, gy + Math.cos(a) * L);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.sin(a - 0.5) * 8 * dpr, ty + Math.cos(a - 0.5) * 8 * dpr);
      ctx.lineTo(tx - Math.sin(a + 0.5) * 8 * dpr, ty + Math.cos(a + 0.5) * 8 * dpr);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `${9 * dpr}px system-ui, sans-serif`;
    ctx.fillText('▲ view', gx, gy - r * 0.66);
    let label = 'wind —';
    try { if (p.hasWx) label = `wind ${getFmt().speed(p.wind.speed)}`; } catch { /* ignore */ }
    // caption on a dark rounded pill under the dial (readable over bright sky/terrain/snow)
    ctx.font = `700 ${10.5 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const ph = 17 * dpr;
    const pw = tw + 12 * dpr;
    const px = Math.max(4 * dpr, gx - pw / 2);
    const py = gy + r + 4 * dpr;
    ctx.fillStyle = 'rgba(15,27,51,.86)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, ph / 2);
    else ctx.rect(px, py, pw, ph);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px + pw / 2, py + ph / 2 + 0.5 * dpr);
    ctx.textBaseline = 'alphabetic';

    Object.assign(canvas.dataset, {
      particles: String(p.particles),
      snow: String(p.snowing),
      fog: p.fog.toFixed(2),
      night: p.night.toFixed(2),
      sun: s ? (s.onScreen ? 'on-screen' : 'off-screen') : 'none',
      glare: String(row.expected ?? 0),
      wind: p.wind.rel == null ? '' : String(Math.round(p.wind.rel)),
      animating: String(!!raf || false),
    });
  }

  // Continuous animation only for moving particles/streaks, only while visible and motion is on.
  const needsAnim = () => {
    if (!row || !visible || !motionOk()) return false;
    const wx = row.wx;
    return particleCount(wx?.precipitation ?? 0, !!row.hz?.snow) > 0 || (wx?.windGusts ?? wx?.windSpeed ?? 0) >= 30;
  };
  function loop(now) {
    raf = 0;
    if (!needsAnim()) return draw(0);
    raf = requestAnimationFrame(loop);
    draw(now - t0);
  }
  function refresh() {
    if (destroyed) return;
    if (!visible) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    if (needsAnim()) {
      if (!raf) {
        t0 ||= performance.now();
        raf = requestAnimationFrame(loop);
      }
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      draw(0);
    }
  }
  // camera moves (eases, user drags, resizes) re-draw a static frame when not animating
  const onMove = () => { if (visible && !raf) draw(0); };
  map.on('move', onMove);
  map.on('resize', onMove);

  return {
    setRow(r, lngLat) {
      row = r || null;
      carLngLat = lngLat || null;
      applySky();
      refresh();
    },
    show(on) {
      visible = !!on;
      canvas.hidden = !visible;
      refresh();
    },
    /** Re-evaluate animation after a motion setting change. */
    refresh,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try { map.off('move', onMove); map.off('resize', onMove); } catch { /* ignore */ }
      canvas.remove();
    },
    get state() {
      return { animating: !!raf, visible, frames, particles: row ? particleCount(row.wx?.precipitation ?? 0, !!row.hz?.snow) : 0 };
    },
    canvas,
  };
}
