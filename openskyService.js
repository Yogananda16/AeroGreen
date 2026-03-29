// openskyService.js
// Fetches live flight traffic using OpenSky Network API.
// No API key required for basic anonymous access.
// Docs: https://openskynetwork.github.io/opensky-api/rest.html

const https = require('https');

// ── Helper: HTTPS GET as a promise ───────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse OpenSky response')); }
      });
    }).on('error', reject);
  });
}

// ── Fetch live flights in a bounding box ─────────────────────────────────────
// OpenSky state vector columns (by index):
// 0:icao24, 1:callsign, 2:origin_country, 3:time_position,
// 4:last_contact, 5:longitude, 6:latitude, 7:baro_altitude,
// 8:on_ground, 9:velocity, 10:true_track, 11:vertical_rate,
// 12:sensors, 13:geo_altitude, 14:squawk, 15:spi, 16:position_source
async function getLiveTraffic(minLat, maxLat, minLon, maxLon) {
  try {
    const url = `https://opensky-network.org/api/states/all` +
      `?lamin=${minLat}&lomin=${minLon}&lamax=${maxLat}&lomax=${maxLon}`;

    const data = await httpsGet(url);
    const states = data.states || [];

    const flights = states
      .filter(s => s[6] !== null && s[5] !== null) // must have position
      .filter(s => !s[8])                           // exclude on-ground
      .slice(0, 100)                                // cap at 100 for performance
      .map(s => ({
        icao24:    s[0],
        callsign:  s[1]?.trim() || 'Unknown',
        lat:       s[6],
        lon:       s[5],
        altitudeM: s[7]  || 0,
        altitudeFt: s[7] ? Math.round(s[7] * 3.281) : 0,
        speedKt:   s[9]  ? Math.round(s[9] * 1.944) : 0,
        heading:   s[10] || 0,
        country:   s[2]  || 'Unknown',
      }));

    return {
      count:   states.length,
      flights,
      density: states.length > 100 ? 'high' : states.length > 40 ? 'medium' : 'low',
    };

  } catch (err) {
    console.error('OpenSky error:', err.message);
    return { count: 0, flights: [], density: 'unknown' };
  }
}

// ── Get traffic density along each leg of a route ────────────────────────────
async function getRouteTrafficDensity(routeArr, airportData) {
  const results = [];

  for (let i = 0; i < routeArr.length - 1; i++) {
    const a = airportData[routeArr[i]];
    const b = airportData[routeArr[i + 1]];
    if (!a || !b) continue;

    // Bounding box around the leg with 3 degree padding
    const minLat = Math.min(a.lat, b.lat) - 3;
    const maxLat = Math.max(a.lat, b.lat) + 3;
    const minLon = Math.min(a.lon, b.lon) - 3;
    const maxLon = Math.max(a.lon, b.lon) + 3;

    const traffic = await getLiveTraffic(minLat, maxLat, minLon, maxLon);

    results.push({
      leg:     `${routeArr[i]} → ${routeArr[i + 1]}`,
      count:   traffic.count,
      density: traffic.density,
      sample:  traffic.flights.slice(0, 5), // first 5 flights for dashboard
    });
  }

  return results;
}

module.exports = { getLiveTraffic, getRouteTrafficDensity };