// intentExtractor.js
// Parses ATC spoken transcript into structured flight intent.
// Resolves airline names to IATA codes using the real airlines dataset.

const { resolveAirlineIATA } = require('./dataLoader');

// Spoken name aliases → IATA (covers the most common airlines ATC would mention)
const SPOKEN_ALIASES = {
  'british airways':    'BA',
  'emirates':           'EK',
  'air india':          'AI',
  'united':             'UA',
  'united airlines':    'UA',
  'lufthansa':          'LH',
  'delta':              'DL',
  'american':           'AA',
  'american airlines':  'AA',
  'qatar':              'QR',
  'qatar airways':      'QR',
  'singapore':          'SQ',
  'singapore airlines': 'SQ',
  'air france':         'AF',
  'klm':                'KL',
  'turkish':            'TK',
  'turkish airlines':   'TK',
  'etihad':             'EY',
  'cathay':             'CX',
  'cathay pacific':     'CX',
  'virgin atlantic':    'VS',
  'indigo':             '6E',
  'air canada':         'AC',
  'swiss':              'LX',
  'finnair':            'AY',
  'iberia':             'IB',
  'ryan air':           'FR',
  'ryanair':            'FR',
  'easyjet':            'U2',
};

// ── Main extractor ───────────────────────────────────────────────────────────
function extractIntent(transcript) {
  const lower = transcript.toLowerCase();
  let airlineIATA = null;
  let airlineName = null;

  // 1. Check spoken aliases first (most reliable for ATC speech)
  for (const [spoken, iata] of Object.entries(SPOKEN_ALIASES)) {
    if (lower.includes(spoken)) {
      airlineIATA = iata;
      airlineName = spoken.replace(/\b\w/g, c => c.toUpperCase());
      break;
    }
  }

  // 2. Fall back to resolveAirlineIATA from the full CSV dataset
  if (!airlineIATA) {
    const words = lower.split(' ');
    for (let i = 0; i < words.length; i++) {
      const phrase2 = words.slice(i, i + 2).join(' ');
      const phrase3 = words.slice(i, i + 3).join(' ');
      airlineIATA = resolveAirlineIATA(phrase3) || resolveAirlineIATA(phrase2);
      if (airlineIATA) {
        airlineName = phrase3;
        break;
      }
    }
  }

  // 3. Extract IATA airport codes (3 uppercase letters)
  //    Filter out the airline IATA code itself if it appears
  const allCodes = [...transcript.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]);
  const airportCodes = allCodes.filter(c => c !== airlineIATA);
  const origin      = airportCodes[0] || null;
  const destination = airportCodes[1] || null;

  // 4. Extract date (basic — good enough for hackathon)
  const dateMatch = transcript.match(
    /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)|([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?)/
  );

  // 5. Extract time (handles "14:00", "14:00 UTC", "2pm", "2 PM")
  const timeMatch = transcript.match(
    /\d{1,2}:\d{2}\s?(?:UTC|AM|PM|Z)?|\d{1,2}\s?(?:AM|PM)/i
  );

  return {
    airlineIATA,
    airlineName,
    origin,
    destination,
    date:  dateMatch?.[0]  || 'today',
    time:  timeMatch?.[0]  || 'now',
    valid: !!(airlineIATA && origin && destination),
  };
}

module.exports = { extractIntent };