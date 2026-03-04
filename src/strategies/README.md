# src/strategies/

Strategy engine files. Each file registers a strategy or implements a live-trading
engine that uses the API wrappers in `src/integrations/`.

## Files

| File | Global exposed | Description |
|------|---------------|-------------|
| `strategy-registry.js` | `window.STRATEGIES` | Registry of all available strategies (currently: `sma_crossover`) |
| `engine-autotrader.js` | `window.ENG.AutoTrader` | Main autotrading loop: scans pairs, scores confidence, and places trades |
| `engine-strength.js` | `window.ENG.Strength` | Currency strength meter: ranks currencies using RSI across multiple pairs |

## How the AutoTrader works

1. Reads configured pairs and schedule from the **Tools** tab settings.
2. Calls `window.LC.requestCandles(pair, tf, count)` to get live candle data from
   LiquidChartsPro.
3. Scores each pair using RSI, SMA trend, ATR volatility, and currency strength.
4. Places a market order via `window.LC.tradingAPI` when confidence exceeds the
   configured threshold.

## Connecting a live data feed

All candle requests are routed through `window.LC.requestCandles`, which is
initialised by `src/integrations/lc-framework.js` when the LiquidChartsPro widget
loads. **No additional configuration is needed** — simply open the tool inside a
LiquidChartsPro chart window.

To use the optional local candle verification server instead:
```bash
pip install flask yfinance
python tools/verify_candles_server.py   # starts on http://localhost:5050
```
Then in your browser console:
```javascript
window.LC.api.overrideCandleUrl("http://localhost:5050/api/candles");
```
