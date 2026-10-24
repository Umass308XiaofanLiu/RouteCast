// Record live route + forecast snapshots for the offline demo and E2E tests.
// Usage: node scripts/record-snapshots.mjs [YYYY-MM-DD]
// Snapshots are labeled "Recorded snapshot" with capture time in the UI.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildTripModel, toSnapshot } from '../src/lib/planner.js';
import { evaluateTrip } from '../src/lib/trip.js';
import { zonedWallTimeToUtc, formatClock, formatDuration } from '../src/lib/time.js';
import { PRESETS, PLACES } from '../src/lib/presets.js';

const places = JSON.parse(readFileSync(new URL('../src/data/us_places.json', import.meta.url)));
const date = process.argv[2] || new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const [y, m, d] = date.split('-').map(Number);
mkdirSync(new URL('../public/fixtures/', import.meta.url), { recursive: true });

for (const p of PRESETS) {
  const origin = PLACES[p.origin];
  const dest = PLACES[p.dest];
  const dep = zonedWallTimeToUtc({ year: y, month: m, day: d, hour: p.hour, minute: p.minute }, origin.timezone);
  const model = await buildTripModel({ origin, dest, departureUtc: dep, places });
  const ev = evaluateTrip(model, dep);
  const snap = toSnapshot(model, dep, { preset: p.id });
  const file = new URL(`../public/fixtures/${p.snapshot}`, import.meta.url);
  writeFileSync(file, JSON.stringify(snap));
  console.log(
    `${p.id}: ${model.route.engine} ${(model.route.totalDistM / 1609.344).toFixed(0)} mi, drive ${formatDuration(model.route.totalSec)}, ` +
      `depart ${formatClock(dep, origin.timezone)} arrive ${formatClock(ev.arrivalUtc, dest.timezone)}, ` +
      `glare min [${ev.totals.glareMin.map((x) => x.toFixed(0))}] expected [${ev.totals.expectedGlareMin.map((x) => x.toFixed(0))}], ` +
      `night ${ev.totals.nightMin.toFixed(0)} wet ${ev.totals.wetMin.toFixed(0)} missing ${ev.totals.missingMin.toFixed(0)}, points ${model.pointIdx.length}, samples ${model.samples.length}`
  );
}
