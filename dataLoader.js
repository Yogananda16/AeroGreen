// dataLoader.js
// Loads airports.csv, airlines.csv, routes.csv into memory at startup.
// All other modules import from here — never read CSVs twice.

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── In-memory indexes (exported and shared across modules) ──────────────────

const airports     = {};  // IATA → { name, city, country, lat, lon, alt }
const airlines     = {};  // IATA → { id, name, country, active }
const airlineByName = {}; // lowercase full name → IATA code
const airlineRoutes = {}; // airlineIATA → { srcIATA: Set(dstIATA) }

// ── Loader ──────────────────────────────────────────────────────────────────

function loadData() {
  const dataDir = path.join(__dirname, 'data');

  // ── 1. airports.csv ───────────────────────────────────────────────────────
  // Columns: id, name, city, country, IATA, ICAO, lat, lon, alt, ...
  const airportRows = parse(
    fs.readFileSync(path.join(dataDir, 'airports.csv')),
    { relax_quotes: true, skip_empty_lines: true, trim: true }
  );

  for (const r of airportRows) {
    const iata = r[4];
    if (!iata || iata === '\\N' || iata === '') continue;
    airports[iata] = {
      name:    r[1],
      city:    r[2],
      country: r[3],
      lat:     parseFloat(r[6]),
      lon:     parseFloat(r[7]),
      alt:     parseInt(r[8]) || 0,
    };
  }
  console.log(`✓ Airports loaded: ${Object.keys(airports).length}`);

  // ── 2. airlines.csv ───────────────────────────────────────────────────────
  // Columns: id, name, alias, IATA, ICAO, callsign, country, active
  const airlineRows = parse(
    fs.readFileSync(path.join(dataDir, 'airlines.csv')),
    { relax_quotes: true, skip_empty_lines: true, trim: true }
  );

  for (const r of airlineRows) {
    const iata = r[3];
    const name = r[1];
    if (!iata || iata === '\\N' || iata === '') continue;

    airlines[iata] = {
      id:      r[0],
      name,
      country: r[6],
      active:  r[7] === 'Y',
    };

    // Index by lowercase name for spoken name resolution
    if (name) airlineByName[name.toLowerCase()] = iata;
  }
  console.log(`✓ Airlines loaded: ${Object.keys(airlines).length}`);

  // ── 3. routes.csv ─────────────────────────────────────────────────────────
  // Columns: airlineIATA, airlineId, srcIATA, srcId, dstIATA, dstId,
  //          codeshare, stops, equipment
  const routeRows = parse(
    fs.readFileSync(path.join(dataDir, 'routes.csv')),
    { relax_quotes: true, skip_empty_lines: true, trim: true }
  );

  for (const r of routeRows) {
    const airlineIATA = r[0];
    const src         = r[2];
    const dst         = r[4];

    if (!airlineIATA || !src || !dst) continue;
    if (airlineIATA === '\\N' || src === '\\N' || dst === '\\N') continue;

    if (!airlineRoutes[airlineIATA])          airlineRoutes[airlineIATA] = {};
    if (!airlineRoutes[airlineIATA][src])     airlineRoutes[airlineIATA][src] = new Set();
    airlineRoutes[airlineIATA][src].add(dst);
  }
  console.log(`✓ Routes loaded: ${routeRows.length} across ${Object.keys(airlineRoutes).length} airlines`);
}

// ── Helper: resolve a spoken airline name to IATA code ──────────────────────
// e.g. "british airways" → "BA"
function resolveAirlineIATA(spokenName) {
  if (!spokenName) return null;
  const lower = spokenName.toLowerCase().trim();

  // Direct IATA match (e.g. user said "BA")
  if (airlines[spokenName.toUpperCase()]) return spokenName.toUpperCase();

  // Full name match from CSV
  if (airlineByName[lower]) return airlineByName[lower];

  // Partial match fallback
  for (const [name, iata] of Object.entries(airlineByName)) {
    if (name.includes(lower) || lower.includes(name)) return iata;
  }

  return null;
}

module.exports = {
  loadData,
  airports,
  airlines,
  airlineRoutes,
  resolveAirlineIATA,
};