# LiquidChartsPro AI Reference

This repo is structured so any AI model can quickly understand and fix core behavior.

## Directory map

- `index.html`: UI layout only + script includes.
- `src/app/main.js`: page wiring, button actions, render logic.
- `src/core/framework.js`: framework bootstrap (`Sway.Framework`) and shared safety helpers.
- `src/core/market-data.js`: instrument lookup, prices, candles, timeframe constants.
- `src/core/trading-actions.js`: order placement, TP/SL calculations, modify flow, close actions.
- `src/backtest/sma-crossover.js`: closed-candle SMA crossover signal scan.
- `src/strategy/actions.js`: strategy registry surface for future expansion.
- `src/debug/logger.js`: log/status helpers + health check + order/position snapshots.
- `docs/TRADING_FUNCTIONS_CHEAT_SHEET.md`: known-good platform behavior and patterns.

## Non-negotiable rules

- TP/SL are absolute prices.
- BUY base price uses ASK.
- SELL base price uses BID.
- Modify TP/SL uses `tradingAction=101` (`Liquid.OrderTypes.CHANGE`) with `orderId`, `tp`, `sl`.
- Entry TP/SL may be ignored by broker: use entry-then-modify flow.
- Candle arrays returned by framework are newest-first; reverse for indicator logic.

## Fast debug flow

1. Run `LCPro.Debug.healthCheck()` in console.
2. Verify price stream using `LCPro.MarketData.requestPrices([instrument])`.
3. Verify candle pull with `LCPro.MarketData.requestCandles(...)`.
4. If live TP/SL missing after entry, run `LCPro.Trading.entryThenModify(...)`.
5. Inspect live order/position dictionaries with `LCPro.Debug.dumpOrderPositionState()`.
