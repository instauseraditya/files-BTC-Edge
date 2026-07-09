/**
 * state.js
 * -----------------------------------------------------------------------
 * Single shared state store. Every module reads/writes through here
 * instead of importing each other directly — that's what keeps engine.js,
 * polymarket.js, chart.js etc. decoupled and independently testable.
 *
 * Pattern: plain object + pub/sub. No framework needed for this scale.
 */

const state = {
  connection: {
    binance: 'connecting',   // 'connecting' | 'live' | 'fallback' | 'error'
    polymarket: 'connecting' // 'connecting' | 'live' | 'error' | 'unavailable'
  },

  settings: {
    interval: 5,      // seconds between processed ticks
    capacity: 180      // max ticks retained for rolling calculations
  },

  market: {
    symbol: 'BTCUSDT',
    price: null,
    prevPrice: null,
    sessionOpen: null,
    ticks: [],          // { t: Date, price, qty }
    lastUpdate: null
  },

  indicators: {
    ema9: null,
    ema21: null,
    rsi: null,
    atr: null,
    vwap: null,
    momentum: null,
    volatility: null
  },

  polymarket: {
    question: null,
    slug: null,
    yesPrice: null,     // implied probability of "Up", 0-1
    noPrice: null,
    endDate: null,
    volume24hr: null,
    liquidity: null,
    lastUpdate: null
  },

  engine: {
    fairValueProb: null,   // model's estimated probability of "Up"
    edge: null,            // fairValueProb - yesPrice
    confidence: null,      // 0-100
    recommendation: 'HOLD',// 'BUY_YES' | 'BUY_NO' | 'HOLD'
    rationale: ''
  }
};

const listeners = new Set();

function deepMerge(target, patch) {
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      target[key] = deepMerge(target[key] || {}, val);
    } else {
      target[key] = val;
    }
  }
  return target;
}

/** Returns the live state object (read-only by convention — use setState to mutate). */
export function getState() {
  return state;
}

/** Shallow-patches nested slices of state and notifies subscribers. */
export function setState(patch) {
  deepMerge(state, patch);
  notify();
}

/** Subscribe to any state change. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}
