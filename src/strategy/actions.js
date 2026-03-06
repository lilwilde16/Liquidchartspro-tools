(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  const STRATEGIES = {
    smaCrossover: {
      id: "sma_crossover",
      name: "SMA Crossover",
      notes: "Fast SMA crossing Slow SMA on closed candles."
    }
  };

  function getStrategy(id) {
    return STRATEGIES[id] || null;
  }

  LCPro.Strategy = {
    STRATEGIES,
    getStrategy
  };
})();
