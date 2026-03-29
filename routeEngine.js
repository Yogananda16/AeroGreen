// routeEngine.js
// BFS over real route data to find the most fuel-efficient permitted path.

const { airports, airlineRoutes } = require('./dataLoader');

// ── Haversine great-circle distance in km ────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Total path distance in km ────────────────────────────────────────────────
function pathDistance(pathArr) {
  let dist = 0;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const a = airports[pathArr[i]];
    const b = airports[pathArr[i + 1]];
    if (a && b) dist += haversine(a.lat, a.lon, b.lat, b.lon);
  }
  return Math.round(dist);
}

// ── Fuel & CO2 estimate ──────────────────────────────────────────────────────
// ~4.5 kg fuel per km (widebody average), CO2 = fuel × 3.16
function estimateFuelAndCO2(distKm) {
  const fuelKg = Math.round(distKm * 4.5);
  const co2t   = ((fuelKg * 3.16) / 1000).toFixed(1);
  return { fuelKg, co2t };
}

// ── Main route finder ────────────────────────────────────────────────────────
function findOptimalRoute({ airline, origin, destination, windData = {} }) {

  // Validate airline
  const airlineGraph = airlineRoutes[airline];
  if (!airlineGraph) {
    return {
      found:          false,
      reason:         `Airline code "${airline}" not found in route database.`,
      nextWindow:     '06:00 UTC tomorrow',
      alternateHub:   null,
      fuelPenaltyPct: 0,
    };
  }

  // Validate airports
  if (!airports[origin]) {
    return {
      found:  false,
      reason: `Origin airport "${origin}" not recognized.`,
    };
  }
  if (!airports[destination]) {
    return {
      found:  false,
      reason: `Destination airport "${destination}" not recognized.`,
    };
  }

  // ── BFS (max 3 hops: origin → hub1 → hub2 → destination) ─────────────────
  const queue    = [[origin, [origin]]];
  const visited  = new Set([origin]);
  const allPaths = [];

  while (queue.length) {
    const [current, path] = queue.shift();

    if (current === destination) {
      allPaths.push([...path]);
      continue;
    }

    // Stop searching deeper than 4 airports (3 hops)
    if (path.length >= 4) continue;

    for (const next of (airlineGraph[current] || new Set())) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, [...path, next]]);
      }
    }
  }

  // ── No route found ────────────────────────────────────────────────────────
  if (!allPaths.length) {
    const anyHub = Object.keys(airlineGraph)[0] || null;
    return {
      found:          false,
      reason:         `No permitted routing found for ${airline} from ${origin} to ${destination}.`,
      nextWindow:     '06:00 UTC tomorrow',
      alternateHub:   anyHub,
      fuelPenaltyPct: 15,
    };
  }

  // ── Score all paths by distance ───────────────────────────────────────────
  const scored = allPaths.map(path => {
    const distKm = pathDistance(path);

    // Wind tailwind reduces effective fuel burn (up to 8%)
    const windBonus  = (windData.tailwindBenefit || 0) * 0.08;
    const effectiveDist = Math.round(distKm * (1 - windBonus));

    const { fuelKg, co2t } = estimateFuelAndCO2(effectiveDist);
    const flightTimeH      = (distKm / 870).toFixed(1); // ~870 km/h cruise

    return { path, distKm, effectiveDist, fuelKg, co2t, flightTimeH };
  });

  // Sort: shortest effective distance = most fuel efficient
  scored.sort((a, b) => a.effectiveDist - b.effectiveDist);
  const best = scored[0];

  // Fuel saving vs worst option (or 8% default if only one path)
  const baselineDist  = best.distKm;
  const optimizedDist = best.effectiveDist;
  const windSaving    = Math.round(((baselineDist - optimizedDist) / baselineDist) * 100);

  const worst = scored[scored.length - 1];
  const routeSaving = scored.length > 1
    ? Math.round(((worst.distKm - best.distKm) / worst.distKm) * 100)
    : 0;

  const fuelSavingPct = Math.min(windSaving + routeSaving, 25);

  return {
    found:         true,
    route:         best.path,
    waypoints:     best.path.slice(1, -1),
    distanceKm:    best.distKm,
    fuelKg:        best.fuelKg,
    co2t:          best.co2t,
    flightTimeH:   parseFloat(best.flightTimeH),
    fuelSavingPct,
    altitudeFt:    38000,
    note: (windData.tailwindBenefit || 0) > 0.3
      ? 'Strong tailwind corridor active — additional fuel saving applied.'
      : 'Optimal permitted routing selected by great-circle distance.',
  };
}

module.exports = { findOptimalRoute, haversine, pathDistance };