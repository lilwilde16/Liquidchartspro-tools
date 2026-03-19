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

    mtf_signal_enabled: true,
    mtf_strategy_exclusive: true,
    signal_trade_lot: 0.02,
    signal_rsi_period: 14,
    signal_rsi_buy_max: 50,
    signal_rsi_sell_min: 50,
    signal_adx_period: 14,
    signal_adx_min: 0,
    signal_entry_reclaim_enabled: true,
    signal_entry_reclaim_lookback_bars: 6,
    signal_entry_reclaim_min_body_atr: 0.1,
    signal_entry_reclaim_cross_buffer_atr: 0.05,
    signal_entry_reclaim_use_ema: true,
    signal_entry_reclaim_ema_period: 20,
    signal_strength_min_diff: 0.0006,
    signal_bb_period: 20,
    signal_bb_stddev: 2,
    signal_atr_period: 14,
    signal_sl_atr_mult: 1.0,
    signal_tp_rr: 1.2,
    signal_trail_atr_buffer: 0.2,
    signal_max_trade_minutes: 180,
    signal_use_fvg_filter: false,
    signal_fvg_max_age_bars: 10,
    signal_use_supply_demand_zones: true,
    signal_sd_lookback_bars: 80,
    signal_sd_pivot_left: 2,
    signal_sd_pivot_right: 2,
    signal_sd_departure_atr: 0.6,
    signal_sd_departure_bars: 6,
    signal_sd_freshness_bars: 36,
    signal_sd_entry_atr_buffer: 0.2,
    signal_sd_stop_atr_buffer: 0.15,
    signal_sd_target_atr_buffer: 0.1,
    mtf_strength_m15_lookback: 3,
    mtf_strength_h1_lookback: 2,
    mtf_strength_m15_min_momentum: 0,
    mtf_strength_h1_min_momentum: 0,

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
