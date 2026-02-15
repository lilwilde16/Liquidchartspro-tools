(function(){
  const SMA_CROSSOVER = {
    id: "sma_crossover",
    name: "SMA Crossover (Balanced)",
    description: [
      "Entry: Fast SMA crosses above/below Slow SMA.",
      "Exit: ATR stop + configurable RR target.",
      "Use when you want a neutral baseline for most symbols."
    ].join("\n"),
    defaults: { fastMa: 10, slowMa: 30, atrLen: 14 }
  };

  const SMA_LONG_TREND = {
    id: "sma_long_trend",
    name: "SMA Long-Term Trend (Live-tested)",
    description: [
      "Built for long horizon trend trading from live-data sweep baseline.",
      "Suggested baseline: Fast 50, Slow 300, ATR 14, long-only.",
      "Goal: avoid overtrading and ride established directional moves."
    ].join("\n"),
    defaults: { fastMa: 50, slowMa: 300, atrLen: 14, rr: 2.5, slAtr: 1.5, allowShort: "no", timeframe: "H1", session: "london", count: 80 }
  };

  const STRENGTH_SCALP_WEEKLY = {
    id: "strength_scalp_weekly",
    name: "Strength Scalper (Weekly Focus)",
    description: [
      "Scalp only when trend pressure is clear (anti-consolidation filter).",
      "Entry: SMA cross + trend strength ratio over ATR threshold.",
      "Session-first: London / New York overlap is preferred.",
      "Best workflow: run Strength scanner first, then backtest top movers only."
    ].join("\n"),
    defaults: { fastMa: 20, slowMa: 100, atrLen: 14, rr: 1.5, slAtr: 1.1, allowShort: "yes", timeframe: "M15", session: "london", count: 120 }
  };

  const list = [SMA_CROSSOVER, SMA_LONG_TREND, STRENGTH_SCALP_WEEKLY];

  window.STRATEGIES = {
    list,
    byId: Object.fromEntries(list.map((s)=>[s.id, s]))
  };
})();
