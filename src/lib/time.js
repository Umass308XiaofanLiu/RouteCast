// time.js — timezone-correct conversions using only the built-in Intl API.
// Internal convention: every instant is a UTC epoch in milliseconds.

const dtfCache = new Map();
function partsFormatter(timeZone) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of a UTC instant in an IANA zone. */
export function zonedParts(utcMs, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out; // {year, month, day, hour, minute, second}
}

/** Offset of the zone from UTC at the given instant, in minutes (EDT = -240). */
export function tzOffsetMinutes(utcMs, timeZone) {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/**
 * Convert a wall-clock time in an IANA zone to a UTC epoch (ms).
 * Nonexistent times (spring-forward gap) resolve forward; ambiguous times
 * (fall-back overlap) resolve to the earlier instant.
 */
export function zonedWallTimeToUtc({ year, month, day, hour, minute = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two candidate offsets: the offset just before and just after the naive instant.
  const candidates = new Set([
    tzOffsetMinutes(naive - 864e5 / 2, timeZone),
    tzOffsetMinutes(naive + 864e5 / 2, timeZone),
    tzOffsetMinutes(naive, timeZone),
  ]);
  const matches = [];
  for (const off of candidates) {
    const utc = naive - off * 60000;
    const p = zonedParts(utc, timeZone);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      matches.push(utc);
    }
  }
  if (matches.length) return Math.min(...matches);
  // Spring-forward gap: apply the pre-transition offset, which moves the wall clock
  // forward by the gap (02:30 EST-nonexistent -> 03:30 EDT).
  const off = tzOffsetMinutes(naive - 864e5 / 2, timeZone);
  return naive - off * 60000;
}

/** Parse "YYYY-MM-DDTHH:MM" (datetime-local value) as wall time in a zone. */
export function parseLocalInput(value, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  return zonedWallTimeToUtc(
    { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] },
    timeZone
  );
}

/** Format a UTC instant as a datetime-local input value in a zone. */
export function toLocalInput(utcMs, timeZone) {
  const p = zonedParts(utcMs, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Short zone abbreviation such as "EDT" or "CDT" (falls back to GMT-5 style). */
export function tzAbbrev(utcMs, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === 'timeZoneName');
  return part ? part.value : timeZone;
}

/** "Sun 5:42 PM EST" style label in the given zone. */
export function formatClock(utcMs, timeZone, { weekday = true, zone = true } = {}) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: weekday ? 'short' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(utcMs));
  return zone ? `${s} ${tzAbbrev(utcMs, timeZone)}` : s;
}

export function formatDuration(seconds, { compact = false } = {}) {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (compact) return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
