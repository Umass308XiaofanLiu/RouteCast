// units.js — display formatting. Internal data is metric (°C, km/h, mm, cm, m).
export function makeFormatter(system = 'us') {
  const us = system === 'us';
  const num = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
  return {
    system,
    temp: (c) => (c == null ? '—' : us ? `${num(c * 1.8 + 32)}°F` : `${num(c)}°C`),
    speed: (kmh) => (kmh == null ? '—' : us ? `${num(kmh * 0.621371)} mph` : `${num(kmh)} km/h`),
    speedMph: (mph) => (mph == null ? '—' : us ? `${num(mph)} mph` : `${num(mph / 0.621371)} km/h`),
    precip: (mm) => (mm == null ? '—' : us ? `${num(mm / 25.4, 2)} in` : `${num(mm, 1)} mm`),
    snow: (cm) => (cm == null ? '—' : us ? `${num(cm / 2.54, 1)} in` : `${num(cm, 1)} cm`),
    dist: (m) => (m == null ? '—' : us ? (m < 1609 ? `${num(m * 3.28084 / 100) * 100} ft` : `${num(m / 1609.344, m < 16093 ? 1 : 0)} mi`) : m < 1000 ? `${num(m)} m` : `${num(m / 1000, m < 10000 ? 1 : 0)} km`),
    tempValue: (c) => (us ? c * 1.8 + 32 : c),
    tempUnit: us ? '°F' : '°C',
  };
}
