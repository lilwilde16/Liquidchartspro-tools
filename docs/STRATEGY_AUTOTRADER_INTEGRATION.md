# Strategy to Autotrader Integration Guide

This document defines the required contract for plugging any strategy into the Home live autotrader safely.

## 1) Required Strategy Contract

A strategy must be registered in `LCPro.Strategy.STRATEGIES` with:

- `id`: unique string key
- `name`: display name
- `defaultParams`: strategy signal parameters
- `tradeManagementDefaults`: TP/SL, tick config defaults
- `liveDefaults`: runtime defaults for Home live autotrader
- `runSignals(input)`: async function returning latest signals from live data

### Required `liveDefaults` fields

- `instrumentId`: e.g. `NAS100`, `EUR/USD`
- `timeframeSec`: e.g. `60`, `300`, `900`
- `lookback`: candles to pull per cycle
- `lots`: order size
- `tpTicks`: TP ticks (`0` disables TP submission)
- `slTicks`: SL ticks (`0` disables SL submission)
- `tickSize`: instrument tick size

## 2) `runSignals(input)` Expectations

`runSignals` must:

- Use live candle data (`requestCandles`) for `input.instrumentId`, `input.timeframeSec`, and `input.lookback`
- Return newest-first signal list
- Return signals in shape:
  - `type`: `BUY` or `SELL`
  - `time`: candle time (ms or parseable date)
  - `price`: optional signal reference price
  - `idx`: optional candle index

The autotrader uses `type + time|idx` as the unique signal key to prevent duplicate entries.

## 3) Live Execution Flow (Home)

When Start is clicked:

1. Strategy selected in Home is loaded.
2. Runtime config is pulled from strategy `liveDefaults`.
3. A startup baseline signal key is primed to avoid instant entry on an already-existing signal.
4. Each cycle:
   - Live prices + candles are refreshed
   - `runSignals` is called
   - If no new signal: no trade
   - If new opposite signal while in trade: existing trade is closed
   - If flat and new signal exists: market entry is sent

## 4) Broker Order Rules

In `Execution Mode = live`:

- Entry uses:
  - `sendMarketOrderWithTpSl(...)` if TP/SL ticks > 0
  - otherwise `sendMarketOrder(...)`
- Opposite signal or manual stop uses `closeSideOnInstrument(...)`

In `Execution Mode = paper`:

- No broker order is sent.
- Position state is simulated in runtime.

## 5) Verification Diagnostics

Home -> `Live Signal Verification` snapshots confirm:

- bid/ask/spread
- candle freshness
- candle count sufficiency
- strategy metrics and waiting condition
- signal/new-signal gate
- TP/SL preview
- last broker order ack and latency

Use this panel to verify strategy readiness before trusting live execution.

## 6) Checklist for Adding a New Strategy

1. Add strategy in `STRATEGIES` with `id`, `name`, `defaultParams`, `tradeManagementDefaults`, `liveDefaults`, `runSignals`.
2. Ensure `runSignals` returns newest-first and stable `time`/`idx` values.
3. Ensure `liveDefaults.tickSize` matches instrument.
4. Verify strategy appears in Home `Live Strategy` dropdown.
5. Run in `paper` mode first and inspect diagnostics.
6. Switch to `live` mode with minimal lots for first production verification.

## 7) Common Integration Mistakes

- Returning signals oldest-first
- Missing stable `time`/`idx` causing repeated entries
- Incorrect tick size causing bad TP/SL values
- Too-low lookback preventing indicator warmup
- Strategy expecting params not present in `defaultParams`
