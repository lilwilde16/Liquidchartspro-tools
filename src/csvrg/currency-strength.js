(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  const ALL_CCY = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD"];

  function parsePair(symbol) {
    const s = String(symbol || "").replace(/\//g, "").toUpperCase();
    if (s.length !== 6) return null;
    return { base: s.slice(0, 3), quote: s.slice(3) };
  }

  function momentum(candles, lookback) {
    if (!Array.isArray(candles) || candles.length <= lookback) return 0;
    const now = Number(candles[candles.length - 1].c);
    const prev = Number(candles[candles.length - 1 - lookback].c);
    if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return 0;
    return (now - prev) / prev;
  }

  function calculate_currency_strength(state) {
    const scores = {};
    const counts = {};
    for (let i = 0; i < ALL_CCY.length; i++) {
      scores[ALL_CCY[i]] = 0;
      counts[ALL_CCY[i]] = 0;
    }

    const symbols = state.settings.pairs_universe || [];
    for (let i = 0; i < symbols.length; i++) {
      const pair = symbols[i];
      const parsed = parsePair(pair);
      if (!parsed) continue;
      const ps = state.pair_states[pair];
      if (!ps) continue;

      const m15 = momentum(ps.timeframe.M15 || [], 6);
      const h1 = momentum(ps.timeframe.H1 || [], 3);
      const blended = m15 * 0.6 + h1 * 0.4;

      if (Number.isFinite(scores[parsed.base])) {
        scores[parsed.base] += blended;
        counts[parsed.base] += 1;
      }
      if (Number.isFinite(scores[parsed.quote])) {
        scores[parsed.quote] -= blended;
        counts[parsed.quote] += 1;
      }
    }

    for (let i = 0; i < ALL_CCY.length; i++) {
      const c = ALL_CCY[i];
      const n = counts[c] || 1;
      scores[c] = Number((scores[c] / n).toFixed(6));
    }

    state.currency_strength = scores;
    return scores;
  }

  function rank_currencies(state) {
    const entries = Object.keys(state.currency_strength).map((k) => ({ currency: k, score: state.currency_strength[k] }));
    entries.sort((a, b) => b.score - a.score);
    state.currency_ranks = entries;
    return entries;
  }

  LCPro.CSVRG.CurrencyStrength = {
    ALL_CCY,
    parsePair,
    calculate_currency_strength,
    rank_currencies
  };
})();
