(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const CurrencyStrength = (LCPro.CSVRG && LCPro.CSVRG.CurrencyStrength) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function pairExists(symbolSet, base, quote) {
    const direct = base + quote;
    const inverse = quote + base;
    if (symbolSet.has(direct)) return { symbol: direct, aligned: true };
    if (symbolSet.has(inverse)) return { symbol: inverse, aligned: false };
    return null;
  }

  function build_candidate_pairs(state) {
    const ranks = state.currency_ranks || [];
    const strengths = state.currency_strength || {};
    const symbols = state.settings.pairs_universe || [];
    const symbolSet = new Set(symbols.map((x) => String(x).replace(/\//g, "").toUpperCase()));

    const top = ranks.slice(0, 4);
    const bottom = ranks.slice(Math.max(0, ranks.length - 4));
    const out = [];

    for (let i = 0; i < top.length; i++) {
      for (let j = 0; j < bottom.length; j++) {
        const strong = top[i].currency;
        const weak = bottom[j].currency;
        if (strong === weak) continue;
        const found = pairExists(symbolSet, strong, weak);
        if (!found) continue;

        const diff = Math.abs((strengths[strong] || 0) - (strengths[weak] || 0));
        out.push({
          pair: found.symbol,
          strong,
          weak,
          strength_diff: diff,
          preferred_side: found.aligned ? "BUY" : "SELL"
        });
      }
    }

    out.sort((a, b) => b.strength_diff - a.strength_diff);

    const dedup = [];
    const seen = new Set();
    for (let i = 0; i < out.length; i++) {
      if (seen.has(out[i].pair)) continue;
      seen.add(out[i].pair);
      dedup.push(out[i]);
    }

    state.candidate_pairs = dedup;
    return dedup;
  }

  function select_top_pairs(state, max_pairs) {
    const maxCount = Number.isFinite(max_pairs) ? max_pairs : state.settings.max_active_pairs;
    const picked = (state.candidate_pairs || []).slice(0, maxCount);
    state.selected_pairs = picked.map((x) => x.pair);

    const all = state.settings.pairs_universe || [];
    for (let i = 0; i < all.length; i++) {
      const pair = all[i];
      const ps = state.pair_states[pair];
      if (!ps) continue;
      ps.selected = state.selected_pairs.indexOf(pair) >= 0;
      const item = picked.find((x) => x.pair === pair);
      ps.strength_diff = item ? item.strength_diff : 0;
    }

    return state.selected_pairs;
  }

  LCPro.CSVRG.PairSelection = {
    build_candidate_pairs,
    select_top_pairs
  };
})();
