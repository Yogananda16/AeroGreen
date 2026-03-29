// responseBuilder.js
// Converts route result + intent into natural spoken language for the ATC operator.

const { airports, airlines } = require('./dataLoader');

// ── Helper: get airport display name ────────────────────────────────────────
function airportLabel(iata) {
  const a = airports[iata];
  return a ? `${iata} ${a.city}` : iata;
}

// ── Main response builder ────────────────────────────────────────────────────
function buildResponse(intent, result, windData = {}) {
  const { airlineName, airlineIATA, origin, destination, date = 'today', time = 'now' } = intent;
  const displayAirline = airlineName || airlineIATA;

  // ── Route found ────────────────────────────────────────────────────────────
  if (result.found) {
    const via = result.waypoints.length
      ? `via ${result.waypoints.map(airportLabel).join(', then ')}, `
      : 'direct, ';

    const windNote = (windData.tailwindBenefit || 0) > 0.3
      ? `Tailwind of ${windData.windSpeedKt || ''} knots on this corridor. `
      : '';

    const co2Note = `Estimated CO2 output: ${result.co2t} tonnes, saving approximately ${result.fuelSavingPct} percent versus non-optimized routing.`;

    return [
      `Routing confirmed for ${displayAirline}.`,
      `Departing ${airportLabel(origin)} to ${airportLabel(destination)},`,
      `${via}on ${date} at ${time}.`,
      `Full route: ${result.route.join(' → ')}.`,
      `Total distance: ${result.distanceKm.toLocaleString()} kilometers.`,
      `Estimated flight time: ${result.flightTimeH} hours.`,
      `Cruise altitude: ${result.altitudeFt.toLocaleString()} feet.`,
      windNote,
      co2Note,
      result.note,
    ].filter(Boolean).join(' ');
  }

  // ── No route found — fallback ──────────────────────────────────────────────
  const altHub = result.alternateHub
    ? airportLabel(result.alternateHub)
    : 'an alternate hub';

  return [
    `No fuel-optimal route currently available for ${displayAirline}`,
    `from ${airportLabel(origin)} to ${airportLabel(destination)}.`,
    `Reason: ${result.reason}`,
    `Next optimal departure window: ${result.nextWindow || 'unknown'}.`,
    result.alternateHub
      ? `Alternate option: routing via ${altHub} is available with a ${result.fuelPenaltyPct} percent higher fuel burn.`
      : '',
    `Please advise which option to proceed with.`,
  ].filter(Boolean).join(' ');
}

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function explainRoute(bestRoute, allRoutes, newsArticles = [], isDangerous = false) {
  try {
    const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let newsContext = '';
    if (newsArticles.length > 0) {
      const headlines = newsArticles.slice(0, 5).map(a => `- ${a.title}`).join('\n');
      newsContext = `
Current geopolitical news for this route's region:
${headlines}
Danger detected: ${isDangerous ? 'Yes' : 'No'}`;
    }

    const prompt = `You are an expert AI flight route analyst and pilot advisor.

Selected Route: ${bestRoute.name}
- Distance: ${bestRoute.distance_km} km
- Fuel: ${bestRoute.fuel_liters} liters
- CO2 Emissions: ${bestRoute.emissions_kg} kg

${newsContext}

In 3-4 sentences, explain why this route was selected based on:
1. Fuel efficiency and emissions
2. Any geopolitical concerns from the live news above
Be specific — reference the news if relevant. Speak like a real pilot advisor.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
 } catch (err) {
  console.error('Gemini explanation error:', err.message);
  // FIXED: allRoutes may be empty, don't index into it
  const geoNote = isDangerous
    ? ' Warning: Active geopolitical risks detected in transit regions.'
    : newsArticles.length > 0 ? ' No immediate geopolitical risks detected.' : '';
  return `The ${bestRoute.name} route covers ${bestRoute.distance_km} km with ${bestRoute.emissions_kg} kg CO2.${geoNote}`;
} 
}

module.exports = { buildResponse, explainRoute };