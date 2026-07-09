/**
 * indicators.js
 * -----------------------------------------------------------------------
 * Pure, stateless indicator math. Every function takes plain arrays in
 * and returns a number (or null if there isn't enough data yet) — no
 * dependency on state.js, so these are trivially testable in isolation.
 */

/** Exponential Moving Average of the most recent `period` values. */
export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** Wilder's RSI over `period` samples. */
export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta; else losses -= delta;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

/**
 * ATR-style volatility proxy. We don't have real OHLC bars from a tick
 * stream, so we approximate "true range" as the absolute tick-to-tick
 * move and take a Wilder-smoothed average of it — same decay behavior
 * as classic ATR, adapted for a price series rather than bars.
 */
export function atrProxy(values, period = 14) {
  if (values.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < values.length; i++) {
    trueRanges.push(Math.abs(values[i] - values[i - 1]));
  }
  const recent = trueRanges.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/** Session VWAP given parallel price/quantity arrays. */
export function vwap(prices, quantities) {
  if (prices.length === 0 || prices.length !== quantities.length) return null;
  let pv = 0, vol = 0;
  for (let i = 0; i < prices.length; i++) {
    pv += prices[i] * quantities[i];
    vol += quantities[i];
  }
  return vol === 0 ? null : pv / vol;
}

/** Rate-of-change momentum over `period` samples, as a percentage. */
export function momentum(values, period = 10) {
  if (values.length < period + 1) return null;
  const past = values[values.length - 1 - period];
  const now = values[values.length - 1];
  if (past === 0) return null;
  return ((now - past) / past) * 100;
}

/** Standard deviation of tick-to-tick log returns, as a percentage — realized volatility. */
export function realizedVolatility(values) {
  if (values.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] - values[i - 1]) / values[i - 1] * 100);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/** Runs every indicator against a tick list and returns a flat snapshot object. */
export function computeAll(ticks) {
  const prices = ticks.map(t => t.price);
  const quantities = ticks.map(t => t.qty ?? 0);
  return {
    ema9: ema(prices, 9),
    ema21: ema(prices, 21),
    rsi: rsi(prices, 14),
    atr: atrProxy(prices, 14),
    vwap: vwap(prices, quantities),
    momentum: momentum(prices, 10),
    volatility: realizedVolatility(prices)
  };
}
