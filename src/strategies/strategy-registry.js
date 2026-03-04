(function(){
  const SMA_CROSSOVER = {
    id: "sma_crossover",
    name: "Simple Moving Average Crossover",
    description: [
      "Entry (M15): Fast SMA crosses above Slow SMA → BUY; crosses below → SELL.",
      "Exit: ATR-based stop-loss (1.1× ATR) with 1.5:1 reward-to-risk target.",
      "Trend filter: H1 SMA alignment confirms direction before entry.",
      "Best for: trending markets during London and New York sessions."
    ].join("\n"),
    defaults: { fastMa: 10, slowMa: 30, atrLen: 14, rr: 1.5, slAtr: 1.1, allowShort: "yes", timeframe: "M15", session: "london" }
  };

  const list = [SMA_CROSSOVER];

  window.STRATEGIES = {
    list,
    byId: Object.fromEntries(list.map((s)=>[s.id, s]))
  };
})();
