(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const CSVRG = (LCPro.CSVRG = LCPro.CSVRG || {});

  const Config = CSVRG.Config || {};
  const State = CSVRG.State || {};
  const Market = CSVRG.MarketDataModule || {};
  const Session = CSVRG.SessionManager || {};
  const Logger = CSVRG.LoggerAnalytics || {};
  const Strength = CSVRG.CurrencyStrength || {};
  const Selector = CSVRG.PairSelection || {};
  const Regime = CSVRG.RegimeFilter || {};
  const Volatility = CSVRG.VolatilityReversion || {};
  const Scoring = CSVRG.Scoring || {};
  const Grid = CSVRG.GridExecution || {};
  const TradeManager = CSVRG.TradeManager || {};
  const Risk = CSVRG.RiskManagement || {};
  const CounterScalp = CSVRG.CounterScalp || {};
  const StrengthMtf = CSVRG.StrengthMtfStrategy || {};

  function handle_friday_shutdown(state) {
    if (!Session.is_friday_shutdown_time(state.settings, Date.now())) return false;
    TradeManager.close_all_positions(state, "FRIDAY_SHUTDOWN");
    state.bot_enabled = false;
    if (Logger.log_risk_event) {
      Logger.log_risk_event(state, { reason: "FRIDAY_SHUTDOWN" });
    }
    return true;
  }

  async function runCycle(state) {
    await Market.update_market_data(state);

    const sessionState = Session.handle_session_state(state);
    if (sessionState.reason === "FRIDAY_SHUTDOWN") {
      handle_friday_shutdown(state);
      return { ok: true, reason: "FRIDAY_SHUTDOWN" };
    }

    Strength.calculate_currency_strength(state);
    Strength.rank_currencies(state);

    Selector.build_candidate_pairs(state);
    Selector.select_top_pairs(state, state.settings.max_active_pairs);

    for (let i = 0; i < state.selected_pairs.length; i++) {
      const pair = state.selected_pairs[i];
      const ps = state.pair_states[pair];
      if (!ps || ps.disabled_until_reset) continue;

      Regime.detect_regime(state, pair);
      Volatility.check_volatility_stretch(state, pair);

      const score = Scoring.score_setup(state, pair);
      if (Logger.log_setup) {
        Logger.log_setup(state, pair, {
          score,
          regime: ps.current_regime,
          spread: ps.spread,
          strength_diff: ps.strength_diff,
          adx: ps.indicators.ADX,
          atr: ps.indicators.ATR,
          ema: ps.indicators.EMA,
          bb: ps.indicators.BB,
          session_valid: Session.is_valid_session(state.settings, Date.now())
        });
      }

      if (state.settings.mtf_signal_enabled) {
        const signalCheck = StrengthMtf.check_entry ? StrengthMtf.check_entry(state, pair) : { allowed: false };
        if (signalCheck.allowed && StrengthMtf.open_trade) {
          StrengthMtf.open_trade(state, pair, signalCheck.side, signalCheck.diagnostics || null);
        }
      } else {
        const side = Volatility.get_reversion_side(state, pair);
        if (side !== "NONE" && Scoring.is_trade_allowed(state, pair)) {
          await Grid.activate_grid(state, pair, side);
        }
      }
    }

    const allPairs = Object.keys(state.pair_states || {});
    for (let i = 0; i < allPairs.length; i++) {
      const pair = allPairs[i];
      if (state.settings.mtf_signal_enabled) {
        if (StrengthMtf.manage_trade) StrengthMtf.manage_trade(state, pair);
      } else {
        TradeManager.manage_grid_positions(state, pair);

        const scalpCheck = CounterScalp.check_counter_scalp(state, pair);
        if (scalpCheck.allowed) {
          CounterScalp.open_counter_scalp(state, pair, scalpCheck.side);
        }
        CounterScalp.manage_counter_scalp(state, pair);
      }

      Risk.enforce_pair_risk(state, pair);
    }

    Risk.enforce_portfolio_risk(state);
    handle_friday_shutdown(state);

    return {
      ok: true,
      selected_pairs: state.selected_pairs.slice(),
      total_open_trades: state.portfolio.total_open_trades,
      drawdown_pct: state.portfolio.total_drawdown_pct
    };
  }

  function createEngine(customSettings) {
    const settings = Config.createSettings(customSettings || {});
    const state = State.createEngineState(settings);

    return {
      state,
      settings,
      update_market_data: function () {
        return Market.update_market_data(state);
      },
      get_bid_ask: function (pair) {
        return Market.get_bid_ask(pair);
      },
      get_spread: function (pair) {
        return Market.get_spread(pair);
      },
      get_ohlc: function (pair, timeframe, bars) {
        return Market.get_ohlc(pair, timeframe, bars);
      },

      calculate_currency_strength: function () {
        return Strength.calculate_currency_strength(state);
      },
      rank_currencies: function () {
        return Strength.rank_currencies(state);
      },

      build_candidate_pairs: function () {
        return Selector.build_candidate_pairs(state);
      },
      select_top_pairs: function (maxPairs) {
        return Selector.select_top_pairs(state, maxPairs);
      },

      detect_regime: function (pair) {
        return Regime.detect_regime(state, pair);
      },
      get_regime_score: function (pair) {
        return Regime.get_regime_score(state, pair);
      },

      check_volatility_stretch: function (pair) {
        return Volatility.check_volatility_stretch(state, pair);
      },
      get_reversion_side: function (pair) {
        return Volatility.get_reversion_side(state, pair);
      },
      get_stretch_score: function (pair) {
        return Volatility.get_stretch_score(state, pair);
      },

      score_setup: function (pair) {
        return Scoring.score_setup(state, pair);
      },
      is_trade_allowed: function (pair) {
        return Scoring.is_trade_allowed(state, pair);
      },

      calculate_grid_spacing: function (pair) {
        return Grid.calculate_grid_spacing(state, pair);
      },
      build_grid_levels: function (pair, side) {
        return Grid.build_grid_levels(state, pair, side);
      },
      activate_grid: function (pair, side) {
        return Grid.activate_grid(state, pair, side);
      },
      place_grid_orders: function (pair) {
        return Grid.place_grid_orders(state, pair);
      },
      cancel_grid_orders: function (pair) {
        return Grid.cancel_grid_orders(state, pair);
      },

      check_counter_scalp: function (pair) {
        return CounterScalp.check_counter_scalp(state, pair);
      },
      open_counter_scalp: function (pair, side) {
        return CounterScalp.open_counter_scalp(state, pair, side);
      },
      manage_counter_scalp: function (pair) {
        return CounterScalp.manage_counter_scalp(state, pair);
      },
      check_strength_mtf_entry: function (pair) {
        return StrengthMtf.check_entry ? StrengthMtf.check_entry(state, pair) : { allowed: false, reason: "UNAVAILABLE" };
      },
      open_strength_mtf_trade: function (pair, side, diagnostics) {
        return StrengthMtf.open_trade ? StrengthMtf.open_trade(state, pair, side, diagnostics || null) : false;
      },
      manage_strength_mtf_trade: function (pair) {
        return StrengthMtf.manage_trade ? StrengthMtf.manage_trade(state, pair) : false;
      },

      enforce_pair_risk: function (pair) {
        return Risk.enforce_pair_risk(state, pair);
      },
      enforce_portfolio_risk: function () {
        return Risk.enforce_portfolio_risk(state);
      },
      check_margin_usage: function () {
        return Risk.check_margin_usage(state);
      },
      check_spread_safety: function (pair) {
        return Risk.check_spread_safety(state, pair);
      },

      is_valid_session: function () {
        return Session.is_valid_session(state.settings, Date.now());
      },
      is_friday_shutdown_time: function () {
        return Session.is_friday_shutdown_time(state.settings, Date.now());
      },
      is_sunday_resume_time: function () {
        return Session.is_sunday_resume_time(state.settings, Date.now());
      },
      handle_session_state: function () {
        return Session.handle_session_state(state);
      },

      manage_grid_positions: function (pair) {
        return TradeManager.manage_grid_positions(state, pair);
      },
      manage_take_profits: function (pair) {
        return TradeManager.manage_take_profits(state, pair);
      },
      manage_partial_profits: function (pair) {
        return TradeManager.manage_partial_profits(state, pair);
      },
      close_pair_positions: function (pair) {
        return TradeManager.close_pair_positions(state, pair, "MANUAL_CLOSE_PAIR");
      },
      close_all_positions: function () {
        return TradeManager.close_all_positions(state, "MANUAL_CLOSE_ALL");
      },

      log_setup: function (pair) {
        return Logger.log_setup(state, pair, state.pair_states[pair] || null);
      },
      log_trade_activity: function (pair, payload) {
        return Logger.log_trade_open(state, pair, payload || null);
      },
      log_trade_close: function (pair, payload) {
        return Logger.log_trade_close(state, pair, payload || null);
      },
      log_risk_event: function (event) {
        return Logger.log_risk_event(state, event || null);
      },

      handle_friday_shutdown: function () {
        return handle_friday_shutdown(state);
      },
      run_cycle: function () {
        return runCycle(state);
      }
    };
  }

  CSVRG.Engine = {
    createEngine,
    runCycle
  };
})();
