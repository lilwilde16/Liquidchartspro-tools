(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Indicators = (LCPro.CSVRG && LCPro.CSVRG.Indicators) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function detect_regime(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return "UNKNOWN";

    const adx = Number(ps.indicators.ADX);
    const settings = state.settings;
    const slopeRatio = Indicators.emaSlopeRatio(ps.timeframe.M15 || [], settings.ema_period, 5, settings.atr_period);

    let regime = "SAFE_REVERSION";

    if (Number.isFinite(adx) && adx > settings.adx_block_threshold) {
      regime = "TREND_BLOCK";
    } else if (Number.isFinite(adx) && adx >= settings.adx_safe_threshold) {
      regime = "CAUTION";
    }

    if (slopeRatio > settings.ema_slope_block_atr_ratio) {
      regime = regime === "SAFE_REVERSION" ? "CAUTION" : "TREND_BLOCK";
    }

    ps.current_regime = regime;
    return regime;
  }

  function get_regime_score(state, pair) {
    const regime = detect_regime(state, pair);
    if (regime === "SAFE_REVERSION") return 2;
    if (regime === "CAUTION") return 1;
    return 0;
  }

  LCPro.CSVRG.RegimeFilter = {
    detect_regime,
    get_regime_score
  };
})();
