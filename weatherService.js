// weatherService.js
// Fetches real METAR aviation weather data using CheckWX API.
// CheckWX provides actual aviation weather reports used by real ATC.
// Docs: https://www.checkwxapi.com/documentation/metar

const https = require('https');

const CHECKWX_KEY = process.env.CHECKWX_API_KEY;

// ── Helper: HTTPS GET as a promise ───────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response')); }
      });
    }).on('error', reject);
  });
}

// ── Fetch METAR by ICAO code (airports use ICAO not IATA) ───────────────────
// airports.csv has ICAO in column 5 — but we query by lat/lon for simplicity
async function getMetarByLatLon(lat, lon) {
  if (!CHECKWX_KEY) {
    return {
      tailwindBenefit: 0,
      windSpeedKt:     0,
      windDir:         0,
      gustKt:          0,
      flightCategory:  'UNKNOWN',
      description:     'No CheckWX API key configured.',
      raw:             null,
    };
  }

  try {
    // Get decoded METAR nearest to lat/lon
    const url = `https://api.checkwx.com/v2/metar/lat/${lat}/lon/${lon}/decoded`;
    const data = await httpsGet(url, { 'X-API-Key': CHECKWX_KEY });

    if (!data.data || data.data.length === 0) {
      throw new Error('No METAR data returned for this location');
    }

    const metar = data.data[0];
    const wind  = metar.wind || {};

    const windSpeedKt     = wind.speed?.kts  || 0;
    const windDir         = wind.degrees      || 0;
    const gustKt          = wind.gust?.kts    || 0;
    const flightCategory  = metar.flight_category || 'VFR';
    const raw             = metar.raw_text    || '';
    const station         = metar.station?.name || 'Unknown station';

    // Tailwind benefit: higher wind = more potential jetstream benefit
    // Scaled: 50kt wind = full benefit (1.0), 0kt = none
    const tailwindBenefit = Math.min(windSpeedKt / 50, 1);

    // Flight category affects route recommendation
    // IFR/LIFR = poor visibility conditions = note for ATC
    const weatherAlert = ['IFR', 'LIFR'].includes(flightCategory)
      ? `Warning: ${flightCategory} conditions at ${station}.`
      : null;

    return {
      tailwindBenefit,
      windSpeedKt,
      windDir,
      gustKt,
      flightCategory,
      station,
      raw,
      weatherAlert,
      description: `${flightCategory} conditions. Wind ${windSpeedKt}kt from ${windDir}°${gustKt ? `, gusting ${gustKt}kt` : ''}.`,
    };

  } catch (err) {
    console.error('CheckWX API error:', err.message);
    return {
      tailwindBenefit: 0,
      windSpeedKt:     0,
      windDir:         0,
      gustKt:          0,
      flightCategory:  'UNKNOWN',
      description:     'Weather fetch failed.',
      weatherAlert:    null,
      raw:             null,
    };
  }
}

// ── Get wind data across entire route (one call per leg midpoint) ─────────────
async function getRouteWindData(routeArr, airportData) {
  const legWinds = [];

  for (let i = 0; i < routeArr.length - 1; i++) {
    const a = airportData[routeArr[i]];
    const b = airportData[routeArr[i + 1]];
    if (!a || !b) continue;

    // Midpoint of leg
    const midLat = ((a.lat + b.lat) / 2).toFixed(4);
    const midLon = ((a.lon + b.lon) / 2).toFixed(4);

    const wind = await getMetarByLatLon(midLat, midLon);
    legWinds.push({
      leg: `${routeArr[i]} → ${routeArr[i + 1]}`,
      ...wind,
    });
  }

  // Average tailwind benefit across all legs
  const avgTailwind = legWinds.length
    ? legWinds.reduce((sum, l) => sum + l.tailwindBenefit, 0) / legWinds.length
    : 0;

  // Any IFR/LIFR alerts along the route
  const alerts = legWinds
    .filter(l => l.weatherAlert)
    .map(l => l.weatherAlert);

  return {
    legs:            legWinds,
    tailwindBenefit: parseFloat(avgTailwind.toFixed(2)),
    windSpeedKt:     legWinds[0]?.windSpeedKt || 0,
    alerts,
  };
}

module.exports = { getMetarByLatLon, getRouteWindData };