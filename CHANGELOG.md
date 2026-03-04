# Changelog

## [Unreleased]

### Fixed

- **SMA crossover "Last 5 Signals" — incorrect entry prices and timestamps**
  - All `normalizeCandles` implementations now consistently convert candle timestamps
    to milliseconds via a shared `candleTimeMs` helper (seconds → ms if value < 1e12,
    otherwise kept as-is). Files updated: `js/engine-autotrader.js`,
    `js/engine-strength.js`, `js/engine-backtest.js`.
  - `js/engine-strength.js` `normalizeCandles` previously omitted the `t` field
    entirely; it now includes a normalized millisecond timestamp and ensures
    oldest-first ordering.
  - `js/engine-backtest.js` `normalizeCandles` previously stored raw `Number(t)`
    (could be seconds); it now uses `candleTimeMs` and is consolidated to a single
    implementation (removed duplicate object-with-arrays branch).
  - `js/engine-autotrader.js` `scanCrossoverSignals` now logs a `console.debug` line
    for each detected signal (`sma-scan <pair> idx <i> candlesAgo <n> t(ms) <ts> close <price>`)
    to aid in cross-checking the reported entry price against the chart.
  - `js/app.js` UI now uses an `isLikelyMs` guard before constructing a `Date` from
    `r.t`, preventing incorrect date strings when timestamps are in seconds or zero.
    When a valid ms timestamp is available the display shows both the formatted date
    **and** the `candlesAgo` count for easy chart cross-reference.

### How to verify

1. Reload the app and open the browser DevTools console.
2. Click **🔍 Show Last 5 Signals (by Pair)**.
3. Confirm `console.debug` lines appear in the console for each signal, listing
   `idx`, `candlesAgo`, `t(ms)`, and `close`.
4. The "Signal time" in each card should now show a readable local date/time **plus**
   the candle offset, e.g. `3/4/2026, 10:00:00 AM (2 candles ago)`.
5. Cross-check the listed entry price against the chart by counting back the stated
   number of candles on the same timeframe — they should match.
