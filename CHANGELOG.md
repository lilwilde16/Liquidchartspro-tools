# Changelog

## [Unreleased]

### Added

- **`js/lib/candle-utils.js`** — new shared helper module exposing `window.CandleUtils`
  with `candleTimeMs` and `normalizeCandles` for use across all engine modules.
- **Chart-provider candle fallback** — a new "Use chart provider candles for signals"
  checkbox (id `useChartCandlesForSignals`) on the Home tab lets users explicitly route
  the "Last 5 Signals" scan through the chart provider API. Off by default.

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
  - `js/engine-autotrader.js` `scanCrossoverSignals` now accepts an optional
    `apiOverride` parameter to allow an alternative candle source; removed leftover
    debug logging.
  - `js/app.js` UI uses an `isLikelyMs` guard before constructing a `Date` from
    `r.t`, preventing incorrect date strings when timestamps are in seconds or zero.
    When a valid ms timestamp is available the display shows both the formatted date
    **and** the `candlesAgo` count for easy chart cross-reference.

### How to verify

1. Reload the app and click **🔍 Show Last 5 Signals (by Pair)** on the Home tab.
2. The "Signal time" in each card should show a readable local date/time **plus**
   the candle offset, e.g. `3/4/2026, 10:00:00 AM (2 candles ago)`.
3. Cross-check the listed entry price against the chart by counting back the stated
   number of candles on the same timeframe — the close price at that candle should
   match the displayed entry price.
4. To test the chart-provider fallback: tick "Use chart provider candles for signals"
   and click **🔍 Show Last 5 Signals** again — results should be identical (same
   source), confirming the routing path works without error.
