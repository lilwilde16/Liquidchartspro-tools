# src/tests/

Jest unit tests for the verified pure utility functions in `src/functions/`.

## Running the tests

```bash
# One-off run with coverage report
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

## Test files

| File | What it tests |
|------|--------------|
| `candle-utils.test.js` | `candleTimeMs`, `normalizeCandles` (all four input formats) |
| `util-indicators.test.js` | `sma`, `atr`, `rsi`, `linregSlope`, `toChron` |
| `util-format.test.js` | `num`, `pct`, `money` |
| `util-backtest.test.js` | `winRate`, `expectancy`, `profitFactor`, `maxDrawdown`, `pipSize`, `priceToPips`, `pipsToPrice`, `calculateLotSize`, `formatDuration`, `calculateTradeStats` |

## Why only utility functions are tested here

The engine files (`engine-autotrader.js`, `engine-backtest.js`, etc.) depend on
the live `window.LC` / `Sway.Framework` APIs provided by LiquidChartsPro. Testing
them requires the full chart widget environment, so they are validated manually
inside a LiquidChartsPro window rather than with automated Jest tests.

## Adding a new test

1. Create `src/tests/<your-module>.test.js`.
2. `require()` the function module from `../functions/<file>`.
3. Write `describe` / `test` blocks.
4. Run `npm test` to confirm all tests pass.
