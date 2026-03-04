# src/functions/

Reusable, pure utility functions shared across the rest of the codebase.
All files in this folder expose their API via the global `window.*` namespace in
the browser and also export via `module.exports` so they can be unit-tested with
Jest in Node.js.

## Files

| File | Global exposed | Description |
|------|---------------|-------------|
| `candle-utils.js` | `window.CandleUtils` | Candle normalisation helpers (`normalizeCandles`, `candleTimeMs`) |
| `util-indicators.js` | `window.UTIL` | Technical indicators: `sma`, `atr`, `rsi`, `linregSlope` |
| `util-format.js` | `window.FMT` | Number/currency formatting: `num`, `pct`, `money` |
| `util-backtest.js` | `window.UTIL.BT` | Backtest statistics: `winRate`, `expectancy`, `profitFactor`, `maxDrawdown`, etc. |
| `util-export.js` | `window.UTIL.Export` | CSV/JSON export helpers for backtest results |

## Testing

```bash
npm test
```

All functions in this folder are covered by unit tests in `src/tests/`.
