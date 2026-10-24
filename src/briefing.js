// briefing.js — grounded, rule-based natural-language driving guidance.
// Deterministic (deadline-safe). Clearly derived from computed weather + glare values,
// so guidance is never hallucinated beyond the data.

function weatherCodeText(code) {
  // Open-Meteo WMO weather codes (subset).
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'partly cloudy';
  if ([45, 48].includes(code)) return 'foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorms';
  return 'mixed';
}

function windImplication(speedKmh) {
  if (speedKmh >= 50) return 'Strong crosswinds possible — grip the wheel firmly, especially for high-profile vehicles and on bridges.';
  if (speedKmh >= 30) return 'Moderate winds — expect some buffeting from passing trucks.';
  return 'Winds are light.';
}

function glareAdvice(severity) {
  switch (severity) {
    case 3: return 'Severe glare: use sun visor and polarized sunglasses, increase following distance, and slow down — visibility may drop sharply.';
    case 2: return 'Strong glare: lower the visor, keep sunglasses handy, and watch for brake lights that get washed out.';
    case 1: return 'Mild glare: be ready to use the visor as the sun shifts.';
    default: return null;
  }
}

/**
 * Build the overall briefing from per-waypoint analyses.
 * segments: [{ name, eta, forecast, glare, phase }]
 */
export function buildBriefing(segments, meta) {
  const lines = [];
  const anySimulated = segments.some((s) => s.forecast.simulated);

  lines.push(
    `Trip: ${meta.origin} → ${meta.destination}. Departure ${meta.departureText}. ` +
      `Estimated drive time ${meta.durationText} over ${meta.distanceText}.`
  );

  // Headline conditions.
  const temps = segments.map((s) => s.forecast.temperatureC);
  const tMin = Math.min(...temps).toFixed(0);
  const tMax = Math.max(...temps).toFixed(0);
  lines.push(`Temperatures along the way range ${tMin}°C to ${tMax}°C.`);

  // Precipitation.
  const wet = segments.filter((s) => s.forecast.precipitationMm >= 0.2);
  const snowy = segments.filter((s) => s.forecast.snowfallCm >= 0.2);
  if (snowy.length) {
    lines.push(`❄️ Snow expected near ${snowy.map((s) => s.name).join(', ')}. Reduce speed, leave extra stopping distance, and watch for black ice.`);
  }
  if (wet.length) {
    lines.push(`🌧️ Rain likely near ${wet.map((s) => s.name).join(', ')}. Roads may be slick; headlights on.`);
  }
  if (!wet.length && !snowy.length) {
    lines.push('🌤️ Mostly dry roads expected — no significant precipitation in the forecast window.');
  }

  // Wind — report the strongest.
  const windiest = segments.reduce((a, b) =>
    a.forecast.windSpeedKmh >= b.forecast.windSpeedKmh ? a : b
  );
  lines.push(
    `💨 Peak wind ~${windiest.forecast.windSpeedKmh.toFixed(0)} km/h near ${windiest.name}. ` +
      windImplication(windiest.forecast.windSpeedKmh)
  );

  // Sun glare — the differentiator.
  const glareSegs = segments.filter((s) => s.glare.severity >= 1).sort((a, b) => b.glare.severity - a.glare.severity);
  if (glareSegs.length) {
    const worst = glareSegs[0];
    const phaseNote =
      worst.phase === 'eastbound-sunrise'
        ? ' This is classic eastbound sunrise glare.'
        : worst.phase === 'westbound-sunset'
        ? ' This is classic westbound sunset glare.'
        : '';
    lines.push(
      `🌅 Sun glare alert near ${worst.name} around ${worst.etaText}: ${worst.glare.label.toLowerCase()}.` +
        phaseNote +
        ' ' +
        glareAdvice(worst.glare.severity)
    );
    if (glareSegs.length > 1) {
      lines.push(
        `Additional glare stretches: ${glareSegs
          .slice(1)
          .map((s) => `${s.name} (${s.glare.label.toLowerCase()})`)
          .join(', ')}.`
      );
    }
  } else {
    lines.push('🕶️ No significant sun glare expected for your heading and timing.');
  }

  if (anySimulated) {
    lines.push('⚠️ Note: some forecast values are simulated demo data (live weather service was unreachable).');
  }

  return lines;
}

export { weatherCodeText };
