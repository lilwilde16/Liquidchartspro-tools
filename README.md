# LiquidChartsPro Tools

Current baseline: a single foundation page in `index.html`.

This page is the new starting point and includes the validated logic path for backtest candle retrieval:
- `Framework.pRequestCandles(...)` when available
- fallback to `Framework.RequestCandles(...)`

It computes and displays the last 5 SMA crossover signals using closed candles only.

## Scope right now
- One page only: `index.html`
- No additional modules yet

## Next build direction
Future features should be added incrementally on top of this page and extracted into files only when needed.
