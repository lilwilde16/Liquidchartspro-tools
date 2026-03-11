(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Logger = (LCPro.CSVRG && LCPro.CSVRG.LoggerAnalytics) || {};
  const Risk = (LCPro.CSVRG && LCPro.CSVRG.RiskManagement) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function check_counter_scalp(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return { allowed: false, reason: "NO_PAIR" };

    if (!state.settings.scalp_enabled) return { allowed: false, reason: "DISABLED" };
    if (ps.scalp.active) return { allowed: false, reason: "ALREADY_ACTIVE" };
    if (ps.current_regime === "TREND_BLOCK") return { allowed: false, reason: "TREND_BLOCK" };
    if (!Risk.check_spread_safety(state, pair)) return { allowed: false, reason: "SPREAD" };

    const dist = Number(ps.volatility.distance_from_ema_atr || 0);
    if (dist < state.settings.scalp_trigger_distance_atr) return { allowed: false, reason: "NOT_EXTREME" };

    const side = ps.volatility.side;
    if (side === "NONE") return { allowed: false, reason: "NO_SIDE" };

    return { allowed: true, side };
  }

  function open_counter_scalp(state, pair, side) {
    const ps = state.pair_states[pair];
    if (!ps) return false;

    const spacing = Number(ps.grid.spacing || ps.indicators.ATR * state.settings.grid_spacing_atr_multiplier || 0);
    const mid = Number(ps.mid);
    if (![spacing, mid].every(Number.isFinite) || spacing <= 0) return false;

    const size = state.settings.base_grid_lot * state.settings.scalp_size_fraction;
    const tpDelta = spacing * state.settings.scalp_tp_fraction_of_grid;
    const slDelta = spacing * state.settings.scalp_sl_fraction_of_grid;

    const tp = side === "BUY" ? mid + tpDelta : mid - tpDelta;
    const sl = side === "BUY" ? mid - slDelta : mid + slDelta;

    ps.scalp = {
      active: true,
      side,
      entry_price: mid,
      tp_price: tp,
      sl_price: sl,
      size_lots: size,
      timeout_at: Date.now() + state.settings.scalp_timeout_minutes * 60000
    };

    if (Logger.log_trade_open) {
      Logger.log_trade_open(state, pair, {
        side,
        entry_price: mid,
        size_lots: size,
        tp,
        sl,
        reason_for_entry: "COUNTER_SCALP_EXTREME_STRETCH"
      });
    }

    return true;
  }

  function manage_counter_scalp(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.scalp.active) return false;

    const sc = ps.scalp;
    const mid = Number(ps.mid);
    if (!Number.isFinite(mid)) return false;

    let reason = null;
    if (sc.side === "BUY" && mid >= sc.tp_price) reason = "SCALP_TP";
    if (sc.side === "BUY" && mid <= sc.sl_price) reason = "SCALP_SL";
    if (sc.side === "SELL" && mid <= sc.tp_price) reason = "SCALP_TP";
    if (sc.side === "SELL" && mid >= sc.sl_price) reason = "SCALP_SL";
    if (!reason && Date.now() >= sc.timeout_at) reason = "SCALP_TIMEOUT";

    if (!reason) return false;

    const pnl = sc.side === "BUY" ? (mid - sc.entry_price) * sc.size_lots : (sc.entry_price - mid) * sc.size_lots;
    ps.realized_pnl += pnl;
    state.portfolio.weekly_pnl += pnl;

    if (Logger.log_trade_close) {
      Logger.log_trade_close(state, pair, {
        side: sc.side,
        entry_price: sc.entry_price,
        exit_price: mid,
        size_lots: sc.size_lots,
        reason_for_exit: reason,
        pnl
      });
    }

    ps.scalp = {
      active: false,
      side: "NONE",
      entry_price: null,
      tp_price: null,
      sl_price: null,
      size_lots: 0,
      timeout_at: null
    };

    return true;
  }

  LCPro.CSVRG.CounterScalp = {
    check_counter_scalp,
    open_counter_scalp,
    manage_counter_scalp
  };
})();
