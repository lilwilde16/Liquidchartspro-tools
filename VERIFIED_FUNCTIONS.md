# VERIFIED_FUNCTIONS.md

Functions verified as working during the reorganization review. Verification was
performed by code inspection (active usage in the UI and engines) and by passing
Jest unit tests.

---

## How to run the tests

```bash
npm install        # first time only
npm test           # runs all 63 unit tests
```

---

## Verified functions

### src/functions/candle-utils.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `candleTimeMs(t)` | Jest test (`candle-utils.test.js`) + used by every engine that processes candle data | Run `npm test` — `candleTimeMs` tests pass |
| `normalizeCandles(raw)` | Jest test (`candle-utils.test.js`) + called in `engine-autotrader.js`, `engine-backtest.js`, `engine-strength.js` | Run `npm test` — `normalizeCandles` tests cover all 4 input formats |

### src/functions/util-indicators.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `sma(values, len)` | Jest test + used by `engine-autotrader.js` and `engine-backtest.js` for SMA crossover detection | `npm test` — sma describe block |
| `atr(high, low, close, len)` | Jest test + used by `engine-autotrader.js` for stop-loss sizing | `npm test` — atr describe block |
| `rsi(close, len)` | Jest test + used by `engine-autotrader.js` for RSI filter | `npm test` — rsi describe block |
| `linregSlope(values, len)` | Jest test + used by `engine-strength.js` for trend slope | `npm test` — linregSlope describe block |
| `toChron(arr)` | Jest test | `npm test` — toChron describe block |

### src/functions/util-format.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `num(value, digits)` | Jest test + used by `engine-backtest.js` for display formatting | `npm test` — num describe block |
| `pct(value, digits)` | Jest test | `npm test` — pct describe block |
| `money(value, digits)` | Jest test + used by `engine-backtest.js` for P&L display | `npm test` — money describe block |

### src/functions/util-backtest.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `winRate(trades)` | Jest test | `npm test` — winRate describe block |
| `expectancy(trades)` | Jest test | `npm test` — expectancy describe block |
| `profitFactor(trades)` | Jest test | `npm test` — profitFactor describe block |
| `maxDrawdown(equityCurve)` | Jest test | `npm test` — maxDrawdown describe block |
| `maxDrawdownPct(trades, start)` | Jest test | `npm test` — maxDrawdownPct describe block |
| `pipSize(pair)` | Jest test + used internally by `priceToPips`, `pipsToPrice` | `npm test` — pipSize describe block |
| `priceToPips(priceDiff, pair)` | Jest test | `npm test` — priceToPips/pipsToPrice describe block |
| `pipsToPrice(pips, pair)` | Jest test | `npm test` — priceToPips/pipsToPrice describe block |
| `calculateLotSize(...)` | Jest test | `npm test` — calculateLotSize describe block |
| `formatDuration(ms)` | Jest test | `npm test` — formatDuration describe block |
| `calculateTradeStats(trades, start)` | Jest test | `npm test` — calculateTradeStats describe block |

### src/functions/util-export.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `toCSV(data, columns)` | Code inspection — used by `engine-backtest.js` via `window.UTIL.Export.exportBacktestResults` | Run a backtest in the UI and click **Export CSV** |
| `downloadCSV(data, filename, columns)` | Code inspection — browser-side download trigger | Run a backtest and use the export button |
| `exportBacktestResults(trades, summary, base)` | Code inspection — called directly from `engine-backtest.js` | Run a backtest and export |

### src/strategies/strategy-registry.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `window.STRATEGIES.list` | Code inspection — referenced in `src/ui/app.js` to populate the strategy dropdown | Open the **Strategy** tab; the "Simple Moving Average Crossover" strategy should appear in the dropdown |
| `window.STRATEGIES.byId` | Code inspection — used in the backtest engine | Select a strategy and run a backtest |

### src/strategies/engine-autotrader.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `window.ENG.AutoTrader.start()` | Code inspection — wired to **▶ Start** button in `src/ui/app.js` | Click **▶ Start** in the Home tab; status should change to "Running" |
| `window.ENG.AutoTrader.stop()` | Code inspection — wired to **■ Stop** button | Click **■ Stop**; status should change to "Stopped" |
| `window.ENG.AutoTrader.scan()` | Code inspection — used by **Show Last 5 Signals** button | Click the button; it should return signal results for configured pairs |
| `window.ENG.AutoTrader.runCycle()` | Code inspection — called on each timer tick | Trigger manually: `await window.ENG.AutoTrader.runCycle()` in the browser console |

### src/strategies/engine-strength.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `window.ENG.Strength.run()` | Code inspection — wired to **▶ Run Strength** button | Click the button in the **Tools** tab |
| `window.ENG.Strength.getSnapshot()` | Code inspection — used by `src/ui/app.js` | `window.ENG.Strength.getSnapshot()` in browser console after a run |

### src/integrations/trading-api.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `window.LC.tradingAPI.buyEntry(pair, lots, tp, sl)` | Code inspection — called by `engine-autotrader.js` | With ARM set to ON, trigger a signal and confirm order in broker |
| `window.LC.tradingAPI.sellEntry(pair, lots, tp, sl)` | Code inspection | As above |
| `window.LC.tradingAPI.closeAll()` | Code inspection — wired to **Close All** button | Click **Close All** in the Tools tab |
| `window.LC.tradingAPI.closeOne(orderId)` | Code inspection — wired to individual close button | Select an open order and click **Close** |

### src/ui/signals-display.js

| Function | Verification method | How to manually validate |
|----------|--------------------|-----------------------------|
| `window.SignalsDisplay.push(sig)` | New file (stub) — browser execution | In browser console: `window.SignalsDisplay.push({ pair:"EUR/USD", dir:1, confidence:0.8, reason:"test", time:Date.now() })` — should render in the signals table |
| `window.SignalsDisplay.render()` | New file (stub) | Automatically called after `push()` |
| `window.SignalsDisplay.clear()` | New file (stub) | `window.SignalsDisplay.clear()` in browser console |
| `window.SignalsDisplay.getAll()` | New file (stub) | `window.SignalsDisplay.getAll()` in browser console |

---

## Functions NOT verified (removed or absent)

| Function | File | Reason |
|----------|------|--------|
| `getSettings()` / `setSettings()` | `settings.js` (deleted) | Used ES-module `export` syntax incompatible with the rest of the codebase; not referenced anywhere in the UI. Settings are handled directly via `localStorage` in the engine files. |
| Root `app.js` shell | `app.js` (deleted) | Earlier prototype using an older `Sway.Framework()` API pattern. Not referenced by `index.html`. |
