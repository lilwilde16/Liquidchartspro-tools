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
- `src/csvrg/*.js`: CS-VRG Engine modules (currency strength + volatility reversion bounded grid).
- `src/app/main.js`: UI wiring and runtime orchestration.
- `docs/TRADING_FUNCTIONS_CHEAT_SHEET.md`: verified working patterns.
- `docs/AI_REFERENCE.md`: AI-friendly quick map for future debugging/fixes.

## CS-VRG Engine

`CS-VRG` (Currency Strength + Volatility Reversion Grid) is now available under `window.LCPro.CSVRG`.

Implemented modules:
- market data module
- currency strength module
- pair selection module
- regime filter module
- volatility reversion module
- scoring module
- bounded grid execution module
- counter-scalp module
- risk management module
- session manager module
- trade manager module
- logger / analytics module

### Quickstart

```js
const engine = window.LCPro.CSVRG.Engine.createEngine({
	execution_mode: "paper",
	min_trade_score: 7
});

// Run one full cycle
await engine.run_cycle();

// Inspect state and analytics
engine.state.selected_pairs;
engine.state.currency_ranks;
engine.state.analytics.events.slice(-20);
```

### Core guarantees

- no martingale
- no loss-doubling logic
- bounded max grid levels
- pair and portfolio drawdown enforcement
- spread and margin safety checks
- Friday shutdown flattening

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

## Repo CSV Export Server

To save CSV exports directly into the workspace repo, run:

```bash
node repo-export-server.js
```

Then open the app through the server at:

```text
http://localhost:8787
```

The Tools tab `Save CSV To Repo` button writes files into:

```text
exports/
```
