/**
 * app.js
 * -----------------------------------------------------------------------
 * Entry point. Owns the Binance WebSocket connection and the render loop.
 * Talks to engine.js / indicators.js / polymarket.js / chart.js only
 * through state.js — no direct module-to-module calls.
 */

import { getState, setState, subscribe } from './state.js';
import { computeAll } from './indicators.js';
import { computeFairValue, computeConfidence, evaluateOpportunity } from './engine.js';
import { startPolymarketFeed } from './polymarket.js';
import { initChart, updateChart } from './chart.js';

const TIME_INTERVALS = [1, 3, 5, 10, 30, 60];
let ws = null;
let restFallbackTimer = null;
let lastProcessedAt = 0;

// ---------------------------------------------------------------------
// Binance live feed (WebSocket, REST-polling fallback if it drops)
// ---------------------------------------------------------------------

function connectBinance() {
  teardownBinance();
  setState({ connection: { binance: 'connecting' } });

  ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');

  ws.onopen = () => setState({ connection: { binance: 'live' } });

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    const price = parseFloat(msg.p);
    const qty = parseFloat(msg.q);
    const now = Date.now();

    const throttleMs = getState().settings.interval * 1000;
    if (now - lastProcessedAt < throttleMs) return;
    lastProcessedAt = now;

    ingestTick(price, qty);
  };

  ws.onerror = () => activateRestFallback();
  ws.onclose = () => {
    if (getState().market.ticks.length === 0) activateRestFallback();
  };
}

function teardownBinance() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  if (restFallbackTimer) { clearInterval(restFallbackTimer); restFallbackTimer = null; }
}

async function pollRestOnce() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (!res.ok) throw new Error('REST fault');
    const data = await res.json();
    ingestTick(parseFloat(data.price), 0);
  } catch (err) {
    console.error('[app] REST fallback failed:', err);
  }
}

function activateRestFallback() {
  setState({ connection: { binance: 'fallback' } });
  pollRestOnce();
  restFallbackTimer = setInterval(pollRestOnce, getState().settings.interval * 1000);
}

/** Appends a tick, recomputes indicators + engine, and pushes a state update. */
function ingestTick(price, qty) {
  const { market, settings } = getState();
  const ticks = [...market.ticks, { t: new Date(), price, qty }];
  if (ticks.length > settings.capacity) ticks.shift();

  const indicators = computeAll(ticks);
  const fairValueProb = computeFairValue(indicators);

  const pm = getState().polymarket;
  const confidence = computeConfidence({
    tickCount: ticks.length,
    liquidity: pm.liquidity,
    endDate: pm.endDate
  });
  const { edge, recommendation, rationale } = evaluateOpportunity({
    fairValueProb,
    marketYesProb: pm.yesPrice,
    confidence
  });

  setState({
    market: {
      price,
      prevPrice: market.price,
      sessionOpen: market.sessionOpen ?? price,
      ticks,
      lastUpdate: new Date()
    },
    indicators,
    engine: { fairValueProb, edge, confidence, recommendation, rationale }
  });
}

// ---------------------------------------------------------------------
// Interval selector
// ---------------------------------------------------------------------

function buildIntervalRow() {
  const row = document.getElementById('intervalRow');
  TIME_INTERVALS.forEach(sec => {
    const btn = document.createElement('button');
    btn.className = 'ibtn' + (sec === getState().settings.interval ? ' active' : '');
    btn.textContent = sec + 's';
    btn.dataset.sec = sec;
    btn.onclick = () => {
      setState({ settings: { interval: sec } });
      document.querySelectorAll('.ibtn').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.sec, 10) === sec)
      );
    };
    row.appendChild(btn);
  });
}

// ---------------------------------------------------------------------
// Rendering — pure DOM writes driven entirely by state snapshots
// ---------------------------------------------------------------------

const fmt = (v, digits = 2) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(digits));
const fmtUSD = v => (v == null ? '—' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtPct = v => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%');

function connectionDot(id, status) {
  const el = document.getElementById(id);
  el.className = 'dot ' + (status === 'live' ? 'dot-live' : status === 'connecting' ? 'dot-connecting' : 'dot-error');
}

function render(state) {
  // --- connection status ---
  connectionDot('binanceDot', state.connection.binance);
  connectionDot('polyDot', state.connection.polymarket);
  document.getElementById('feedType').textContent =
    state.connection.binance === 'live' ? 'WS STREAMING' :
    state.connection.binance === 'fallback' ? 'REST FALLBACK' : 'CONNECTING';

  // --- hero price ---
  const priceEl = document.getElementById('price');
  const { price, prevPrice, sessionOpen } = state.market;
  if (price != null) {
    priceEl.textContent = fmtUSD(price);
    const up = prevPrice == null || price >= prevPrice;
    priceEl.style.color = up ? 'var(--green)' : 'var(--red)';
    document.getElementById('priceDirection').textContent = up ? '▲ UP TICK' : '▼ DOWN TICK';
    document.getElementById('priceDirection').style.color = up ? 'var(--green)' : 'var(--red)';
  }

  if (price != null && sessionOpen) {
    const sessionPct = ((price - sessionOpen) / sessionOpen) * 100;
    const sessEl = document.getElementById('chgSession');
    sessEl.textContent = fmtPct(sessionPct);
    sessEl.style.color = sessionPct >= 0 ? 'var(--green)' : 'var(--red)';
  }

  document.getElementById('tickCount').textContent = state.market.ticks.length;

  // --- indicator cards ---
  const ind = state.indicators;
  document.getElementById('rsi').textContent = fmt(ind.rsi, 1);
  document.getElementById('ema9').textContent = ind.ema9 != null ? fmtUSD(ind.ema9) : '—';
  document.getElementById('ema21').textContent = ind.ema21 != null ? fmtUSD(ind.ema21) : '—';
  document.getElementById('atr').textContent = ind.atr != null ? fmtUSD(ind.atr) : '—';
  document.getElementById('vwap').textContent = ind.vwap != null ? fmtUSD(ind.vwap) : '—';
  document.getElementById('momentum').textContent = fmtPct(ind.momentum);
  document.getElementById('vol').textContent = fmt(ind.volatility, 4) + '%';

  // --- polymarket panel ---
  const pm = state.polymarket;
  document.getElementById('pmQuestion').textContent = pm.question ?? 'Searching for an active BTC market…';
  document.getElementById('pmYes').textContent = pm.yesPrice != null ? (pm.yesPrice * 100).toFixed(1) + '%' : '—';
  document.getElementById('pmNo').textContent = pm.noPrice != null ? (pm.noPrice * 100).toFixed(1) + '%' : '—';
  document.getElementById('pmVolume').textContent = pm.volume24hr != null ? '$' + Number(pm.volume24hr).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—';
  document.getElementById('pmEnd').textContent = pm.endDate ? new Date(pm.endDate).toLocaleString() : '—';

  // --- engine / edge meter ---
  renderEdgeMeter(state.engine);

  document.getElementById('recNote').textContent = state.engine.rationale || 'Gathering both feeds…';
  document.getElementById('confidenceVal').textContent = state.engine.confidence != null ? state.engine.confidence + '%' : '—';
  document.getElementById('confidenceFill').style.width = (state.engine.confidence ?? 0) + '%';

  document.getElementById('timestamp').textContent = new Date().toLocaleTimeString([], { hour12: false });

  // --- chart ---
  if (state.market.ticks.length > 1) updateChart(state.market.ticks, ind);
}

/**
 * The signature element: a radial gauge needle showing model edge vs.
 * Polymarket's price, swept between BUY_NO (left) and BUY_YES (right).
 */
function renderEdgeMeter(engine) {
  const needle = document.getElementById('edgeNeedle');
  const label = document.getElementById('edgeLabel');
  const recBadge = document.getElementById('recBadge');

  // edge is roughly bounded in [-0.5, 0.5] in practice; clamp + map to [-90, 90] deg
  const edge = engine.edge ?? 0;
  const clamped = Math.max(-0.25, Math.min(0.25, edge));
  const angle = (clamped / 0.25) * 80; // degrees

  needle.setAttribute('transform', `rotate(${angle} 110 110)`);
  label.textContent = engine.edge != null ? (engine.edge >= 0 ? '+' : '') + (engine.edge * 100).toFixed(1) + '% edge' : 'no edge yet';

  recBadge.textContent = engine.recommendation.replace('_', ' ');
  recBadge.className = 'rec-badge ' +
    (engine.recommendation === 'BUY_YES' ? 'rec-buy' :
     engine.recommendation === 'BUY_NO' ? 'rec-sell' : 'rec-hold');
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  buildIntervalRow();
  initChart('chart');
  subscribe(render);
  connectBinance();
  startPolymarketFeed(10000);
  render(getState());
});
