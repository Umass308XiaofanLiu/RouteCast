// demsampler.js — bare-earth elevation lookups from AWS Terrain Tiles (terrarium PNG).
// Network + decode are behind an injectable fetchTile so the logic stays testable in Node.
// sampleElevation(lat, lon) never throws: failed/missing tiles yield null.
import { decodeTerrarium, pixelLookup, TILE_SIZE } from './horizon.js';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function tileUrl(z, x, y) {
  return TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/** Browser default: fetch → blob → createImageBitmap → (Offscreen)Canvas → RGBA pixels. */
export async function browserFetchTile(z, x, y, { signal } = {}) {
  const res = await fetch(tileUrl(z, x, y), { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`tile HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const w = bmp.width;
  const h = bmp.height;
  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  else {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/**
 * @param {{zoom?:number, fetchTile?:(z,x,y)=>Promise<{width,height,data}|Uint8ClampedArray|null>, maxTiles?:number}} o
 * @returns {((lat:number, lon:number) => Promise<number|null>) & {stats:object, clear:()=>void}}
 */
export function createDemSampler({ zoom = 12, fetchTile = browserFetchTile, maxTiles = 64 } = {}) {
  const cache = new Map(); // key -> Promise<tile|null>  (in-flight de-dup + LRU by insertion order)
  const stats = { requested: 0, failed: 0 };

  function getTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) {
      const p = cache.get(key);
      cache.delete(key);
      cache.set(key, p); // refresh LRU position
      return p;
    }
    stats.requested++;
    const p = (async () => {
      try {
        const t = await fetchTile(z, x, y);
        if (!t) throw new Error('no tile');
        const tile = t instanceof Uint8ClampedArray || t instanceof Uint8Array ? { width: TILE_SIZE, height: TILE_SIZE, data: t } : t;
        if (!tile.data || tile.data.length < tile.width * tile.height * 4) throw new Error('bad tile');
        return tile;
      } catch {
        stats.failed++;
        return null;
      }
    })();
    cache.set(key, p);
    while (cache.size > maxTiles) cache.delete(cache.keys().next().value);
    return p;
  }

  const sampleElevation = async (lat, lon) => {
    try {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const { x, y, z } = pixelLookup(lat, lon, zoom);
      const tile = await getTile(z, x, y);
      if (!tile) return null;
      const { px, py } = pixelLookup(lat, lon, zoom, tile.width);
      const o = (py * tile.width + px) * 4;
      if (tile.data[o + 3] === 0) return null; // transparent = no data
      const h = decodeTerrarium(tile.data[o], tile.data[o + 1], tile.data[o + 2]);
      return Number.isFinite(h) ? h : null;
    } catch {
      return null;
    }
  };
  sampleElevation.stats = stats;
  sampleElevation.clear = () => cache.clear();
  return sampleElevation;
}
