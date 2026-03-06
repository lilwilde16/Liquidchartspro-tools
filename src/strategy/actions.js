(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function toPosInt(v, fallback, minValue) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(minValue || 1, n);
  }

  function runSmaCrossover(input) {
    const params = input && input.params ? input.params : {};
    const fastLen = toPosInt(params.fastLen, 9, 2);
    const slowLen = toPosInt(params.slowLen, 21, 3);
    const keepN = toPosInt(input && input.keepN, 5, 1);

    return window.LCPro.Backtest.lastCrossSignals(
      input.instrumentId,
      input.timeframeSec,
      input.lookback,
      fastLen,
      slowLen,
      keepN
    );
  }

  const STRATEGIES = {
    sma_crossover: {
      id: "sma_crossover",
      name: "SMA Crossover",
      notes: "Fast SMA crossing Slow SMA on closed candles.",
      defaultParams: { fastLen: 9, slowLen: 21 },
      runSignals: runSmaCrossover
    }
  };

  function getStrategy(id) {
    return STRATEGIES[id] || null;
  }

  async function runSignals(id, input) {
    const s = getStrategy(id);
    if (!s || typeof s.runSignals !== "function") {
      throw new Error("Strategy not found or has no runner: " + id);
    }
    return await s.runSignals(input || {});
  }

  LCPro.Strategy = {
    STRATEGIES,
    getStrategy,
    runSignals
  };
})();
