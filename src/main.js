// main.js — app wiring.
import L from 'leaflet';
import { getRoute, getForecastAt, simulatedForecast } from './api.js';
import { bearing, glareForSegment, glarePhase } from './glare.js';
import { buildBriefing, weatherCodeText } from './briefing.js';

const CITIES = {
  'Amherst, MA': { lat: 42.3732, lon: -72.5199 },
  'New York, NY': { lat: 40.7128, lon: -74.006 },
  'Chicago, IL': { lat: 41.8781, lon: -87.6298 },
  'Boston, MA': { lat: 42.3601, lon: -71.0589 },
  'Buffalo, NY': { lat: 42.8864, lon: -78.8784 },
  'Philadelphia, PA': { lat: 39.9526, lon: -75.1652 },
};

const WAYPOINT_COUNT = 6; // including start and end

let map, routeLayer, markerLayer;

function initUI() {
  const originSel = document.getElementById('origin');
  const destSel = document.getElementById('destination');
  for (const name of Object.keys(CITIES)) {
    originSel.add(new Option(name, name));
    destSel.add(new Option(name, name));
  }
  originSel.value = 'Amherst, MA';
  destSel.value = 'New York, NY';

  // Default departure: next top of hour, local.
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  document.getElementById('departure').value = toLocalInput(d);

  map = L.map('map').setView([42.0, -75.0], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  document.getElementById('trip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    planTrip().catch((err) => {
      document.getElementById('data-note').textContent = 'Error: ' + err.message;
    });
  });
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function haversine(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Pick evenly-spaced waypoints along the route by cumulative distance.
function pickWaypoints(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  }
  const total = cum[cum.length - 1];
  const picks = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let idx = cum.findIndex((c) => c >= target);
    if (idx < 0) idx = coords.length - 1;
    picks.push({ idx, fraction: total ? target / total : 0 });
  }
  return picks;
}

async function planTrip() {
  const note = document.getElementById('data-note');
  note.textContent = 'Planning…';
  const originName = document.getElementById('origin').value;
  const destName = document.getElementById('destination').value;
  if (originName === destName) throw new Error('Origin and destination must differ.');
  const origin = CITIES[originName];
  const destination = CITIES[destName];
  const departure = new Date(document.getElementById('departure').value);

  // Route (with demo fallback).
  let route;
  let routeSimulated = false;
  try {
    route = await getRoute(origin, destination);
  } catch (e) {
    routeSimulated = true;
    route = {
      coordinates: [
        [origin.lat, origin.lon],
        [destination.lat, destination.lon],
      ],
      durationSec: (haversine([origin.lat, origin.lon], [destination.lat, destination.lon]) / 1000 / 90) * 3600,
      distanceM: haversine([origin.lat, origin.lon], [destination.lat, destination.lon]),
      simulated: true,
    };
  }

  const picks = pickWaypoints(route.coordinates, WAYPOINT_COUNT);
  const segments = [];

  for (let i = 0; i < picks.length; i++) {
    const { idx, fraction } = picks[i];
    const [lat, lon] = route.coordinates[idx];
    const eta = new Date(departure.getTime() + fraction * route.durationSec * 1000);

    // Heading: toward next coordinate (or previous for the final point).
    let hLat, hLon;
    if (idx < route.coordinates.length - 1) {
      [hLat, hLon] = route.coordinates[Math.min(idx + 1, route.coordinates.length - 1)];
    } else {
      [hLat, hLon] = route.coordinates[Math.max(idx - 1, 0)];
    }
    const headingDeg =
      idx < route.coordinates.length - 1
        ? bearing(lat, lon, hLat, hLon)
        : bearing(hLat, hLon, lat, lon);

    let forecast;
    try {
      forecast = await getForecastAt(lat, lon, eta);
    } catch (e) {
      forecast = simulatedForecast(lat, lon, eta);
    }

    const glare = glareForSegment(lat, lon, eta, headingDeg);
    const phase = glarePhase(headingDeg, glare.altitudeDeg);

    const name =
      i === 0 ? originName : i === picks.length - 1 ? destName : `Waypoint ${i} (${lat.toFixed(2)}, ${lon.toFixed(2)})`;

    segments.push({
      name,
      lat,
      lon,
      eta,
      etaText: eta.toLocaleString([], { hour: '2-digit', minute: '2-digit', weekday: 'short' }),
      headingDeg,
      forecast,
      glare,
      phase,
    });
  }

  renderMap(route, segments);
  renderWaypoints(segments);
  renderBriefing(segments, {
    origin: originName,
    destination: destName,
    departureText: departure.toLocaleString(),
    durationText: formatDuration(route.durationSec),
    distanceText: `${(route.distanceM / 1000).toFixed(0)} km`,
  });

  const flags = [];
  if (routeSimulated) flags.push('route simulated (OSRM unreachable)');
  if (segments.some((s) => s.forecast.simulated)) flags.push('some forecasts simulated');
  note.textContent = flags.length
    ? '⚠️ Demo data in use: ' + flags.join('; ') + '.'
    : '✓ Live routing (OSRM) + live forecast (Open-Meteo) + computed sun position (SunCalc).';
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

const GLARE_COLORS = ['#4caf50', '#ffc107', '#ff7043', '#d32f2f'];

function renderMap(route, segments) {
  routeLayer.clearLayers();
  markerLayer.clearLayers();
  const line = L.polyline(route.coordinates, { color: '#1565c0', weight: 4, opacity: 0.7 });
  routeLayer.addLayer(line);
  map.fitBounds(line.getBounds(), { padding: [30, 30] });

  for (const s of segments) {
    const color = GLARE_COLORS[s.glare.severity];
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 9,
      color: '#333',
      weight: 1,
      fillColor: color,
      fillOpacity: 0.9,
    });
    marker.bindPopup(
      `<b>${s.name}</b><br/>ETA ${s.etaText}<br/>` +
        `${s.forecast.temperatureC.toFixed(0)}°C, ${weatherCodeText(s.forecast.weatherCode)}<br/>` +
        `Glare: ${s.glare.label}`
    );
    markerLayer.addLayer(marker);
  }
}

function renderWaypoints(segments) {
  const el = document.getElementById('waypoints');
  el.innerHTML = '';
  for (const s of segments) {
    const card = document.createElement('div');
    card.className = 'wp-card glare-' + s.glare.severity;
    const f = s.forecast;
    card.innerHTML = `
      <div class="wp-head">
        <span class="wp-name">${s.name}</span>
        <span class="wp-eta">${s.etaText}</span>
      </div>
      <div class="wp-grid">
        <div>🌡️ ${f.temperatureC.toFixed(0)}°C</div>
        <div>${f.snowfallCm >= 0.2 ? '❄️ ' + f.snowfallCm + ' cm' : f.precipitationMm >= 0.2 ? '🌧️ ' + f.precipitationMm + ' mm' : '🌤️ dry'}</div>
        <div>💨 ${f.windSpeedKmh.toFixed(0)} km/h @ ${f.windDirDeg}°</div>
        <div>☀️ ${s.glare.altitudeDeg > 0 ? s.glare.altitudeDeg.toFixed(0) + '° alt' : 'below horizon'}</div>
      </div>
      <div class="wp-glare" style="background:${GLARE_COLORS[s.glare.severity]}">
        ${s.glare.label}${f.simulated ? ' · demo data' : ''}
      </div>
      <div class="wp-reason">${s.glare.reason}</div>
    `;
    el.appendChild(card);
  }
}

function renderBriefing(segments, meta) {
  const lines = buildBriefing(segments, meta);
  const el = document.getElementById('briefing');
  el.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
}

initUI();
