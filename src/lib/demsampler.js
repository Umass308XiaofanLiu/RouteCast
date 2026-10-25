// demsampler.js — bare-earth elevation lookups from AWS Terrain Tiles (terrarium PNG).
// Network + decode are behind an injectable fetchTile so the logic stays testable in Node.
// sampleElevation(lat, lon, { signal }) NEVER throws: failed/missing/aborted tiles yield null.
//
// Robustness (see docs/OCCLUSION.md):
//  - memory: LRU of ≤ maxTiles decoded tiles; a z12 256 px RGBA tile is 256 KiB → default 64 tiles ≈ 16 MiB
//    (plus ≤ maxConcurrent in-flight decodes).
//  - ≤ maxConcurrent (default 6, hard cap 6) tile fetches at once; extra requests queue.
//  - per-attempt timeout (timeoutMs, default 10 s); one retry on a network error/timeout,
//    no retry on HTTP 4xx/5xx or an empty tile (cached as missing → no retry storm).
//  - AbortSignal: an aborted caller gets null at once; if every waiter of a tile aborted, its fetch is
//    aborted too and the tile is NOT cached as missing (a later call refetches).
import { decodeTerrarium, pixelLookup, TILE_SIZE } from './horizon.js';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const MAX_CONCURRENT_HARD_CAP = 6;
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

export function tileUrl(z, x, y) {
  return TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/** Browser default: fetch → blob → createImageBitmap → (Offscreen)Canvas → RGBA pixels. */
export async function browserFetchTile(z, x, y, { signal } = {}) {
  const res = await fetch(tileUrl(z, x, y), { signal, mode: 'cors' });
  if (!res.ok) {
    const e = new Error(`tile HTTP ${res.status}`);
    e.noRetry = true;
    throw e;
  }
  // premultiplyAlpha/colorSpaceConversion 'none': elevation is encoded in RGB, must not be color-managed.
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
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

const ABORTED = Symbol('aborted');

/**
 * @param {{zoom?:number, fetchTile?:(z,x,y,{signal})=>Promise<{width,height,data}|Uint8ClampedArray|null>,
 *          maxTiles?:number, maxConcurrent?:number, timeoutMs?:number, retries?:number}} o
 * @returns {((lat:number, lon:number, opts?:{signal?:AbortSignal}) => Promise<number|null>) & {stats:object, clear:()=>void}}
 */
export function createDemSampler({
  zoom = 12,
  fetchTile = browserFetchTile,
  maxTiles = 64,
  maxConcurrent = MAX_CONCURRENT_HARD_CAP,
  timeoutMs = 10000,
  retries = 1,
} = {}) {
  const limit = Math.max(1, Math.min(MAX_CONCURRENT_HARD_CAP, maxConcurrent | 0 || MAX_CONCURRENT_HARD_CAP));
  const cache = new Map(); // key -> entry {promise, ctrl, waiters, done}  (LRU by insertion order)
  const stats = { requested: 0, failed: 0, retried: 0, aborted: 0, inFlight: 0, maxInFlight: 0 };
  let active = 0;
  const queue = [];

  const acquire = () =>
    new Promise((resolve) => {
      if (active < limit) {
        active++;
        resolve();
      } else queue.push(resolve);
    });
  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };

  async function attempt(z, x, y, outer) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    outer.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await Promise.race([
        fetchTile(z, x, y, { signal: ctrl.signal }),
        new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('timeout/abort')), { once: true })),
      ]);
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', onAbort);
    }
  }

  async function load(z, x, y, entry) {
    await acquire();
    if (entry.ctrl.signal.aborted) {
      release();
      return ABORTED;
    }
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      for (let i = 0; ; i++) {
        try {
          const t = await attempt(z, x, y, entry.ctrl.signal);
          if (!t) return null;
          const tile = t instanceof Uint8ClampedArray || t instanceof Uint8Array ? { width: TILE_SIZE, height: TILE_SIZE, data: t } : t;
          if (!tile.data || tile.data.length < tile.width * tile.height * 4) return null;
          return tile;
        } catch (e) {
          if (entry.ctrl.signal.aborted) return ABORTED;
          if (e?.noRetry || i >= retries) return null;
          stats.retried++;
        }
      }
    } catch {
      return null;
    } finally {
      stats.inFlight--;
      release();
    }
  }

  function getEntry(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry); // refresh LRU position
      return entry;
    }
    stats.requested++;
    entry = { ctrl: new AbortController(), waiters: 0, done: false };
    entry.promise = load(z, x, y, entry).then((t) => {
      entry.done = true;
      if (t === ABORTED) {
        stats.aborted++;
        if (cache.get(key) === entry) cache.delete(key); // do not remember an aborted tile as missing
        return null;
      }
      if (!t) stats.failed++;
      return t;
    });
    cache.set(key, entry);
    while (cache.size > maxTiles) cache.delete(cache.keys().next().value);
    return entry;
  }

  function waitTile(entry, signal) {
    if (!signal) return entry.promise;
    if (signal.aborted) return Promise.resolve(null);
    entry.waiters++;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        entry.waiters--;
        resolve(v);
      };
      const onAbort = () => {
        finish(null);
        if (entry.waiters === 0 && !entry.done) entry.ctrl.abort(); // nobody else needs it
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(finish, () => finish(null));
    });
  }

  const sampleElevation = async (lat, lon, { signal } = {}) => {
    try {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || signal?.aborted) return null;
      const { x, y, z } = pixelLookup(lat, lon, zoom);
      const entry = getEntry(z, x, y);
      if (!signal) entry.waiters++; // an unsignalled waiter keeps the fetch alive
      let tile;
      try {
        tile = await waitTile(entry, signal);
      } finally {
        if (!signal) entry.waiters--;
      }
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
  sampleElevation.cacheSize = () => cache.size;
  return sampleElevation;
}
