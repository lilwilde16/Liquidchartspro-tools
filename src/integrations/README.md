# src/integrations/

Data connectors and API wrappers that interface with LiquidChartsPro and the
broker's trading infrastructure. These files use **real live data only** — there
is no simulation mode.

## Files

| File | Global exposed | Description |
|------|---------------|-------------|
| `lc-framework.js` | `window.LC` | Core LiquidChartsPro framework wrapper. Provides `window.LC.requestCandles`, `window.LC.api.market`, `window.LC.log`, and more |
| `trading-api.js` | `window.LC.tradingAPI` | High-level order placement: `buyEntry`, `sellEntry`, `closeAll`, `closeOne` |

## Credentials / secrets

**Never put API keys or passwords in source code.**

The LiquidChartsPro widget injects credentials automatically when the tool is
opened inside a chart window. The `Sway.Framework()` object provides authenticated
access to market data and order execution without any extra configuration.

If you need to test locally outside a chart, you can add placeholder environment
variables and mock the `Sway.Framework` call:

```javascript
// In a local test stub (NOT in the committed files):
window.Sway = {
  Framework: function() {
    return { OnLoad: null, pRequestCandles: null, SendOrder: null };
  }
};
```

## Key API surface

```javascript
// Request candles (real-time, via LiquidChartsPro)
const candles = await window.LC.requestCandles("EUR/USD", "M15", 500);

// Place a buy order with TP/SL
const result = await window.LC.tradingAPI.buyEntry("EUR/USD", 0.01, 1.09500, 1.08800);

// Close all open positions
await window.LC.tradingAPI.closeAll();
```
