/**
 * engine.js
 * -----------------------------------------------------------------------
 * Turns technical indicators + the live Polymarket implied probability
 * into: a model fair-value probability, an edge (model vs market),
 * a confidence score, and a plain-language recommendation.
 *
 * This is a heuristic signal blender, not a pricing model with any
 * predictive guarantee — see the in-app disclaimer. It exists to make
 * disagreements between technical momentum and market-implied odds
 * legible, not to promise an edge actually exists.
 */

const EDGE_THRESHOLD = 0.04;     // minimum |edge| before we suggest a side
const MIN_TICKS_FOR_CONFIDENCE = 30;

/** Squashes an unbounded score into a 0-1 probability. */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Blends momentum, RSI deviation from neutral, and EMA cross into a
 * single "probability BTC is higher at next resolution" estimate.
 * Each input is normalized before blending so no single indicator
 * dominates just because of its native scale.
 */
export function computeFairValue(indicators) {
  const { ema9, ema21, rsi, momentum, volatility } = indicators;
  if (ema9 == null || ema21 == null || rsi == null || momentum == null) return null;

  const emaSignal = (ema9 - ema21) / ema21 * 100;          // % gap, scaled
  const rsiSignal = (rsi - 50) / 25;                        // ~[-2, 2]
  const momentumSignal = momentum / (volatility > 0 ? volatility : 1); // vol-normalized

  const score = emaSignal * 0.8 + rsiSignal * 0.6 + momentumSignal * 0.9;
  return sigmoid(score);
}

/**
 * Confidence blends: sample depth (enough ticks to trust the indicators),
 * Polymarket liquidity (thin books are noisy), and how far the resolution
 * window still has left to run (too close to expiry = stale edge).
 */
export function computeConfidence({ tickCount, liquidity, endDate }) {
  let score = 0;

  const depthScore = Math.min(tickCount / MIN_TICKS_FOR_CONFIDENCE, 1) * 40;
  score += depthScore;

  const liquidityScore = liquidity != null
    ? Math.min(Number(liquidity) / 5000, 1) * 35
    : 10; // unknown liquidity — assume thin, don't zero it out
  score += liquidityScore;

  let timeScore = 15; // neutral default if we don't know the window
  if (endDate) {
    const msLeft = new Date(endDate).getTime() - Date.now();
    const minutesLeft = msLeft / 60000;
    // Sweet spot: not expired, not so far out the market hasn't converged.
    if (minutesLeft > 1 && minutesLeft < 240) timeScore = 25;
    else if (minutesLeft <= 1) timeScore = 5;
  }
  score += timeScore;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Combines fair value + market price into an edge and a recommendation. */
export function evaluateOpportunity({ fairValueProb, marketYesProb, confidence }) {
  if (fairValueProb == null || marketYesProb == null) {
    return { edge: null, recommendation: 'HOLD', rationale: 'Waiting for both feeds to warm up.' };
  }

  const edge = fairValueProb - marketYesProb;
  const strong = Math.abs(edge) >= EDGE_THRESHOLD && confidence >= 50;

  let recommendation = 'HOLD';
  let rationale;

  if (strong && edge > 0) {
    recommendation = 'BUY_YES';
    rationale = `Model estimates a ${(fairValueProb * 100).toFixed(1)}% chance of "Up" vs Polymarket's ${(marketYesProb * 100).toFixed(1)}% — technicals are more bullish than the market is pricing.`;
  } else if (strong && edge < 0) {
    recommendation = 'BUY_NO';
    rationale = `Model estimates only a ${(fairValueProb * 100).toFixed(1)}% chance of "Up" vs Polymarket's ${(marketYesProb * 100).toFixed(1)}% — technicals are more bearish than the market is pricing.`;
  } else {
    rationale = `Model (${(fairValueProb * 100).toFixed(1)}%) and market (${(marketYesProb * 100).toFixed(1)}%) are roughly aligned — no meaningful edge right now.`;
  }

  return { edge, recommendation, rationale };
}
