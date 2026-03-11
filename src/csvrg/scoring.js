(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const RegimeFilter = (LCPro.CSVRG && LCPro.CSVRG.RegimeFilter) || {};
  const Volatility = (LCPro.CSVRG && LCPro.CSVRG.VolatilityReversion) || {};
  const SessionManager = (LCPro.CSVRG && LCPro.CSVRG.SessionManager) || {};
  const Risk = (LCPro.CSVRG && LCPro.CSVRG.RiskManagement) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function normalizeStrength(diff) {
    if (!Number.isFinite(diff)) return 0;
    if (diff >= 0.003) return 3;
    if (diff >= 0.0015) return 2;
    if (diff >= 0.0007) return 1;
    return 0;
  }

  function score_setup(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return null;
    const s = state.settings;

    const strengthRaw = normalizeStrength(ps.strength_diff);
    const stretchRaw = Math.min(3, Volatility.get_stretch_score(state, pair));
    const regimeRaw = RegimeFilter.get_regime_score(state, pair);
    const sessionRaw = SessionManager.is_valid_session(s, Date.now()) ? 1 : 0;
    const spreadSafe = Risk.check_spread_safety ? Risk.check_spread_safety(state, pair) : true;
    const spreadRaw = spreadSafe ? 1 : 0;

    const weightSum =
      s.strength_score_weight + s.stretch_score_weight + s.regime_score_weight + s.session_score_weight + s.spread_score_weight;

    const weighted =
      (strengthRaw / 3) * s.strength_score_weight +
      (stretchRaw / 3) * s.stretch_score_weight +
      (regimeRaw / 2) * s.regime_score_weight +
      sessionRaw * s.session_score_weight +
      spreadRaw * s.spread_score_weight;

    const total = Math.round((weighted / weightSum) * 10);

    const score = {
      pair,
      strength_score: strengthRaw,
      stretch_score: stretchRaw,
      regime_score: regimeRaw,
      session_score: sessionRaw,
      spread_score: spreadRaw,
      total_score: total
    };

    ps.current_score = total;
    return score;
  }

  function is_trade_allowed(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.enabled || ps.disabled_until_reset) return false;
    if (!ps.selected) return false;
    if (ps.current_regime === "TREND_BLOCK") return false;
    if (!state.bot_enabled) return false;
    return Number(ps.current_score || 0) >= state.settings.min_trade_score;
  }

  LCPro.CSVRG.Scoring = {
    score_setup,
    is_trade_allowed
  };
})();
