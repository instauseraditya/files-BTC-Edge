# BTC Edge

A lightweight, dependency-light dashboard that compares a live Binance BTC/USDT
tick feed against Polymarket's own priced probability for the active
"Bitcoin Up or Down" market, and surfaces where the two disagree.

**This is not financial advice.** It's a lens for comparing two live signals,
not a prediction engine. See the in-app disclaimer.

## Running it

Because `app.js` is loaded as an ES module (`<script type="module">`),
opening `index.html` directly via `file://` will be blocked by the browser's
module CORS policy. Serve the folder instead:

```bash
cd btc-edge
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080`.

## Architecture

```
btc-edge/
├── index.html          Structure only — no inline logic
├── css/style.css        Dark trading-terminal theme, single token system
├── js/
│   ├── state.js          Shared store — the only thing other modules import
│   ├── indicators.js      Pure functions: EMA, RSI, ATR proxy, VWAP, momentum
│   ├── polymarket.js      Polls Polymarket's public Gamma API
│   ├── engine.js          Fair-value model, edge calc, confidence, recommendation
│   ├── chart.js           Chart.js wrapper (price + EMA overlays)
│   └── app.js             Binance WebSocket, render loop, wires everything up
└── assets/
```

### Why a shared `state.js`

Every module reads and writes through `state.js` instead of importing each
other directly (`polymarket.js` doesn't know `engine.js` exists, `chart.js`
doesn't know where ticks come from). `app.js` is the only module that pulls
from more than one source and decides what to compute next. That keeps each
piece independently testable and makes it straightforward to add a new data
source or indicator later without touching unrelated files.

Store shape (abbreviated):

```js
{
  connection: { binance, polymarket },
  settings:   { interval, capacity },
  market:     { price, prevPrice, ticks, ... },
  indicators: { ema9, ema21, rsi, atr, vwap, momentum, volatility },
  polymarket: { question, yesPrice, noPrice, volume24hr, endDate, ... },
  engine:     { fairValueProb, edge, confidence, recommendation, rationale }
}
```

### Data flow

1. `app.js` opens a Binance `aggTrade` WebSocket for `BTCUSDT` (falls back to
   REST polling on `/api/v3/ticker/price` if the socket drops).
2. Each accepted tick is pushed into `state.market.ticks`, then
   `indicators.js` recomputes EMA9/EMA21/RSI/ATR-proxy/VWAP/momentum/volatility
   over the rolling window.
3. `polymarket.js` polls the public Gamma API (`gamma-api.polymarket.com`,
   no key required) every 10s for the nearest live `btc-updown-*` market and
   extracts its implied "Yes" probability.
4. `engine.js` blends the indicators into a fair-value probability, compares
   it against Polymarket's price to get an **edge**, and scores **confidence**
   from sample depth, market liquidity, and time left on the window.
5. `app.js` renders all of it, including the edge meter — a gauge whose
   needle sweeps between "market looks too bearish" and "market looks too
   bullish" based on the current edge.

### Notes on the indicators

There's no real OHLC bar feed here — just a raw tick stream — so:
- **ATR** is approximated as a Wilder-smoothed average of tick-to-tick
  absolute price moves, rather than true high/low/close ranges.
- **VWAP** uses `aggTrade` quantities (`q`) as the volume weight; it resets
  each time you reload the page (session-scoped, not calendar-day).

### Extending it

- New indicator: add a pure function to `indicators.js`, include it in
  `computeAll()`, read it off `state.indicators` in `app.js`.
- New data source: add a module like `polymarket.js` that only calls
  `setState()` — never reach into another module directly.
- New market: swap the `btc-updown` slug filter in `polymarket.js` for
  whatever Gamma slug family you want to track.
# files-BTC-Edge
