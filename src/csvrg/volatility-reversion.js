(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  function check_volatility_stretch(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return null;

    const price = Number(ps.mid);
    const ema = Number(ps.indicators.EMA);
    const bb = ps.indicators.BB || {};
    const atr = Number(ps.indicators.ATR);
    const threshold = state.settings.ema_distance_atr_threshold;

    if (![price, ema, atr].every(Number.isFinite) || atr <= 0) {
      ps.volatility = {
        side: "NONE",
        distance_from_ema_atr: 0,
        is_stretched: false,
        stretch_score: 0
      };
      return ps.volatility;
    }

    const distance = Math.abs(price - ema) / atr;

    let side = "NONE";
    if (price < Number(bb.lower) && distance >= threshold) {
      side = "BUY";
    } else if (price > Number(bb.upper) && distance >= threshold) {
      side = "SELL";
    }

    const stretch_score = side === "NONE" ? 0 : Math.min(3, Math.max(1, Math.round(distance)));

    ps.volatility = {
      side,
      distance_from_ema_atr: distance,
      is_stretched: side !== "NONE",
      stretch_score
    };

    return ps.volatility;
  }

  function get_reversion_side(state, pair) {
    const ps = state.pair_states[pair];
    return ps && ps.volatility ? ps.volatility.side : "NONE";
  }

  function get_stretch_score(state, pair) {
    const ps = state.pair_states[pair];
    return ps && ps.volatility ? Number(ps.volatility.stretch_score || 0) : 0;
  }

  LCPro.CSVRG.VolatilityReversion = {
    check_volatility_stretch,
    get_reversion_side,
    get_stretch_score
  };
})();
