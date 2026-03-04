# src/backtest/

Backtesting engine that replays historical candle data (from LiquidChartsPro or
the local verification server) through the strategy logic and produces a trade log
and performance summary.

## Files

| File | Global exposed | Description |
|------|---------------|-------------|
| `engine-backtest.js` | `window.ENG.Backtest` | Core backtest runner: iterates candles, applies strategy, tracks trades and equity |
| `engine-backtest-signals.js` | `window.ENG.BacktestSignals` | Signal-only backtest: runs without placing real orders; used to preview strategy signals |

## How to run a backtest

1. Open the tool inside a LiquidChartsPro chart window.
2. Navigate to the **Strategy** tab.
3. Select a strategy, configure parameters, and pick a date range.
4. Click **▶ Run Backtest**.
5. When complete, results are shown in the table and can be exported via
   **⬇ Export CSV** / **⬇ Export JSON**.

## Real data only

Candles are fetched live from LiquidChartsPro via `window.LC.requestCandles`.
The backtest uses the same candle data source as the live trader so that backtest
results accurately reflect real market history.

## Using the local candle server for offline testing

```bash
pip install flask yfinance
python tools/verify_candles_server.py   # http://localhost:5050
```

Then configure the tool to fetch candles from `http://localhost:5050/api/candles`.
