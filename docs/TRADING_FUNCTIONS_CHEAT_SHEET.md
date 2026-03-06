# LIQUIDCHARTS PRO (Sway.Framework) - Trading Functions Cheat Sheet

Goal: provide minimal, reliable patterns for ticket open, BUY/SELL, TP/SL, modify, close, prices, candles, and debug.

## Verified behavior

- Entry TP/SL in initial payload can be ignored by broker.
- Modify TP/SL does work with `tradingAction=101` (`CHANGE`) + `orderId` + absolute `tp`/`sl`.
- BUY base price for TP/SL math: ASK.
- SELL base price for TP/SL math: BID.

## Required boilerplate

```html
<script src="https://pro.liquidcharts.com/scripts/widget-js"></script>
<script>
var Framework = new Sway.Framework();
function safeJson(x){ try{return JSON.stringify(x);}catch(e){return "(unstringifiable)";} }
Framework.OnLoad = function(){ console.log("Framework loaded"); };
</script>
```

## Core patterns

- Open ticket: `Framework.CreateDialog({ type:"dealticket", settings:{ instrumentId } })`
- Market order: `tradingAction = Liquid.OrderTypes.BUY|SELL` with `volume: { lots }`
- Modify TP/SL on existing order (working):

```javascript
Framework.SendOrder({
  tradingAction: 101,
  orderId: String(orderId),
  tp: Number(tpAbs),
  sl: Number(slAbs)
}, cb);
```

- Close by side on instrument: `CLOSEPOSLONG`, `CLOSEPOSSHORT`
- Candles: use `pRequestCandles` when available, fallback to `RequestCandles`

## Gotchas

- Always use absolute TP/SL prices.
- `CHANGE_TRADE_SLTP` style actions can fail as unknown command on this broker.
- Orders/positions update async; poll when needing new order id after entry.
- Reverse candle arrays before indicator math (newest-first to oldest-first).

## In this repo

See implementation in:
- `src/core/trading-actions.js`
- `src/core/market-data.js`
- `src/backtest/sma-crossover.js`
- `src/debug/logger.js`
