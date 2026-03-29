// dashboard.js
// Handles: ElevenLabs voice agent, Leaflet map, WebSocket updates, Text chatbot, Form

const AGENT_ID = 'agent_4901kmvz0w0re78t8q6gwccz1cc0';

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toUTCString().slice(17, 25) + ' UTC';
}
setInterval(updateClock, 1000);
updateClock();

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  const names = ['form', 'transcript', 'chat'];
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-pane').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${name}`);
  });
}

// ── Leaflet Map ───────────────────────────────────────────────────────────────
const map = L.map('map', { zoomControl: false, attributionControl: false })
  .setView([30, 0], 2);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

let routeLayer   = null;
let markerLayer  = L.layerGroup().addTo(map);
let trafficLayer = L.layerGroup().addTo(map);

function drawRoute(routeCoords) {
  if (routeLayer) map.removeLayer(routeLayer);
  markerLayer.clearLayers();
  if (!routeCoords || routeCoords.length < 2) return;

  const latlngs = routeCoords.map(a => [a.lat, a.lon]);

  routeLayer = L.polyline(latlngs, {
    color: '#00e676',
    weight: 2.5,
    opacity: 0.9,
    dashArray: '7 5',
  }).addTo(map);

  routeCoords.forEach((airport, i) => {
    const isOrigin = i === 0;
    const isDest   = i === routeCoords.length - 1;
    const color    = isOrigin ? '#00e676' : isDest ? '#ffa726' : '#29b6f6';
    const size     = (isOrigin || isDest) ? 10 : 7;

    const marker = L.circleMarker([airport.lat, airport.lon], {
      radius: size, color, fillColor: color, fillOpacity: 0.9, weight: 2,
    }).addTo(markerLayer);

    marker.bindTooltip(
      `<b>${airport.code}</b><br>${airport.city || ''}`,
      { className: 'atc-tooltip', permanent: false }
    );
  });

  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
}

function drawTraffic(flights) {
  trafficLayer.clearLayers();
  if (!flights || !flights.length) return;

  flights.forEach(f => {
    if (!f.lat || !f.lon) return;
    L.circleMarker([f.lat, f.lon], {
      radius: 3, color: '#29b6f6', fillColor: '#29b6f6', fillOpacity: 0.5, weight: 1,
    }).addTo(trafficLayer)
      .bindTooltip(`${f.callsign}<br>${f.altitudeFt}ft`, { className: 'atc-tooltip' });
  });

  document.getElementById('traffic-count').textContent = flights.length.toLocaleString();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const ws = new WebSocket(`ws://${location.host}`);
ws.onopen  = () => setDot('dot-ws', 'blue');
ws.onclose = () => setDot('dot-ws', '');

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'route_result') handleRouteResult(msg);
  } catch (e) { console.error('WS parse error', e); }
};

// ── Shared route result handler ───────────────────────────────────────────────
function handleRouteResult(msg) {
  const { result, wind, traffic, routeCoords, intent, news, explanation } = msg;

  if (result.found) {
    const airline = intent.airline || intent.airlineIATA || '';

    // Airport codes
    document.getElementById('code-origin').textContent = intent.origin || '—';
    document.getElementById('code-dest').textContent   = intent.destination || '—';
    document.getElementById('flight-label').textContent =
      airline ? `${airline} · ${intent.origin} → ${intent.destination}` : `${intent.origin} → ${intent.destination}`;

    // Waypoints (intermediate stops)
    const wpRow = document.getElementById('wp-row');
    wpRow.innerHTML = '';
    if (result.waypoints && result.waypoints.length) {
      result.waypoints.forEach(wp => {
        const el = document.createElement('span');
        el.className = 'wp';
        el.textContent = wp;
        wpRow.appendChild(el);
      });
    }

    // Stats
    document.getElementById('distance').innerHTML =
      `${result.distanceKm?.toLocaleString()} <span class="unit">km</span>`;
    document.getElementById('flight-time').innerHTML =
      `${result.flightTimeH} <span class="unit">hrs</span>`;
    document.getElementById('co2').innerHTML =
      `${result.co2t} <span class="unit">tonnes CO₂</span>`;

    const pct = result.fuelSavingPct || 0;
    document.getElementById('fuel-pct').textContent = `${pct}%`;
    document.getElementById('fuel-bar').style.width = `${Math.min(pct * 5, 100)}%`;

    drawRoute(routeCoords);
    const cwLabel = document.getElementById('cw-route-label');
    if (cwLabel) cwLabel.textContent = `${intent.origin} → ${intent.destination}`;
  }

  // AI Explanation
  if (explanation) {
    const el = document.getElementById('explanation-panel');
    if (el) el.textContent = explanation;
  }

  // Geopolitical risk
  if (news) {
    const badge = document.getElementById('risk-badge');
    if (badge) {
      badge.style.display = 'flex';
      if (news.isDangerous) {
        badge.className = 'alert danger';
        badge.textContent = '⚠  Geopolitical risk detected along this route';
      } else {
        badge.className = 'alert safe';
        badge.textContent = '✓  Airspace is clear — no active risks';
      }
    }
    updateNewsPanel(news.articles, news.isDangerous);
  }

  updateWeatherPanel(wind, traffic);

  if (traffic?.length) {
    const allFlights = traffic.flatMap(t => t.sample || []);
    drawTraffic(allFlights);
  }
}

function updateWeatherPanel(wind, traffic) {
  const body = document.getElementById('center-weather-body');
  if (!body) return;
  let html = '';

  if (wind) {
    html += `
      <div class="wcard">
        <div class="wcard-lbl">Origin Weather</div>
        <div class="wcard-val">${wind.flightCategory || 'VFR'} · ${wind.windSpeedKt || 0} kt</div>
        <div class="wcard-sub">${wind.description || ''}</div>
        ${wind.weatherAlert ? `<div style="color:var(--danger);font-size:11px;margin-top:6px;">⚠ ${wind.weatherAlert}</div>` : ''}
      </div>`;
  }

  if (traffic?.length) {
    traffic.forEach(leg => {
      html += `
        <div class="wcard">
          <div class="wcard-lbl">Traffic · ${leg.leg}</div>
          <div class="wcard-val"><span class="dpill ${leg.density}">${leg.density?.toUpperCase()}</span></div>
        </div>`;
    });
  }

  body.innerHTML = html || '<div class="ph">No weather data available.</div>';
}

function updateNewsPanel(articles, isDangerous) {
  if (!articles?.length) return;
  const body = document.getElementById('center-weather-body');
  if (!body) return;

  articles.slice(0, 3).forEach(a => {
    const color = a.isDangerous ? 'var(--danger)' : 'var(--text3)';
    body.innerHTML += `
      <div class="wcard">
        <div class="wcard-lbl" style="color:${color}">${a.source}</div>
        <div class="wcard-sub">${a.title}</div>
      </div>`;
  });
}

// ── ElevenLabs Voice Agent ─────────────────────────────────────────────────────
let conversation = null;

async function toggleVoice() {
  if (conversation) { await stopVoice(); } else { await startVoice(); }
}

async function startVoice() {
  const btn    = document.getElementById('voice-btn');
  const label  = document.getElementById('voice-label');
  const status = document.getElementById('voice-status');

  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    btn.className = 'voice-btn connecting';
    label.textContent = 'Connecting...';
    setDot('dot-agent', 'yellow');

    const res = await fetch('/api/signed-url');
    const { signedUrl } = await res.json();

    conversation = await ElevenLabsClient.Conversation.startSession({
      signedUrl,
      onConnect: () => {
        btn.className      = 'voice-btn connected';
        label.textContent  = 'Click to disconnect';
        status.textContent = 'Listening...';
        const tag = document.getElementById('mode-tag');
        tag.textContent = 'ACTIVE';
        tag.classList.add('live');
        setDot('dot-agent', 'green');
        switchTab('transcript');
      },
      onDisconnect: () => { resetVoiceUI(); },
      onMessage: (message) => { appendTranscript(message.message, message.source); },
      onModeChange: (mode) => {
        if (mode.mode === 'speaking') {
          btn.className = 'voice-btn speaking';
          status.textContent = 'Agent speaking...';
        } else {
          btn.className = 'voice-btn connected';
          status.textContent = 'Listening...';
        }
      },
      onError: (err) => {
        console.error('ElevenLabs error:', err);
        status.textContent = 'Connection error';
        resetVoiceUI();
      },
    });

  } catch (err) {
    console.error('Voice start error:', err);
    status.textContent = err.message.includes('Permission')
      ? 'Microphone access denied'
      : 'Failed to connect';
    resetVoiceUI();
  }
}

async function stopVoice() {
  if (conversation) { await conversation.endSession(); conversation = null; }
  resetVoiceUI();
}

function resetVoiceUI() {
  document.getElementById('voice-btn').className      = 'voice-btn';
  document.getElementById('voice-label').textContent  = 'Click to connect';
  document.getElementById('voice-status').textContent = 'Waiting for input...';
  const tag = document.getElementById('mode-tag');
  tag.textContent = 'STANDBY';
  tag.classList.remove('live');
  setDot('dot-agent', '');
}

// ── Transcript log ────────────────────────────────────────────────────────────
function appendTranscript(text, source) {
  if (!text?.trim()) return;
  const body = document.getElementById('transcript-body');
  const ph = body.querySelector('.ph');
  if (ph) ph.remove();

  const isAgent = source === 'ai';
  const div = document.createElement('div');
  div.className = 't-msg';
  div.innerHTML = `
    <div class="t-role ${isAgent ? 'a' : 'u'}">${isAgent ? 'ATC Optimizer' : 'Controller'}</div>
    <div class="t-bubble ${isAgent ? 'a' : 'u'}">${text}</div>
  `;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

// ── Text Chatbot ──────────────────────────────────────────────────────────────
let chatBusy = false;

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 88) + 'px';
}

function useHint(chip) {
  const input = document.getElementById('chat-input');
  input.value = chip.textContent;
  autoResize(input);
  input.focus();
}

async function sendChat() {
  if (chatBusy) return;
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  autoResize(input);

  const hints = document.getElementById('chat-hints');
  if (hints) hints.style.display = 'none';

  appendChatMsg(text, 'user');
  const thinking = appendChatMsg('Computing optimal route...', 'bot', true);

  chatBusy = true;
  document.getElementById('chat-send').disabled = true;

  try {
    const res  = await fetch('/api/route/transcript', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ transcript: text, walletAddress: connectedWallet }),
    });

    const data = await res.json();
    thinking.remove();

    if (data.data?.found) {
      const r = data.data;
      let reply = `Route found: ${r.route.join(' → ')}\n` +
                  `Distance: ${r.distanceKm?.toLocaleString()} km\n` +
                  `Flight time: ${r.flightTimeH} hrs\n` +
                  `CO₂: ${r.co2t} tonnes\n` +
                  `Fuel saving: ${r.fuelSavingPct || 0}% vs standard`;

      appendChatMsg(reply, 'bot');

      if (data.explanation) appendChatMsg(`AI Analysis: ${data.explanation}`, 'bot');
      if (data.news?.isDangerous) appendChatMsg('⚠ Geopolitical risk detected along this route. Exercise caution.', 'bot');

      handleRouteResult({
        result:      data.data,
        wind:        data.wind,
        traffic:     data.traffic,
        routeCoords: data.routeCoords,
        intent:      data.intent,
        news:        data.news,
        explanation: data.explanation,
      });

      startCorridorRefresh(data.routeCoords);
      if (typeof fetchCreditBalance === 'function') fetchCreditBalance();

    } else {
      appendChatMsg(
        data.response || 'No route found. Try specifying airline IATA code (e.g. BA), origin and destination codes.',
        'bot'
      );
    }

  } catch (err) {
    if (thinking.isConnected) thinking.remove();
    appendChatMsg('Connection error. Is the server running?', 'bot');
    console.error('Chat error:', err);
  }

  chatBusy = false;
  document.getElementById('chat-send').disabled = false;
  input.focus();
}

function appendChatMsg(text, role, isThinking = false) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `cmsg ${role}${isThinking ? ' thinking' : ''}`;

  if (role === 'bot' && !isThinking) {
    div.innerHTML = `<div class="crole">ATC Optimizer</div>${text.replace(/\n/g, '<br>')}`;
  } else {
    div.textContent = text;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

// ── Form submission ───────────────────────────────────────────────────────────
async function submitForm() {
  const airline     = document.getElementById('f-airline').value.trim().toUpperCase();
  const origin      = document.getElementById('f-origin').value.trim().toUpperCase();
  const destination = document.getElementById('f-destination').value.trim().toUpperCase();
  const date        = document.getElementById('f-date').value;
  const time        = document.getElementById('f-time').value;
  const status      = document.getElementById('form-status');
  const btn         = document.getElementById('form-submit-btn');

  if (!airline || !origin || !destination) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Airline, origin and destination are required.';
    return;
  }

  status.style.color = 'var(--text3)';
  status.textContent = 'Computing...';
  btn.disabled = true;

  try {
    const res  = await fetch('/api/route', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ airline, origin, destination, date, time, walletAddress: connectedWallet}),
    });

    const data = await res.json();

    if (data.data?.found) {
      status.style.color = 'var(--accent)';
      status.textContent = `✓  ${data.data.route.join(' → ')}`;

      handleRouteResult({
        result:      data.data,
        wind:        data.wind,
        traffic:     data.traffic,
        routeCoords: data.routeCoords,
        intent:      { airline, origin, destination, date, time },
        news:        data.news,
        explanation: data.explanation,
      });

      startCorridorRefresh(data.routeCoords);

    } else {
      status.style.color = 'var(--danger)';
      status.textContent = data.response || 'No route found for this pair.';
    }

  } catch (err) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Server error. Is the backend running?';
    console.error('Form submit error:', err);
  }

  btn.disabled = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setDot(id, color) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.className = 'dot' + (color ? ` ${color}` : '');
}

// ── Traffic loading ───────────────────────────────────────────────────────────
const GLOBAL_REGIONS = [
  { minLat: 30,  maxLat: 65,  minLon: -80,  maxLon: -10 },
  { minLat: 35,  maxLat: 70,  minLon: -10,  maxLon: 40  },
  { minLat: 25,  maxLat: 55,  minLon: -130, maxLon: -60 },
  { minLat: 10,  maxLat: 45,  minLon: 40,   maxLon: 100 },
  { minLat: -10, maxLat: 40,  minLon: 100,  maxLon: 145 },
  { minLat: -55, maxLat: 15,  minLon: -85,  maxLon: -30 },
  { minLat: -35, maxLat: 35,  minLon: -20,  maxLon: 55  },
  { minLat: -50, maxLat: -10, minLon: 110,  maxLon: 180 },
];

let routeCorridorInterval = null;

async function loadGlobalTraffic() {
  document.getElementById('traffic-count').textContent = '...';

  const results = await Promise.allSettled(
    GLOBAL_REGIONS.map(r =>
      fetch(`/api/traffic?minLat=${r.minLat}&maxLat=${r.maxLat}&minLon=${r.minLon}&maxLon=${r.maxLon}`)
        .then(res => res.json())
    )
  );

  const allFlights = [];
  let totalCount = 0;

  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value.flights) {
      totalCount += result.value.count || 0;
      allFlights.push(...result.value.flights);
    }
  });

  const seen = new Set();
  const unique = allFlights.filter(f => {
    if (!f.icao24 || seen.has(f.icao24)) return false;
    seen.add(f.icao24);
    return true;
  });

  drawTraffic(unique);
  document.getElementById('traffic-count').textContent = totalCount.toLocaleString();
}

function startCorridorRefresh(routeCoords) {
  if (routeCorridorInterval) { clearInterval(routeCorridorInterval); routeCorridorInterval = null; }
  if (!routeCoords || routeCoords.length < 2) return;

  const lats = routeCoords.map(a => a.lat).filter(Boolean);
  const lons = routeCoords.map(a => a.lon).filter(Boolean);

  const minLat = Math.min(...lats) - 5;
  const maxLat = Math.max(...lats) + 5;
  const minLon = Math.min(...lons) - 5;
  const maxLon = Math.max(...lons) + 5;

  async function refreshCorridor() {
    try {
      const res  = await fetch(`/api/traffic?minLat=${minLat}&maxLat=${maxLat}&minLon=${minLon}&maxLon=${maxLon}`);
      const data = await res.json();
      if (data.flights) {
        drawTraffic(data.flights);
        document.getElementById('traffic-count').textContent = data.count?.toLocaleString() || '0';
      }
    } catch (e) { console.warn('Corridor refresh failed:', e.message); }
  }

  refreshCorridor();
  routeCorridorInterval = setInterval(refreshCorridor, 30000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadGlobalTraffic();