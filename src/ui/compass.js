// compass.js — heading-up view: where the sun is relative to the windshield.
import { signedAngle, compass } from '../lib/geo.js';
import { GLARE_HALF_ANGLE, GLARE_MAX_ALT } from '../lib/sun.js';
import { C, GLARE_LABEL } from './palette.js';

const R = 70;
const CX = 85;
const CY = 85;

function polar(relDeg, r) {
  const a = ((relDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

export function compassSvg(row, sample) {
  const rel = signedAngle(row.sun.azimuth, sample.heading); // + = to the right
  const alt = row.sun.altitude;
  const visible = alt > -0.833;
  const r = visible ? R * (1 - Math.max(0, alt) / 90) : R + 8;
  const [sx, sy] = polar(rel, Math.min(r, R + 8));
  const [c1x, c1y] = polar(-GLARE_HALF_ANGLE, R);
  const [c2x, c2y] = polar(GLARE_HALF_ANGLE, R);
  const rGlare = R * (1 - GLARE_MAX_ALT / 90);
  const [i1x, i1y] = polar(-GLARE_HALF_ANGLE, rGlare);
  const [i2x, i2y] = polar(GLARE_HALF_ANGLE, rGlare);
  const north = signedAngle(0, sample.heading);
  const [nx, ny] = polar(north, R + 10);
  const sev = row.glare.severity;
  const sunColor = !visible ? '#adb5bd' : sev ? C.g[sev] : '#fab005';
  return `<svg viewBox="0 0 170 170" role="img" aria-label="Sun position relative to your heading">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="#f8f9fb" stroke="#dee2e6"/>
    <circle cx="${CX}" cy="${CY}" r="${R * (2 / 3)}" fill="none" stroke="#edf0f4"/>
    <circle cx="${CX}" cy="${CY}" r="${R / 3}" fill="none" stroke="#edf0f4"/>
    <path d="M${c1x},${c1y} A${R},${R} 0 0 1 ${c2x},${c2y} L${i2x},${i2y} A${rGlare},${rGlare} 0 0 0 ${i1x},${i1y} Z" fill="${C.g[2]}" opacity=".18"/>
    <text x="${CX}" y="11" text-anchor="middle" font-size="10" fill="#637087" font-weight="700">AHEAD</text>
    <text x="${CX}" y="167" text-anchor="middle" font-size="10" fill="#637087">behind</text>
    <text x="${nx}" y="${ny + 3}" text-anchor="middle" font-size="9" fill="#1c7ed6" font-weight="700">N</text>
    <path d="M${CX},${CY - 14} l9,22 -9,-5 -9,5z" fill="${C.ink}"/>
    ${visible ? `<line x1="${CX}" y1="${CY}" x2="${sx}" y2="${sy}" stroke="${sunColor}" stroke-dasharray="3 3"/>` : ''}
    <circle cx="${sx}" cy="${sy}" r="${visible ? 9 : 7}" fill="${sunColor}" stroke="#fff" stroke-width="2" opacity="${visible ? 1 : 0.7}"/>
  </svg>`;
}

export function compassText(row, sample) {
  const rel = signedAngle(row.sun.azimuth, sample.heading);
  const alt = row.sun.altitude;
  const side = Math.abs(rel) < 3 ? 'straight ahead' : `${Math.abs(rel).toFixed(0)}° to your ${rel > 0 ? 'right' : 'left'}`;
  let verdict;
  if (alt <= -0.833) verdict = alt > -6 ? 'Sun just below the horizon (twilight)' : 'Sun below the horizon — dark';
  else if (row.glare.severity) verdict = `${GLARE_LABEL[row.glare.severity]}${row.expected < row.glare.severity ? ` (clouds likely soften it: ${row.mutedReason})` : ''}`;
  else if (row.glare.rear) verdict = 'Low sun behind you — signals ahead can wash out';
  else verdict = alt > GLARE_MAX_ALT ? 'Sun is high — above the visor line' : 'Sun is off to the side of your view';
  return `<strong>${verdict}</strong>Heading ${compass(sample.heading)} (${sample.heading.toFixed(0)}°). Sun ${alt.toFixed(1)}° high, ${side} (azimuth ${row.sun.azimuth.toFixed(0)}°).<br/><span class="fineprint">Shaded wedge: windshield glare zone (≤${GLARE_MAX_ALT}° high, within ±${GLARE_HALF_ANGLE}°).</span>`;
}
