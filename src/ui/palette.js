// palette.js — one color system for map, timeline, legend and chips (mirrors styles.css).
export const C = {
  route: '#4263eb',
  casing: '#ffffff',
  g: ['#4263eb', '#f5c400', '#fd7e14', '#e03131'],
  rain: '#1c7ed6',
  heavy: '#0b4f9c',
  snow: '#9c36b5',
  wind: '#0ca678',
  fog: '#868e96',
  dry: '#4263eb',
  day: '#74c0fc',
  lowsun: '#ffa94d',
  twilight: '#9775fa',
  night: '#2b2f77',
  nodata: '#ced4da',
  temp: '#e8590c',
  ink: '#0f1b33',
};

export const GLARE_LABEL = ['No glare', 'Mild glare', 'Strong glare', 'Severe glare'];
export const PHASE_LABEL = { day: 'Daylight', 'low-sun': 'Low sun', twilight: 'Twilight', night: 'Dark' };
export const PHASE_COLOR = { day: C.day, 'low-sun': C.lowsun, twilight: C.twilight, night: C.night };

/** Weather category for coloring. */
export function weatherCategory(row) {
  if (!row.wx) return 'nodata';
  const h = row.hz;
  if (h.snow || h.ice) return 'snow';
  if (h.heavyRain || h.storm) return 'heavy';
  if (h.wet) return 'rain';
  if (h.lowVis) return 'fog';
  if (h.windy) return 'wind';
  return 'dry';
}
export const WEATHER_COLOR = { nodata: C.nodata, snow: C.snow, heavy: C.heavy, rain: C.rain, fog: C.fog, wind: C.wind, dry: C.dry };
export const WEATHER_LABEL = { dry: 'Dry', rain: 'Rain', heavy: 'Heavy rain / storms', snow: 'Snow / ice', fog: 'Low visibility', wind: 'Strong crosswind', nodata: 'No forecast' };

const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const ICONS = {
  glare: svg('<circle cx="12" cy="12" r="4" fill="#fd7e14" stroke="#fd7e14"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="#fd7e14"/>'),
  'rear-sun': svg('<path d="M3 17h18" stroke="#868e96"/><path d="M7 17a5 5 0 0 1 10 0" stroke="#fd7e14"/><path d="M12 5v3M5.6 8.6l1.5 1.5M18.4 8.6l-1.5 1.5" stroke="#fd7e14"/>'),
  rain: svg('<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.4 1.6A3.5 3.5 0 0 1 17 15H7z" stroke="#1c7ed6"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" stroke="#1c7ed6"/>'),
  snow: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" stroke="#9c36b5"/>'),
  visibility: svg('<path d="M3 9h18M5 13h14M3 17h18" stroke="#868e96"/>'),
  storm: svg('<path d="M7 14a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.4 1.6A3.5 3.5 0 0 1 17 14" stroke="#0b4f9c"/><path d="M12 12l-2 5h4l-2 5" stroke="#f5c400"/>'),
  wind: svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" stroke="#0ca678"/>'),
  night: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" stroke="#2b2f77" fill="#e5e7ff"/>'),
  cold: svg('<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" stroke="#1c7ed6"/><path d="M12 9v7" stroke="#1c7ed6"/>'),
  fatigue: svg('<circle cx="12" cy="12" r="9" stroke="#5f3dc4"/><path d="M12 7v5l3 2" stroke="#5f3dc4"/>'),
  data: svg('<circle cx="12" cy="12" r="9" stroke="#868e96"/><path d="M12 8h.01M11 12h1v5h1" stroke="#868e96"/>'),
  depart: svg('<path d="M5 12h12M13 6l6 6-6 6" stroke="#2f9e44"/>'),
  sunPreset: svg('<path d="M3 18h18" stroke="#a34b00"/><path d="M7 18a5 5 0 0 1 10 0" stroke="#e8590c" fill="#ffd43b"/><path d="M12 7v2M6 10l1.4 1.4M18 10l-1.4 1.4" stroke="#e8590c"/>'),
};
