/**
 * polymarket.js
 * -----------------------------------------------------------------------
 * Talks to Polymarket's public Gamma API (read-only, no key required:
 * https://docs.polymarket.com/developers/gamma-markets-api/overview).
 *
 * We look for the live short-duration "Bitcoin Up or Down" market
 * (slug family `btc-updown-*`), which prices the probability that BTC
 * is higher at the window's close — the most direct point of comparison
 * against our own live fair-value model.
 */

import { setState } from './state.js';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';
let pollTimer = null;

/**
 * Finds the currently active Bitcoin up/down market by scanning active,
 * high-volume markets and filtering for the btc-updown slug family.
 * Falls back to any open market whose question mentions Bitcoin.
 */
async function findBTCMarket() {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=100&order=volume24hr&ascending=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gamma API responded ${res.status}`);
  const markets = await res.json();

  const updown = markets.filter(m => typeof m.slug === 'string' && m.slug.startsWith('btc-updown'));
  if (updown.length > 0) {
    // Prefer the soonest-resolving window — that's the one actively trading.
    updown.sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
    return updown[0];
  }

  const mentions = markets.find(m =>
    typeof m.question === 'string' && m.question.toLowerCase().includes('bitcoin')
  );
  return mentions ?? null;
}

function parseOutcomePrices(market) {
  try {
    const outcomes = JSON.parse(market.outcomes);
    const prices = JSON.parse(market.outcomePrices);
    const yesIdx = outcomes.findIndex(o => /yes|up/i.test(o));
    const noIdx = outcomes.findIndex(o => /no|down/i.test(o));
    return {
      yesPrice: yesIdx >= 0 ? parseFloat(prices[yesIdx]) : parseFloat(prices[0]),
      noPrice: noIdx >= 0 ? parseFloat(prices[noIdx]) : parseFloat(prices[1])
    };
  } catch {
    return { yesPrice: null, noPrice: null };
  }
}

async function pollOnce() {
  try {
    const market = await findBTCMarket();
    if (!market) {
      setState({ connection: { polymarket: 'unavailable' } });
      return;
    }
    const { yesPrice, noPrice } = parseOutcomePrices(market);
    setState({
      connection: { polymarket: 'live' },
      polymarket: {
        question: market.question ?? null,
        slug: market.slug ?? null,
        yesPrice,
        noPrice,
        endDate: market.endDate ?? null,
        volume24hr: market.volume24hr ?? null,
        liquidity: market.liquidity ?? null,
        lastUpdate: new Date()
      }
    });
  } catch (err) {
    console.error('[polymarket] fetch failed:', err);
    setState({ connection: { polymarket: 'error' } });
  }
}

/** Starts polling the Gamma API on an interval (default 10s — Gamma is not a tick feed). */
export function startPolymarketFeed(intervalMs = 10000) {
  stopPolymarketFeed();
  pollOnce();
  pollTimer = setInterval(pollOnce, intervalMs);
}

export function stopPolymarketFeed() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
