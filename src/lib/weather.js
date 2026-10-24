// weather.js — driving implications of a forecast value at a heading.
import { signedAngle } from './geo.js';

const KMH_TO_MPH = 0.621371;

/**
 * Wind components relative to the vehicle. Meteorological direction = where wind comes FROM.
 * headwind > 0 means wind blowing against the car; crosswind is always >= 0.
 */
export function windComponents(speed, fromDeg, heading) {
  if (speed == null || fromDeg == null) return { crosswind: null, headwind: null, side: null };
  const rel = signedAngle(fromDeg, heading); // 0 = from straight ahead
  const rad = (rel * Math.PI) / 180;
  return {
    crosswind: Math.abs(speed * Math.sin(rad)),
    headwind: speed * Math.cos(rad),
    side: rel > 0 ? 'right' : rel < 0 ? 'left' : 'ahead', // wind arriving from the driver's right/left
  };
}

export const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Heavy freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Severe thunderstorm, hail',
};

export function describeCode(code) {
  return code == null ? 'No forecast' : WMO[code] ?? `Code ${code}`;
}

/**
 * Hazard flags for one forecast value (metric units from Open-Meteo) at a heading.
 * Thresholds are conservative planning heuristics, not official criteria.
 */
export function hazards(wx, heading, vehicle = 'car') {
  if (!wx) return { flags: [], wet: false, snow: false, ice: false, lowVis: false, storm: false, windy: false, cross: null };
  const flags = [];
  const precip = wx.precipitation ?? 0;
  const snowfall = wx.snowfall ?? 0;
  const code = wx.weatherCode;
  const snow = snowfall >= 0.1 || [71, 73, 75, 77, 85, 86].includes(code);
  const freezingCode = [56, 57, 66, 67].includes(code);
  const ice = freezingCode || (precip >= 0.1 && wx.temperature != null && wx.temperature <= 0.5 && !snow);
  const wet = precip >= 0.2 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  const heavyRain = precip >= 4 || [65, 82].includes(code);
  const storm = code >= 95;
  const lowVis = (wx.visibility != null && wx.visibility < 1600) || code === 45 || code === 48;
  const gust = wx.windGusts ?? wx.windSpeed;
  const cross = windComponents(gust, wx.windDirection, heading);
  const crossMph = cross.crosswind == null ? 0 : cross.crosswind * KMH_TO_MPH;
  const highProfile = vehicle === 'high-profile' || vehicle === 'motorcycle';
  const windLimit = highProfile ? 25 : 40; // mph crosswind gust
  const windy = crossMph >= windLimit;
  if (snow) flags.push(snowfall >= 1 ? 'heavy-snow' : 'snow');
  if (ice) flags.push('ice');
  if (storm) flags.push('thunderstorm');
  if (heavyRain && !snow) flags.push('heavy-rain');
  else if (wet && !snow) flags.push('rain');
  if (lowVis) flags.push('low-visibility');
  if (windy) flags.push('crosswind');
  return { flags, wet, snow, ice, lowVis, storm, heavyRain, windy, cross, crossMph };
}
