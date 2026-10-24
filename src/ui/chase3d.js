// chase3d.js — third-person "chase" preview along the PLANNED route (not GPS).
// A lightweight perspective renderer on <canvas>: the actual routed geometry is projected
// from a camera behind and above a simulated vehicle position. Sky, sun, clouds, rain, snow,
// fog, wind streaks, darkness and assumed-delay traffic are drawn from the projected
// conditions of the represented point (its arrival time). No 3D terrain or buildings.
import { pointAtDistance, bearing, signedAngle, compass } from '../lib/geo.js';
import { rowConditions, COND_LABEL } from '../lib/conditions.js';
import { formatClock, formatDuration } from '../lib/time.js';

const LEVELS = [
  { name: 'Close', back: 110, height: 38, ahead: 2500 },
  { name: 'Near', back: 240, height: 95, ahead: 5000 },
  { name: 'Far', back: 520, height: 230, ahead: 11000 },
  { name: 'Wide', back: 1100, height: 520, ahead: 22000 },
];
const COND_COLOR = { glare: '#f08c00', 'sun-aligned': '#ced4da', rain: '#4dabf7', snow: '#da77f2', fog: '#adb5bd', wind: '#38d9a9', jam: '#f06595', night: '#748ffc' };
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a, b, f) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16));
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(',')})`;
}

function skyColors(alt) {
  // [top, horizon]
  if (alt > 12) return ['#3b8de0', '#bfe0ff'];
  if (alt > 2) { const f = (alt - 2) / 10; return [mix('#4a6fb5', '#3b8de0', f), mix('#ffc078', '#bfe0ff', f)]; }
  if (alt > -0.833) return ['#3d4f8f', '#ff9f5a'];
  if (alt > -6) { const f = (alt + 6) / 5.2; return [mix('#151d45', '#3d4f8f', f), mix('#5a3f7a', '#e8855a', f)]; }
  if (alt > -12) { const f = (alt + 12) / 6; return [mix('#070b1f', '#151d45', f), mix('#141a3a', '#5a3f7a', f)]; }
  return ['#050816', '#10162e'];
}

export function createChase(root, { onAdvance, onPreview, getFmt, reducedMotion }) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const hud = {
    where: root.querySelector('[data-hud="where"]'),
    state: root.querySelector('[data-hud="state"]'),
    ahead: root.querySelector('[data-hud="ahead"]'),
    level: root.querySelector('[data-hud="level"]'),
    play: root.querySelector('[data-act="play"]'),
    ret: root.querySelector('[data-act="return"]'),
  };
  let model = null;
  let ev = null;
  let cur = 0; // current (playback) sample index, fractional
  let preview = 0; // look-ahead offset in samples, fractional
  let level = 1;
  let cam = { ...LEVELS[1] };
  let playing = false;
  let visible = false;
  let raf = 0;
  let lastT = 0;
  let lastAdvance = 0;
  let lastPreviewCb = 0;
  let lastHud = 0;
  const rnd = mulberry(7);
  const drops = Array.from({ length: 260 }, () => ({ x: rnd(), y: rnd(), s: 0.6 + rnd() * 0.8 }));
  const clouds = Array.from({ length: 14 }, () => ({ x: rnd(), y: rnd(), w: 0.12 + rnd() * 0.18, h: 0.03 + rnd() * 0.04 }));
  const streaks = Array.from({ length: 26 }, () => ({ x: rnd(), y: rnd(), l: 0.04 + rnd() * 0.06 }));
  const motionOk = () => !reducedMotion() && !document.body.classList.contains('motion-off');

  const maxIdx = () => (model ? model.samples.length - 1 : 0);
  const displayIdx = () => Math.max(0, Math.min(maxIdx(), cur + preview));

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth || 800;
    const h = canvas.clientHeight || 420;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { W: canvas.width, H: canvas.height, dpr };
  }

  function frame(now) {
    raf = 0;
    if (!visible || !model) return;
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000);
    lastT = now;
    if (playing) {
      const speed = Math.max(8, Math.min(40, model.samples.length / 45));
      cur = Math.min(maxIdx(), cur + speed * dt);
      if (cur >= maxIdx()) {
        playing = false;
        updateButtons();
      }
      if (now - lastAdvance > 160) {
        lastAdvance = now;
        onAdvance(Math.round(cur));
      }
    }
    const target = LEVELS[level];
    const k = motionOk() ? 1 - Math.exp(-dt * 5) : 1;
    for (const key of ['back', 'height', 'ahead']) cam[key] += (target[key] - cam[key]) * k;
    draw(now / 1000);
    if (now - lastHud > 200) {
      lastHud = now;
      updateHud();
    }
    if (preview !== 0 && now - lastPreviewCb > 180) {
      lastPreviewCb = now;
      onPreview(Math.round(displayIdx()));
    }
    const settling = Math.abs(cam.back - target.back) > 1;
    if (playing || settling || motionOk()) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  };

  function draw(time) {
    const { W, H, dpr } = resize();
    const idx = displayIdx();
    const i = Math.round(idx);
    const row = ev.rows[i];
    const smp = model.samples;
    const d0 = smp[Math.floor(idx)].distM + (smp[Math.min(maxIdx(), Math.floor(idx) + 1)].distM - smp[Math.floor(idx)].distM) * (idx - Math.floor(idx));
    const total = model.route.totalDistM;
    const p0 = pointAtDistance(model.route, d0);
    const pa = pointAtDistance(model.route, Math.max(0, d0 - 250));
    const pb = pointAtDistance(model.route, Math.min(total, d0 + 450));
    const heading = pa.lat === pb.lat && pa.lon === pb.lon ? smp[i].heading : bearing(pa.lat, pa.lon, pb.lat, pb.lon);
    const hr = (heading * Math.PI) / 180;
    const sinH = Math.sin(hr);
    const cosH = Math.cos(hr);
    const cosLat = Math.cos((p0.lat * Math.PI) / 180);
    const theta = Math.atan(cam.height / (cam.back + cam.ahead * 0.22));
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const F = H * 0.95;
    const cx = W / 2;
    const cy = H * 0.5;
    const horizonY = cy - F * Math.tan(theta);
    const local = (lat, lon) => {
      const e = (lon - p0.lon) * cosLat * M_PER_DEG_LON;
      const n = (lat - p0.lat) * M_PER_DEG_LAT;
      return { f: e * sinH + n * cosH, r: e * cosH - n * sinH };
    };
    const proj = (r, f, u = 0) => {
      const pf = f + cam.back;
      const pu = u - cam.height;
      const depth = pf * ct - pu * st;
      if (depth < 4) return null;
      const vert = pf * st + pu * ct;
      return { x: cx + (F * r) / depth, y: cy - (F * vert) / depth, depth };
    };
    const alt = row.sun.altitude;
    const night = alt < -6 ? 1 : alt < -0.833 ? (-0.833 - alt) / 5.2 : 0;
    const wx = row.wx;
    const cloud = wx?.cloudCover ?? 0;

    // Sky.
    const [top, hor] = skyColors(alt);
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizonY));
    sky.addColorStop(0, top);
    sky.addColorStop(1, hor);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, Math.max(0, horizonY) + 1);
    if (cloud > 30) {
      ctx.fillStyle = `rgba(${night > 0.5 ? '40,46,70' : '210,214,222'},${Math.min(0.75, (cloud - 30) / 90)})`;
      ctx.fillRect(0, 0, W, Math.max(0, horizonY) + 1);
    }

    // Sun (direction at infinity, relative to heading).
    const rel = signedAngle(row.sun.azimuth, heading);
    const relR = (rel * Math.PI) / 180;
    const altR = (Math.max(alt, -2) * Math.PI) / 180;
    const dr = Math.sin(relR) * Math.cos(altR);
    const df = Math.cos(relR) * Math.cos(altR);
    const du = Math.sin(altR);
    const sd = df * ct - du * st;
    let sunScreen = null;
    if (sd > 0.05 && alt > -0.833) {
      sunScreen = { x: cx + (F * dr) / sd, y: cy - (F * (df * st + du * ct)) / sd };
      const rad = H * 0.04;
      const strong = row.expected >= 2;
      const dim = cloud >= 85 ? 0.35 : cloud >= 60 ? 0.6 : 1;
      const glow = ctx.createRadialGradient(sunScreen.x, sunScreen.y, rad * 0.4, sunScreen.x, sunScreen.y, rad * (strong ? 9 : 4));
      glow.addColorStop(0, `rgba(255,236,170,${0.9 * dim})`);
      glow.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.beginPath();
      ctx.arc(sunScreen.x, sunScreen.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,244,200,${dim})`;
      ctx.fill();
    }

    // Clouds.
    if (cloud > 15) {
      const n = Math.round((cloud / 100) * clouds.length);
      const drift = motionOk() ? time * 0.004 : 0;
      ctx.fillStyle = night > 0.5 ? 'rgba(70,78,105,.55)' : 'rgba(255,255,255,.6)';
      for (let c = 0; c < n; c++) {
        const cl = clouds[c];
        const x = (((cl.x + drift) % 1) + 1) % 1;
        ctx.beginPath();
        ctx.ellipse(x * W, (0.05 + cl.y * 0.8) * horizonY, cl.w * W * 0.5, cl.h * H, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ground.
    const ground = ctx.createLinearGradient(0, horizonY, 0, H);
    ground.addColorStop(0, mix('#8fa889', '#1b2233', night));
    ground.addColorStop(1, mix('#5b7a55', '#0d1220', night));
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizonY, W, H - horizonY);

    // Road geometry: route vertices from slightly behind to `ahead`, spaced for the zoom.
    const coords = model.route.coords;
    const cum = model.route.cumDist;
    const spacing = Math.max(8, cam.ahead / 140);
    const pts = [];
    let lastD = -1e9;
    let v = pointAtDistance(model.route, Math.max(0, d0 - cam.back * 1.2)).vertex;
    for (; v < coords.length && cum[v] <= d0 + cam.ahead; v++) {
      if (cum[v] - lastD < spacing) continue;
      lastD = cum[v];
      const l = local(coords[v][0], coords[v][1]);
      pts.push({ ...l, d: cum[v] });
    }
    // Condition color along the road from the evaluated rows (≈1 km samples).
    const rowAt = (d) => ev.rows[Math.max(0, Math.min(maxIdx(), Math.round((d / total) * maxIdx())))];
    const roadW = 7.5;
    for (let k = pts.length - 2; k >= 0; k--) {
      const a = pts[k];
      const b = pts[k + 1];
      const dx = b.r - a.r;
      const dy = b.f - a.f;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * roadW;
      const ny = (dx / len) * roadW;
      const q = [proj(a.r + nx, a.f + ny), proj(b.r + nx, b.f + ny), proj(b.r - nx, b.f - ny), proj(a.r - nx, a.f - ny)];
      if (q.some((p) => !p)) continue;
      ctx.beginPath();
      q.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = mix('#5c6270', '#2a2e38', night * 0.7);
      ctx.fill();
      const conds = rowConditions(rowAt(a.d)).filter((c) => c !== 'night');
      const edge = conds.length ? COND_COLOR[conds[0]] : night > 0.5 ? '#c9cfdb' : '#f1f3f5';
      const w = Math.max(1, (F * 0.9) / Math.max(q[0].depth, 1));
      ctx.strokeStyle = edge;
      ctx.lineWidth = conds.length ? w * 1.8 : w;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      ctx.lineTo(q[1].x, q[1].y);
      ctx.moveTo(q[2].x, q[2].y);
      ctx.lineTo(q[3].x, q[3].y);
      ctx.stroke();
      if (Math.floor(a.d / 60) % 2 === 0) {
        const ca = proj(a.r, a.f);
        const cb = proj(b.r, b.f);
        if (ca && cb) {
          ctx.strokeStyle = '#ffd43b';
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(ca.x, ca.y);
          ctx.lineTo(cb.x, cb.y);
          ctx.stroke();
        }
      }
    }

    // Upcoming condition flags at the roadside.
    const iNow = Math.round(idx);
    const seen = new Set(rowConditions(ev.rows[iNow]));
    const flags = [];
    for (let j = iNow + 1; j <= Math.min(maxIdx(), iNow + Math.round(cam.ahead / 1000)); j++) {
      for (const c of rowConditions(ev.rows[j])) {
        if (seen.has(c) || c === 'night' || c === 'sun-aligned') continue;
        seen.add(c);
        const s2 = model.samples[j];
        const l = local(s2.lat, s2.lon);
        const p = proj(l.r + 22, l.f, 0);
        const pTop = proj(l.r + 22, l.f, 26);
        if (p && pTop) flags.push({ c, p, pTop, j });
      }
    }
    for (const fl of flags) {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(fl.p.x, fl.p.y);
      ctx.lineTo(fl.pTop.x, fl.pTop.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fl.pTop.x, fl.pTop.y, 7 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = COND_COLOR[fl.c];
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    // Assumed-delay traffic: tail lights ahead inside the congested stretch.
    const jamAhead = [];
    for (let fm = 25; fm <= Math.min(cam.ahead, 900); fm += 45) {
      const dd = d0 + fm;
      if (dd > total || !rowAt(dd).congested) continue;
      const pp = pointAtDistance(model.route, dd);
      const l = local(pp.lat, pp.lon);
      const p = proj(l.r - 2.2, l.f, 0.8);
      if (p) jamAhead.push(p);
    }
    for (const p of jamAhead.reverse()) {
      const s = Math.max(2, (F * 2.2) / p.depth);
      ctx.fillStyle = '#343a40';
      ctx.fillRect(p.x - s, p.y - s * 0.7, s * 2, s * 0.9);
      ctx.fillStyle = '#ff2d2d';
      ctx.fillRect(p.x - s, p.y - s * 0.6, s * 0.5, s * 0.3);
      ctx.fillRect(p.x + s * 0.5, p.y - s * 0.6, s * 0.5, s * 0.3);
    }

    // Headlights at night (drawn before the darkness overlay is subtracted).
    if (night > 0) {
      ctx.fillStyle = `rgba(4,8,24,${0.45 * night})`;
      ctx.fillRect(0, 0, W, H);
      const c0 = proj(0, 2);
      const c1 = proj(-14, 120);
      const c2 = proj(14, 120);
      if (c0 && c1 && c2) {
        const g = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, Math.abs(c0.y - c1.y) + 40);
        g.addColorStop(0, `rgba(255,240,190,${0.5 * night})`);
        g.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Vehicle sprite at the simulated position.
    const car = proj(0, 0);
    if (car) {
      const s = Math.max(14 * dpr, Math.min(40 * dpr, (F * 5) / car.depth));
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath();
      ctx.ellipse(0, s * 0.15, s * 0.9, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7a45';
      ctx.beginPath();
      ctx.roundRect(-s * 0.7, -s * 0.55, s * 1.4, s * 0.7, s * 0.18);
      ctx.fill();
      ctx.fillStyle = '#1d2d55';
      ctx.beginPath();
      ctx.roundRect(-s * 0.48, -s * 0.95, s * 0.96, s * 0.45, s * 0.14);
      ctx.fill();
      ctx.fillStyle = night > 0.3 ? '#ff4d4d' : '#c92a2a';
      ctx.fillRect(-s * 0.64, -s * 0.42, s * 0.26, s * 0.14);
      ctx.fillRect(s * 0.38, -s * 0.42, s * 0.26, s * 0.14);
      ctx.restore();
    }

    // Precipitation and wind (screen space; motion honours reduced-motion).
    const windTo = (wx?.windDirection ?? 0) + 180;
    const relWind = signedAngle(windTo, heading);
    const side = Math.sin((relWind * Math.PI) / 180);
    const gust = wx?.windGusts ?? wx?.windSpeed ?? 0;
    const precip = wx?.precipitation ?? 0;
    const snowing = row.hz.snow;
    const moving = motionOk();
    if (precip >= 0.1) {
      const n = Math.min(drops.length, Math.round(25 + precip * (snowing ? 45 : 38)));
      const slant = side * Math.min(1, gust / 60);
      ctx.strokeStyle = snowing ? 'rgba(255,255,255,.9)' : 'rgba(200,225,255,.55)';
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 1.3 * dpr;
      for (let k = 0; k < n; k++) {
        const dp = drops[k];
        const fall = moving ? time * (snowing ? 0.12 : 0.9) * dp.s : 0;
        const y = (((dp.y + fall) % 1) + 1) % 1;
        const x = (((dp.x + (moving ? time * slant * (snowing ? 0.05 : 0.15) : 0) + y * slant * 0.15) % 1) + 1) % 1;
        if (snowing) {
          ctx.beginPath();
          ctx.arc(x * W, y * H, 1.8 * dpr * dp.s, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(x * W, y * H);
          ctx.lineTo(x * W + slant * 10 * dpr, y * H + 16 * dpr * dp.s);
          ctx.stroke();
        }
      }
    }
    if (gust >= 30) {
      const n = Math.min(streaks.length, Math.round((gust - 20) / 3));
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1.6 * dpr;
      const dir = side >= 0 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const st2 = streaks[k];
        const x = (((st2.x + (moving ? time * 0.25 * dir * (0.4 + Math.abs(side)) : 0)) % 1) + 1) % 1;
        const y = 0.12 + st2.y * 0.8;
        ctx.beginPath();
        ctx.moveTo(x * W, y * H);
        ctx.quadraticCurveTo((x + dir * st2.l * 0.5) * W, y * H - 4 * dpr, (x + dir * st2.l) * W, y * H);
        ctx.stroke();
      }
    }
    // Fog.
    const vis = wx?.visibility;
    if (vis != null && vis < 8000) {
      const a = Math.min(0.85, (8000 - vis) / 8000);
      const fog = ctx.createLinearGradient(0, horizonY - H * 0.15, 0, H);
      const fc = night > 0.5 ? '70,76,96' : '222,226,232';
      fog.addColorStop(0, `rgba(${fc},${a})`);
      fog.addColorStop(1, `rgba(${fc},${a * 0.45})`);
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, W, H);
    }
    // Strong glare: wash-out over the windshield direction.
    if (sunScreen && row.expected >= 2) {
      const wash = ctx.createRadialGradient(sunScreen.x, sunScreen.y, 0, sunScreen.x, sunScreen.y, Math.max(W, H) * 0.6);
      wash.addColorStop(0, `rgba(255,248,220,${row.expected >= 3 ? 0.55 : 0.35})`);
      wash.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);
    }

    // Wind / sun gauges (bottom-right).
    const fmt = getFmt();
    const gx = W - 58 * dpr;
    const gy = H - 58 * dpr;
    ctx.fillStyle = 'rgba(15,27,51,.62)';
    ctx.beginPath();
    ctx.arc(gx, gy, 40 * dpr, 0, Math.PI * 2);
    ctx.fill();
    if (wx?.windDirection != null) {
      const ang = (relWind * Math.PI) / 180;
      const len = 26 * dpr;
      const tx = gx + Math.sin(ang) * len;
      const ty = gy - Math.cos(ang) * len;
      ctx.strokeStyle = '#38d9a9';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(gx - Math.sin(ang) * len, gy + Math.cos(ang) * len);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.sin(ang - 0.5) * 9 * dpr, ty + Math.cos(ang - 0.5) * 9 * dpr);
      ctx.lineTo(tx - Math.sin(ang + 0.5) * 9 * dpr, ty + Math.cos(ang + 0.5) * 9 * dpr);
      ctx.closePath();
      ctx.fillStyle = '#38d9a9';
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('▲ ahead', gx, gy - 27 * dpr);
    ctx.fillText(wx ? `wind ${fmt.speed(gust)}` : 'wind —', gx, gy + 34 * dpr);
    if (!sunScreen && alt > -0.833) {
      ctx.textAlign = 'left';
      ctx.font = `${12 * dpr}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillText(`Sun ${Math.abs(rel) > 90 ? 'behind you' : rel > 0 ? 'to your right' : 'to your left'} · ${alt.toFixed(0)}° high`, 12 * dpr, H - 14 * dpr);
    }
  }

  function updateHud() {
    if (!model) return;
    const fmt = getFmt();
    const i = Math.round(displayIdx());
    const row = ev.rows[i];
    const tz = row.timezone || model.originTz;
    const smp = model.samples[i];
    hud.where.textContent = root.clientWidth < 520 ? `${formatClock(row.t, tz, { weekday: false })} · +${formatDuration((row.t - ev.departureUtc) / 1000, { compact: true })} · ${compass(smp.heading)}` : `${formatClock(row.t, tz)} · ${formatDuration((row.t - ev.departureUtc) / 1000)} into the trip · heading ${compass(smp.heading)}`;
    const off = Math.round(displayIdx()) - Math.round(cur);
    if (off === 0) {
      hud.state.textContent = playing ? 'Playing back the planned route' : 'At playback position';
      hud.ret.disabled = true;
    } else {
      const dt = (row.t - ev.rows[Math.round(cur)].t) / 60000;
      const dist = Math.abs(smp.distM - model.samples[Math.round(cur)].distM);
      hud.state.textContent = `Previewing ${off > 0 ? 'ahead' : 'behind'}: ${off > 0 ? '+' : '−'}${formatDuration(Math.abs(dt) * 60)} · ${fmt.dist(dist)}`;
      hud.ret.disabled = false;
    }
    const conds = rowConditions(row);
    const ahead = [];
    const seen = new Set(conds);
    for (let j = i + 1; j < ev.rows.length && ahead.length < 3; j++) {
      for (const c of rowConditions(ev.rows[j])) {
        if (seen.has(c)) continue;
        seen.add(c);
        ahead.push(`${COND_LABEL[c]} in ${fmt.dist(model.samples[j].distM - smp.distM)}`);
      }
    }
    const now = conds.length ? `Here: ${conds.map((c) => COND_LABEL[c]).join(', ')}` : 'Here: no flagged conditions';
    hud.ahead.textContent = `${now}${ahead.length ? ` · Next: ${ahead.join(' · ')}` : ''}`;
    hud.level.textContent = LEVELS[level].name;
  }

  function updateButtons() {
    hud.play.textContent = playing ? 'Pause' : cur >= maxIdx() ? 'Replay' : 'Play';
    hud.play.setAttribute('aria-pressed', String(playing));
  }

  function setPreview(p) {
    preview = Math.max(-cur, Math.min(maxIdx() - cur, p));
    onPreview(Math.round(displayIdx()));
    updateHud();
    kick();
  }

  // Input: wheel (desktop), horizontal swipe (touch), keys and buttons.
  canvas.addEventListener('wheel', (e) => {
    if (!model) return;
    e.preventDefault();
    const step = [0.6, 1, 2, 4][level];
    setPreview(preview + Math.sign(e.deltaY || e.deltaX) * step * Math.max(1, Math.min(4, Math.abs(e.deltaY || e.deltaX) / 60)));
  }, { passive: false });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, p: preview, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const along = Math.abs(dx) > Math.abs(dy) ? -dx : -dy; // swipe left / drag up = look ahead
    setPreview(drag.p + (along / 12) * [0.6, 1, 2, 4][level]);
  });
  const endDrag = () => {
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('keydown', (e) => {
    const step = [0.6, 1, 2, 4][level] * 3;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setPreview(preview + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setPreview(preview - step);
    else if (e.key === 'Home' || e.key === 'Escape') api.returnToCurrent();
    else if (e.key === '+' || e.key === '=') api.setLevel(level - 1);
    else if (e.key === '-') api.setLevel(level + 1);
    else return;
    e.preventDefault();
  });
  root.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'play') api.togglePlay();
      else if (act === 'return') api.returnToCurrent();
      else if (act === 'nearer') api.setLevel(level - 1);
      else if (act === 'farther') api.setLevel(level + 1);
      else if (act === 'back') setPreview(preview - [0.6, 1, 2, 4][level] * 5);
      else if (act === 'fwd') setPreview(preview + [0.6, 1, 2, 4][level] * 5);
    })
  );
  new ResizeObserver(() => kick()).observe(root);

  const api = {
    setTrip(m, e) {
      model = m;
      ev = e;
      cur = Math.min(cur, maxIdx());
      preview = 0;
      updateButtons();
      kick();
    },
    setCurrent(i) {
      if (playing) return;
      cur = Math.max(0, Math.min(maxIdx(), i));
      preview = 0;
      if (visible) updateHud();
      kick();
    },
    show(on) {
      visible = on;
      if (!on) {
        playing = false;
        updateButtons();
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        if (motionOk()) cam = { ...LEVELS[Math.min(3, level + 1)] };
        lastT = 0;
        updateHud();
        kick();
      }
    },
    togglePlay() {
      if (!model) return;
      if (!playing && cur >= maxIdx()) cur = 0;
      if (!playing) preview = 0;
      playing = !playing;
      updateButtons();
      if (!playing) onAdvance(Math.round(cur));
      kick();
    },
    returnToCurrent() {
      preview = 0;
      onPreview(null);
      updateHud();
      kick();
    },
    setLevel(l) {
      level = Math.max(0, Math.min(LEVELS.length - 1, l));
      if (!motionOk()) cam = { ...LEVELS[level] };
      updateHud();
      kick();
    },
    get state() {
      return { cur: Math.round(cur), preview: Math.round(displayIdx()) - Math.round(cur), level, playing, visible };
    },
    redraw: kick,
  };
  return api;
}
