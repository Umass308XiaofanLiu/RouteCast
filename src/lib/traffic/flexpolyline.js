// flexpolyline.js — decoder for HERE Flexible Polyline (used by HERE Routing v8 `polyline`).
// Spec + official example: https://github.com/heremaps/flexible-polyline (README "Example":
// "BFoz5xJ67i1B1B7PzIhaxL7Y" -> (50.10228, 8.69821), (50.10201, 8.69567), (50.10063, 8.69150), (50.09878, 8.68752)).
// Header: varint version (must be 1), then varint content: bits 0-3 precision, 4-6 third-dimension type,
// 7-10 third-dimension precision. Data: zig-zag signed varints, first tuple absolute, then deltas.
const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DECODE = new Map([...TABLE].map((c, i) => [c, i]));

function* varints(str) {
  let result = 0;
  let shift = 0;
  for (const ch of str) {
    const v = DECODE.get(ch);
    if (v === undefined) throw new Error(`Invalid flexible polyline character "${ch}"`);
    // Use multiplication (not <<) so values above 2^31 (3rd dimension / high precision) stay exact.
    result += (v & 0x1f) * 2 ** shift;
    if (v & 0x20) {
      shift += 5;
    } else {
      yield result;
      result = 0;
      shift = 0;
    }
  }
  if (shift !== 0) throw new Error('Truncated flexible polyline');
}

const unzig = (u) => (u % 2 === 1 ? -(u + 1) / 2 : u / 2);

/** Decode to { precision, thirdDim, thirdDimPrecision, polyline: [[lat, lng(, z)], ...] }. */
export function decodeFlexible(encoded) {
  const it = varints(String(encoded));
  const version = it.next().value;
  if (version !== 1) throw new Error(`Unsupported flexible polyline version ${version}`);
  const header = it.next().value;
  const precision = header & 15;
  const thirdDim = (header >> 4) & 7;
  const thirdDimPrecision = (header >> 7) & 15;
  const f = 10 ** precision;
  const fz = 10 ** thirdDimPrecision;
  const dims = thirdDim ? 3 : 2;
  const out = [];
  const acc = [0, 0, 0];
  const buf = [];
  for (const u of it) {
    buf.push(unzig(u));
    if (buf.length === dims) {
      for (let d = 0; d < dims; d++) acc[d] += buf[d];
      const p = [acc[0] / f, acc[1] / f];
      if (dims === 3) p.push(acc[2] / fz);
      out.push(p);
      buf.length = 0;
    }
  }
  if (buf.length) throw new Error('Flexible polyline has an incomplete coordinate tuple');
  return { precision, thirdDim, thirdDimPrecision, polyline: out };
}
