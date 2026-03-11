(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const TradeManager = (LCPro.CSVRG && LCPro.CSVRG.TradeManager) || {};
  const Logger = (LCPro.CSVRG && LCPro.CSVRG.LoggerAnalytics) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function pairExposureAbs(ps) {
    let exposure = 0;
    for (let i = 0; i < ps.positions.length; i++) {
      exposure += Math.abs(ps.positions[i].entry_price * ps.positions[i].size_lots);
    }
    return exposure;
  }

  function check_margin_usage(state) {
    const bal = Math.max(1, Number(state.portfolio.account_balance || 0));
    let gross = 0;
    const symbols = Object.keys(state.pair_states || {});
    for (let i = 0; i < symbols.length; i++) gross += pairExposureAbs(state.pair_states[symbols[i]]);
    const marginPct = (gross / bal) * 100;
    state.portfolio.margin_used_pct = marginPct;
    return marginPct <= state.settings.max_margin_used_pct;
  }

  function check_spread_safety(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return false;
    if (!Number.isFinite(ps.spread)) return false;
    if (!Number.isFinite(ps.spread_avg) || ps.spread_avg <= 0) return true;

    return ps.spread <= ps.spread_avg * state.settings.max_spread_multiplier_vs_average;
  }

  function updatePairDrawdown(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return 0;
    const bal = Math.max(1, Number(state.portfolio.account_balance || 0));
    const dd = Math.max(0, -Number(ps.unrealized_pnl || 0));
    ps.drawdown_pct = (dd / bal) * 100;
    return ps.drawdown_pct;
  }

  function enforce_pair_risk(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return { ok: false, reason: "NO_PAIR" };

    updatePairDrawdown(state, pair);
    if (ps.grid.levels.length > state.settings.max_grid_levels) {
      ps.grid.levels = ps.grid.levels.slice(0, state.settings.max_grid_levels);
    }

    if (!check_spread_safety(state, pair)) {
      return { ok: false, reason: "SPREAD_BLOCK" };
    }

    if (ps.drawdown_pct >= state.settings.pair_max_drawdown_pct) {
      TradeManager.close_pair_positions(state, pair, "PAIR_DRAWDOWN_STOP");
      ps.disabled_until_reset = true;
      if (Logger.log_risk_event) {
        Logger.log_risk_event(state, {
          pair,
          reason: "PAIR_DRAWDOWN_STOP",
          drawdown_pct: ps.drawdown_pct
        });
      }
      return { ok: false, reason: "PAIR_DRAWDOWN_STOP" };
    }

    return { ok: true };
  }

  function enforce_portfolio_risk(state) {
    const symbols = Object.keys(state.pair_states || {});
    let unrealized = 0;
    let openTrades = 0;
    let activePairs = 0;

    for (let i = 0; i < symbols.length; i++) {
      const ps = state.pair_states[symbols[i]];
      unrealized += Number(ps.unrealized_pnl || 0);
      openTrades += ps.positions.length;
      if (ps.grid.active || ps.positions.length) activePairs += 1;
    }

    state.portfolio.total_open_trades = openTrades;
    state.portfolio.active_pairs = activePairs;

    const bal = Math.max(1, Number(state.portfolio.account_balance || 0));
    const dd = Math.max(0, -unrealized);
    state.portfolio.total_drawdown_pct = (dd / bal) * 100;
    state.portfolio.account_equity = bal + unrealized;

    if (!check_margin_usage(state)) {
      if (Logger.log_risk_event) Logger.log_risk_event(state, { reason: "MARGIN_LIMIT" });
      return { ok: false, reason: "MARGIN_LIMIT" };
    }

    if (state.portfolio.total_drawdown_pct >= state.settings.portfolio_max_drawdown_pct) {
      TradeManager.close_all_positions(state, "PORTFOLIO_DRAWDOWN_STOP");
      state.bot_enabled = false;
      if (Logger.log_risk_event) {
        Logger.log_risk_event(state, {
          reason: "PORTFOLIO_DRAWDOWN_STOP",
          drawdown_pct: state.portfolio.total_drawdown_pct
        });
      }
      return { ok: false, reason: "PORTFOLIO_DRAWDOWN_STOP" };
    }

    return { ok: true };
  }

  LCPro.CSVRG.RiskManagement = {
    enforce_pair_risk,
    enforce_portfolio_risk,
    check_margin_usage,
    check_spread_safety
  };
})();
