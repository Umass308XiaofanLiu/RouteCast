#!/usr/bin/env node
// PROBE ONLY — not part of the app. Computes the terrain horizon along one azimuth from real
// AWS Terrain Tiles (terrarium PNG, z12) and prints the elevation profile around the max-angle point.
//
// Usage:
//   node scripts/horizon-probe.mjs [lat] [lon] [azimuthDeg] [maxDistM]          (network, ≤ 12 tiles)
//   node scripts/horizon-probe.mjs --fixtures [lat] [lon] [az] [maxDistM]       (offline, tests/fixtures/dem only)
//   node scripts/horizon-probe.mjs --record   [lat] [lon] [az] [maxDistM]       (network, saves used tiles to fixtures)
//
// Also exports a minimal PNG decoder + a fixture-backed fetchTile for Node unit tests.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrainHorizon, sampleDistances, destinationPoint, curvatureDropM } from '../src/lib/horizon.js';
import { createDemSampler, tileUrl } from '../src/lib/demsampler.js';

export const FIXTURE_DIR = fileURLToPath(new URL('../tests/fixtures/dem/', import.meta.url));

/** Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced. Returns RGBA {width,height,data}. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w, h, ctype;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      const depth = data[8]; ctype = data[9];
      if (depth !== 8 || (ctype !== 2 && ctype !== 6) || data[12] !== 0) throw new Error('unsupported PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0;
      const c = x >= bpp && y ? out[dst - stride + x - bpp] : 0, v = raw[src + x];
      let p;
      if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = (v + p) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    rgba[i * 4] = out[j]; rgba[i * 4 + 1] = out[j + 1]; rgba[i * 4 + 2] = out[j + 2];
    rgba[i * 4 + 3] = bpp === 4 ? out[j + 3] : 255;
  }
  return { width: w, height: h, data: rgba };
}

export const fixtureName = (z, x, y) => `${z}_${x}_${y}.png`;

/** fetchTile for createDemSampler that reads ONLY recorded fixtures; missing file → null. */
export function fixtureFetchTile(dir = FIXTURE_DIR, used) {
  return async (z, x, y) => {
    const f = path.join(dir, fixtureName(z, x, y));
    if (!fs.existsSync(f)) return null;
    used?.add(fixtureName(z, x, y));
    return decodePng(fs.readFileSync(f));
  };
}

/** fetchTile over the network (Node), optionally saving the raw PNG into dir. Bounded by maxTiles. */
export function networkFetchTile({ saveDir, maxTiles = 12, used } = {}) {
  let n = 0;
  return async (z, x, y, { signal } = {}) => {
    if (++n > maxTiles) return null; // bounded probe
    const r = await fetch(tileUrl(z, x, y), { signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (saveDir) fs.writeFileSync(path.join(saveDir, fixtureName(z, x, y)), buf);
    used?.add(fixtureName(z, x, y));
    return decodePng(buf);
  };
}

/** Horizon + the profile sample where the apparent angle peaks. */
export async function probe({ lat, lon, azimuthDeg, maxDistM, minDistM = 100, sampleElevation }) {
  const h = await terrainHorizon({ lat, lon, azimuthDeg, sampleElevation, maxDistM, minDistM });
  const obs = await sampleElevation(lat, lon);
  const profile = [];
  for (const d of sampleDistances(maxDistM).filter((x) => x >= minDistM)) {
    const p = destinationPoint(lat, lon, azimuthDeg, d);
    const e = await sampleElevation(p.lat, p.lon);
    profile.push({ d: Math.round(d), lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), elevM: e == null ? null : +e.toFixed(1),
      angDeg: e == null ? null : +((Math.atan((e - obs - 1.5 - curvatureDropM(d)) / d) * 180) / Math.PI).toFixed(3) });
  }
  const peak = profile.reduce((m, s) => (s.angDeg != null && (m == null || s.angDeg > m.angDeg) ? s : m), null);
  const maxElev = profile.reduce((m, s) => (s.elevM != null && (m == null || s.elevM > m.elevM) ? s : m), null);
  return { observerElevM: obs, ...h, peak, maxElev, profile };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const mode = args[0]?.startsWith('--') ? args.shift() : '--network';
  const [lat = 42.3732, lon = -72.5199, az = 290, maxDistM = 30000] = args.map(Number);
  const used = new Set();
  const fetchTile = mode === '--fixtures' ? fixtureFetchTile(FIXTURE_DIR, used)
    : networkFetchTile({ saveDir: mode === '--record' ? (fs.mkdirSync(FIXTURE_DIR, { recursive: true }), FIXTURE_DIR) : null, used });
  const sampleElevation = createDemSampler({ zoom: 12, fetchTile });
  const r = await probe({ lat, lon, azimuthDeg: az, maxDistM, sampleElevation });
  const { profile, ...rest } = r;
  console.log('PROBE (not app output):', JSON.stringify({ mode, lat, lon, azimuthDeg: az, maxDistM, tiles: [...used], ...rest }));
  if (process.env.PROFILE) for (const s of profile) console.log(JSON.stringify(s));
}
