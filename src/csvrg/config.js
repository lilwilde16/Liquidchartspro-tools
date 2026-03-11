(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  const DEFAULT_SETTINGS = {
    pairs_universe: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "EURJPY", "GBPJPY", "EURGBP"],
    max_active_pairs: 4,
    candles_lookback: 220,

    ema_period: 50,
    bb_period: 20,
    bb_stddev: 2,
    atr_period: 14,
    adx_period: 14,

    grid_spacing_atr_multiplier: 0.25,
    max_grid_levels: 5,
    min_trade_score: 7,
    base_grid_lot: 0.01,
    recenter_allowed: true,

    adx_safe_threshold: 22,
    adx_block_threshold: 28,
    ema_slope_block_atr_ratio: 0.35,

    ema_distance_atr_threshold: 1.0,

    scalp_enabled: true,
    scalp_trigger_distance_atr: 2.0,
    scalp_size_fraction: 0.3,
    scalp_tp_fraction_of_grid: 0.5,
    scalp_sl_fraction_of_grid: 1.0,
    scalp_timeout_minutes: 30,

    pair_max_drawdown_pct: 4.0,
    portfolio_max_drawdown_pct: 10.0,
    max_margin_used_pct: 30.0,
    max_spread_multiplier_vs_average: 2.0,

    trading_start_ny: "03:00",
    trading_end_ny: "12:00",
    friday_close_all_time_ny: "16:45",
    sunday_resume_time_ny: "18:00",

    strength_score_weight: 3,
    stretch_score_weight: 3,
    regime_score_weight: 2,
    session_score_weight: 1,
    spread_score_weight: 1,

    execution_mode: "paper"
  };

  function createSettings(custom) {
    const src = custom && typeof custom === "object" ? custom : {};
    return Object.assign({}, DEFAULT_SETTINGS, src);
  }

  LCPro.CSVRG.Config = {
    DEFAULT_SETTINGS,
    createSettings
  };
})();
