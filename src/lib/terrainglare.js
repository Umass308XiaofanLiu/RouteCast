// terrainglare.js — per-sample "terrain-adjusted expected glare", computed SEPARATELY from the
// geometric glare (r.glare) and the cloud-adjusted expected glare (r.expected). Pure; it never
// mutates ev. Input: checkGlareWindows() results (per-window, with checked samples + verdicts).
//
// Rules per glare row i (geometric severity ≥ 1) inside a checked window [a, b]:
//  - checked sample 'blocked' → terrain-adjusted 0, label 'terrain likely hides the sun'
//  - checked sample 'visible' → unchanged (= r.expected)
//  - checked sample 'unknown' → unchanged, label 'not checked'
//  - unchecked row: takes its nearest checked neighbours' verdict ONLY when a checked neighbour exists on
//    BOTH sides within the same window and both verdicts agree (blocked/visible); otherwise 'unknown'
//    (unchanged). Rows outside checked windows are not in the result at all (= not checked).

export const TERRAIN_LABEL = Object.freeze({
  blocked: 'terrain likely hides the sun',
  visible: 'terrain: sun in view',
  unknown: 'not checked',
});

const rowExpected = (r) => r?.expected ?? r?.glare?.severity ?? 0;

/**
 * @param ev      evaluateTrip result (read only)
 * @param results checkGlareWindows() results
 * @returns {{ ev, bySample: Map<number,{verdict,source,expected,label}>, windows: Map<number,object> }}
 *   windows keyed by window start a: { a, b, strongMin, terrainStrongMin, hiddenMin, unknownMin, checked, decided }
 */
export function terrainAdjustedGlare(ev, results = []) {
  const bySample = new Map();
  const windows = new Map();
  for (const w of results) {
    const checked = new Map((w.samples || []).map((s) => [s.i, s.verdict]));
    const idx = [...checked.keys()].sort((x, y) => x - y);
    for (let i = w.a; i <= w.b; i++) {
      const r = ev.rows[i];
      if (!r || (r.glare?.severity ?? 0) < 1) continue;
      let verdict;
      let source;
      if (checked.has(i)) {
        verdict = checked.get(i);
        source = 'checked';
      } else {
        let lo = null;
        let hi = null;
        for (const k of idx) {
          if (k < i) lo = k;
          else if (k > i) {
            hi = k;
            break;
          }
        }
        const vl = lo == null ? null : checked.get(lo);
        const vh = hi == null ? null : checked.get(hi);
        if (vl && vl === vh && vl !== 'unknown') {
          verdict = vl;
          source = 'interpolated';
        } else {
          verdict = 'unknown';
          source = 'none';
        }
      }
      if (verdict !== 'blocked' && verdict !== 'visible') verdict = 'unknown';
      const expected = verdict === 'blocked' ? 0 : rowExpected(r);
      bySample.set(i, { verdict, source, expected, label: TERRAIN_LABEL[verdict] });
    }
    // Minutes, counted like describeGlareWindow's strongMin (row i covers [t_i, t_{i+1}), i < b).
    let strongMin = 0;
    let terrainStrongMin = 0;
    let hiddenMin = 0;
    let unknownMin = 0;
    for (let i = w.a; i < w.b; i++) {
      const r = ev.rows[i];
      const dt = (ev.rows[i + 1].t - r.t) / 60000;
      const s = bySample.get(i);
      if (rowExpected(r) >= 2) {
        strongMin += dt;
        if (s?.verdict === 'blocked') hiddenMin += dt;
        if (!s || s.verdict === 'unknown') unknownMin += dt;
      }
      if ((s ? s.expected : rowExpected(r)) >= 2) terrainStrongMin += dt;
    }
    const decided = (w.samples || []).filter((x) => x.verdict === 'blocked' || x.verdict === 'visible').length;
    windows.set(w.a, { a: w.a, b: w.b, strongMin, terrainStrongMin, hiddenMin, unknownMin, checked: w.checked || 0, decided });
  }
  return { ev, bySample, windows };
}

const m = (x) => Math.round(x);

/** Card line, or '' when there is nothing honest to say (no strong glare / nothing checked). */
export function terrainAdjustedLine(win) {
  if (!win || !win.decided || win.strongMin < 0.5) return ''; // nothing conclusive: no adjusted number
  const txt = `Terrain-adjusted strong glare: ${m(win.terrainStrongMin)} of ${m(win.strongMin)} min`;
  return win.unknownMin >= 0.5 ? `${txt} (${m(win.unknownMin)} min not checked, left unchanged)` : txt;
}

/** KPI subtext suffix after a check: '(terrain check: …)'. */
export function terrainKpiNote(adj, { failed = false } = {}) {
  if (failed || !adj) return '(terrain check: unavailable)';
  let strong = 0;
  let hidden = 0;
  let unknown = 0;
  for (const w of adj.windows.values()) {
    strong += w.strongMin;
    hidden += w.hiddenMin;
    unknown += w.unknownMin;
  }
  if (strong < 0.5) return '(terrain check: no strong glare to adjust)';
  if (hidden >= 0.5) return `(terrain check: hills may hide ~${m(hidden)} of ${m(strong)} strong min)`;
  if (unknown >= strong - 0.5) return '(terrain check: inconclusive)';
  return '(terrain check: no hills in the way at checked points)';
}
