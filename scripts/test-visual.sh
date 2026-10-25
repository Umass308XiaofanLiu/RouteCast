#!/usr/bin/env bash
# Visual suite: real (headed) Chrome + SwiftShader WebGL under Xvfb against a local preview build.
# Builds, serves dist/ on 127.0.0.1:${PORT:-4197}, runs tests/e2e/terrain-visual.mjs, writes PNGs +
# summary.json to ${OUT:-/tmp/glarepilot-visual}, always stops the server, and exits non-zero on
# page errors, failed view checks, HUD overlaps or HUD boxes outside the view.
# Only ?demo= scenarios are loaded; map/terrain/building tiles are fetched live from public hosts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4197}"
OUT="${OUT:-/tmp/glarepilot-visual}"
XVFB="${XVFB_RUN:-/usr/bin/xvfb-run}"
cd "$ROOT"

command -v "$XVFB" >/dev/null || { echo "test-visual: xvfb-run not found ($XVFB)" >&2; exit 2; }
mkdir -p "$OUT"

VITE="$ROOT/node_modules/vite/bin/vite.js"
node "$VITE" build --logLevel error

node "$VITE" preview --host 127.0.0.1 --port "$PORT" --strictPort >"$OUT/preview.log" 2>&1 &
SERVER_PID=$!
cleanup() {
  # Stop only the preview process we started (by PID, never by name pattern).
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "test-visual: preview server exited" >&2; cat "$OUT/preview.log" >&2; exit 2; }
  sleep 0.5
done

status=0
BASE_URL="http://127.0.0.1:$PORT/" "$XVFB" -a -s "-screen 0 1600x1000x24" \
  node tests/e2e/terrain-visual.mjs "$OUT" >"$OUT/summary.raw" 2>"$OUT/stderr.log" || status=$?

# The script prints the JSON summary last; extract it and add the overlap/outside gate.
node - "$OUT" "$status" <<'EOF' || status=1
const fs = require('node:fs');
const [out, st] = process.argv.slice(2);
const raw = fs.readFileSync(`${out}/summary.raw`, 'utf8');
const start = raw.lastIndexOf('\n[') >= 0 ? raw.lastIndexOf('\n[') + 1 : raw.indexOf('[');
let summary;
try {
  summary = JSON.parse(raw.slice(start));
} catch {
  console.error(`test-visual: no JSON summary (script exit ${st}); see ${out}/stderr.log`);
  process.exit(1);
}
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
let bad = 0;
for (const s of summary) {
  const problems = [];
  if (s.errors?.length) problems.push(`page errors: ${s.errors.join(' | ')}`);
  if (s.overlaps?.length) problems.push(`HUD overlaps: ${s.overlaps.join('; ')}`);
  if (s.outside?.length) problems.push(`HUD outside view: ${s.outside.join(', ')}`);
  if (s.checks) for (const [k, v] of Object.entries(s.checks)) if (v === false) problems.push(`check failed: ${k}`);
  if ('webglCanvas' in s && !s.webglCanvas) problems.push('no WebGL canvas');
  if (problems.length) bad++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.shot}${problems.length ? ' — ' + problems.join(' / ') : ''}`);
}
console.log(`test-visual: ${summary.length - bad}/${summary.length} shots clean; PNGs + summary.json in ${out}`);
process.exit(bad || Number(st) ? 1 : 0);
EOF

exit "$status"
