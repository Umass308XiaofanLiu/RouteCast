#!/usr/bin/env node
// PROBE ONLY — not part of the app. Fetches a handful of real AWS Terrain Tiles
// (terrarium PNG, z12) for one point and prints the terrain horizon along one azimuth.
// Usage: node scripts/horizon-probe.mjs [lat] [lon] [azimuthDeg]
import zlib from 'node:zlib';
import { terrainHorizon, pixelLookup, decodeTerrarium } from '../src/lib/horizon.js';

const [lat = 42.3732, lon = -72.5199, az = 290] = process.argv.slice(2).map(Number); // Amherst MA, ~summer-sunset azimuth
const Z = 12;
const MAX_TILES = 12;
const cache = new Map();

// Minimal PNG decoder: 8-bit RGB/RGBA, non-interlaced.
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w, h, ctype, idat = [];
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
  return { w, h, bpp, px: out };
}

async function tile(x, y) {
  const key = `${x}/${y}`;
  if (!cache.has(key)) {
    if (cache.size >= MAX_TILES) return null; // bounded probe
    cache.set(key, (async () => {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`);
      return r.ok ? decodePng(Buffer.from(await r.arrayBuffer())) : null;
    })().catch(() => null));
  }
  return cache.get(key);
}

async function sampleElevation(la, lo) {
  const p = pixelLookup(la, lo, Z);
  const t = await tile(p.x, p.y);
  if (!t) return null;
  const i = (p.py * t.w + p.px) * t.bpp;
  return decodeTerrarium(t.px[i], t.px[i + 1], t.px[i + 2]);
}

const h = await terrainHorizon({ lat, lon, azimuthDeg: az, sampleElevation, maxDistM: 30000 });
console.log('PROBE (not app output):', { lat, lon, azimuthDeg: az, zoom: Z, tilesFetched: cache.size,
  observerElevM: await sampleElevation(lat, lon), ...h });
