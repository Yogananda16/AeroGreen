// server.js
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const http     = require('http');
const WebSocket = require('ws');

const { loadData, airports }                    = require('./dataLoader');
const { findOptimalRoute }                      = require('./routeEngine');
const { extractIntent }                         = require('./intentExtractor');
const { buildResponse, explainRoute }           = require('./responseBuilder');
const { getMetarByLatLon, getRouteWindData }    = require('./weatherService');
const { getLiveTraffic, getRouteTrafficDensity } = require('./openskyService');
const { getRouteNews }                          = require('./newsService');
const { mintCarbonCredits, getTokenBalance }    = require('./solanaService');

loadData();

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  ws.on('close', () => console.log('Dashboard client disconnected'));
});

// ── POST /api/route ───────────────────────────────────────────────────────────
app.post('/api/route', async (req, res) => {
  try {
    const { airline, origin, destination, date, time, walletAddress } = req.body;

    if (!airline || !origin || !destination) {
      return res.status(400).json({
        response: 'Please provide airline IATA code, origin, and destination airport codes.',
        error:    'Missing required fields',
      });
    }

    console.log(`\nRoute request: ${airline} ${origin} → ${destination} on ${date} at ${time}`);

    const originAirport = airports[origin];
    const windData = originAirport
      ? await getMetarByLatLon(originAirport.lat, originAirport.lon)
      : { tailwindBenefit: 0, windSpeedKt: 0 };

    const result = findOptimalRoute({ airline, origin, destination, windData });

    let trafficData = [];
    if (result.found) {
      trafficData = await getRouteTrafficDensity(result.route, airports);
    }

    // News + geopolitical risk
    const routeAirports = result.found
      ? result.route.map(code => airports[code]).filter(Boolean)
      : [airports[origin], airports[destination]].filter(Boolean);
    const countries = [...new Set(routeAirports.map(a => a.country).filter(Boolean))];
    const { articles, isDangerous } = await getRouteNews(countries);

    // AI explanation
    const bestRoute = result.found ? {
      name:         result.route.join(' → '),
      distance_km:  result.distanceKm,
      fuel_liters:  result.fuelL,
      emissions_kg: result.co2t * 1000,
    } : null;
    const explanation = bestRoute
      ? await explainRoute(bestRoute, [], articles, isDangerous)
      : '';

    const intent = { airlineIATA: airline, airlineName: airline, origin, destination, date, time };
    const spokenResponse = buildResponse(intent, result, windData);

    const routeCoords = result.found
      ? result.route.map(code => ({ code, ...airports[code] })).filter(a => a.lat && a.lon)
      : [];

    broadcast({
      type: 'route_result',
      intent: { airline, origin, destination, date, time },
      result,
      wind:       windData,
      traffic:    trafficData,
      routeCoords,
      news:       { articles, isDangerous },
      explanation,
      timestamp:  new Date().toISOString(),
    });

    res.json({
      response:    spokenResponse,
      data:        result,
      wind:        windData,
      traffic:     trafficData,
      routeCoords,
      news:        { articles, isDangerous },
      explanation,
    });

    // Mint carbon credits if wallet provided (non-blocking)
    if (walletAddress && result.found) {
      mintCarbonCredits(walletAddress, parseFloat(result.co2t), result.distanceKm)
        .then(credit => console.log(`🪙  Carbon credits minted:`, credit))
        .catch(err  => console.warn('Mint failed (non-blocking):', err.message));
    }

  } catch (err) {
    console.error('Route API error:', err);
    res.status(500).json({
      response: 'System error while calculating route. Please try again.',
      error:    err.message,
    });
  }
});

// ── POST /api/route/transcript ────────────────────────────────────────────────
app.post('/api/route/transcript', async (req, res) => {
  try {
    const { transcript, walletAddress } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'No transcript provided' });
    }

    const intent = extractIntent(transcript);
    console.log('\nExtracted intent:', intent);

    if (!intent.valid) {
      return res.json({
        response: 'Could not extract flight details. Please state the airline, departure airport code, and destination code.',
        intent,
      });
    }

    const originAirport = airports[intent.origin];
    const windData = originAirport
      ? await getMetarByLatLon(originAirport.lat, originAirport.lon)
      : { tailwindBenefit: 0 };

    const result      = findOptimalRoute({ airline: intent.airlineIATA, origin: intent.origin, destination: intent.destination, windData });
    const trafficData = result.found ? await getRouteTrafficDensity(result.route, airports) : [];

    // News + geopolitical risk
    const routeAirports = result.found
      ? result.route.map(code => airports[code]).filter(Boolean)
      : [airports[intent.origin], airports[intent.destination]].filter(Boolean);
    const countries = [...new Set(routeAirports.map(a => a.country).filter(Boolean))];
    const { articles, isDangerous } = await getRouteNews(countries);

    // AI explanation
    const bestRoute = result.found ? {
      name:         result.route.join(' → '),
      distance_km:  result.distanceKm,
      fuel_liters:  result.fuelL,
      emissions_kg: result.co2t * 1000,
    } : null;
    const explanation = bestRoute
      ? await explainRoute(bestRoute, [], articles, isDangerous)
      : '';

    const spokenResponse = buildResponse(intent, result, windData);
    const routeCoords = result.found
      ? result.route.map(code => ({ code, ...airports[code] })).filter(a => a.lat && a.lon)
      : [];

    broadcast({
      type: 'route_result',
      intent,
      result,
      wind:       windData,
      traffic:    trafficData,
      routeCoords,
      news:       { articles, isDangerous },
      explanation,
      timestamp:  new Date().toISOString(),
    });

    res.json({
      response:    spokenResponse,
      intent,
      data:        result,
      wind:        windData,
      traffic:     trafficData,
      routeCoords,
      news:        { articles, isDangerous },
      explanation,
    });

    // Mint carbon credits if wallet provided (non-blocking)
    if (walletAddress && result.found) {
      mintCarbonCredits(walletAddress, parseFloat(result.co2t), result.distanceKm)
        .then(credit => console.log(`🪙  Carbon credits minted:`, credit))
        .catch(err  => console.warn('Mint failed (non-blocking):', err.message));
    }

  } catch (err) {
    console.error('Transcript API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/credits/:wallet ──────────────────────────────────────────────────
app.get('/api/credits/:wallet', async (req, res) => {
  try {
    const balance = await getTokenBalance(req.params.wallet);
    res.json({ wallet: req.params.wallet, balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/airports/:iata ───────────────────────────────────────────────────
app.get('/api/airports/:iata', (req, res) => {
  const airport = airports[req.params.iata.toUpperCase()];
  airport
    ? res.json(airport)
    : res.status(404).json({ error: 'Airport not found' });
});

// ── GET /api/traffic ──────────────────────────────────────────────────────────
app.get('/api/traffic', async (req, res) => {
  try {
    const { minLat = 30, maxLat = 60, minLon = -80, maxLon = 80 } = req.query;
    const data = await getLiveTraffic(
      parseFloat(minLat), parseFloat(maxLat),
      parseFloat(minLon), parseFloat(maxLon)
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/weather/:iata ────────────────────────────────────────────────────
app.get('/api/weather/:iata', async (req, res) => {
  try {
    const airport = airports[req.params.iata.toUpperCase()];
    if (!airport) return res.status(404).json({ error: 'Airport not found' });
    const weather = await getMetarByLatLon(airport.lat, airport.lon);
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/signed-url ───────────────────────────────────────────────────────
app.get('/api/signed-url', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.AGENT_ID}`,
      {
        method:  'GET',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      }
    );
    if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);
    const data = await response.json();
    res.json({ signedUrl: data.signed_url });
  } catch (err) {
    console.error('Signed URL error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🛫  ATC Voice Agent server running on http://localhost:${PORT}`);
  console.log(`📡  WebSocket ready for dashboard`);
  console.log(`🌐  API endpoints:`);
  console.log(`    POST /api/route`);
  console.log(`    POST /api/route/transcript`);
  console.log(`    GET  /api/credits/:wallet`);
  console.log(`    GET  /api/airports/:iata`);
  console.log(`    GET  /api/traffic`);
  console.log(`    GET  /api/weather/:iata\n`);
});