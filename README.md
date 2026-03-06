# LiquidChartsPro Tools

Modular foundation for LiquidCharts widget development with clear separation between:
- market/framework functions
- trading actions
- backtest logic
- strategy hooks
- debug helpers

## Structure

- `index.html`: UI markup and style, loads all JS modules.
- `src/core/framework.js`: framework bootstrapping and safety helpers.
- `src/core/market-data.js`: prices, instruments, and candle requests.
- `src/core/trading-actions.js`: order placement, modify (`CHANGE=101`), close, and entry-then-modify flow.
- `src/backtest/sma-crossover.js`: closed-candle SMA crossover scanner.
- `src/strategy/actions.js`: strategy registry surface.
- `src/debug/logger.js`: log/status, health check, snapshot dump helpers.
- `src/app/main.js`: UI wiring and runtime orchestration.
- `docs/TRADING_FUNCTIONS_CHEAT_SHEET.md`: verified working patterns.
- `docs/AI_REFERENCE.md`: AI-friendly quick map for future debugging/fixes.

## Core rules (verified)

- Candle fetch path: `pRequestCandles` first, `RequestCandles` fallback.
- Candles are newest-first from framework; reverse before indicator math.
- Use closed candles only for signal detection.
- TP/SL are absolute prices.
- BUY TP/SL base uses ASK; SELL TP/SL base uses BID.
- Modify TP/SL with `tradingAction=101` (`Liquid.OrderTypes.CHANGE`) using `orderId + tp + sl`.

## Debug quickstart

- `LCPro.Debug.healthCheck()`
- `LCPro.Debug.dumpOrderPositionState()`
- `LCPro.MarketData.requestCandles("NAS100", 900, 300)`
- `LCPro.Trading.entryThenModify(...)`
