(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  function blankPairState(symbol) {
    return {
      symbol,
      enabled: true,
      selected: false,
      current_regime: "UNKNOWN",
      current_score: 0,
      strength_diff: 0,
      spread: null,
      spread_avg: null,
      bid: null,
      ask: null,
      mid: null,
      timeframe: {
        M1: null,
        M5: null,
        M15: null,
        H1: null
      },
      indicators: {
        EMA: null,
        BB: { upper: null, middle: null, lower: null },
        ATR: null,
        ADX: null
      },
      volatility: {
        side: "NONE",
        distance_from_ema_atr: 0,
        is_stretched: false,
        stretch_score: 0
      },
      grid: {
        active: false,
        side: "NONE",
        center_price: null,
        spacing: null,
        levels: [],
        pending_orders: []
      },
      positions: [],
      scalp: {
        active: false,
        side: "NONE",
        entry_price: null,
        tp_price: null,
        sl_price: null,
        size_lots: 0,
        timeout_at: null
      },
      realized_pnl: 0,
      unrealized_pnl: 0,
      drawdown_pct: 0,
      last_trade_time: null,
      last_trade_direction: "NONE",
      disabled_until_reset: false
    };
  }

  function createEngineState(settings) {
    const pair_states = {};
    const universe = (settings && settings.pairs_universe) || [];
    for (let i = 0; i < universe.length; i++) {
      const symbol = String(universe[i]);
      pair_states[symbol] = blankPairState(symbol);
    }

    return {
      bot_enabled: true,
      settings,
      cycle_timestamp: Date.now(),
      currency_strength: {
        USD: 0,
        EUR: 0,
        GBP: 0,
        JPY: 0,
        AUD: 0,
        CAD: 0,
        CHF: 0,
        NZD: 0
      },
      currency_ranks: [],
      candidate_pairs: [],
      selected_pairs: [],
      pair_states,
      portfolio: {
        account_balance: 100000,
        account_equity: 100000,
        total_drawdown_pct: 0,
        total_open_trades: 0,
        active_pairs: [],
        margin_used_pct: 0,
        weekly_pnl: 0
      },
      analytics: {
        events: [],
        max_events: 2000
      }
    };
  }

  function appendEvent(state, event) {
    const buffer = state.analytics.events;
    buffer.push(event);
    while (buffer.length > state.analytics.max_events) {
      buffer.shift();
    }
  }

  LCPro.CSVRG.State = {
    blankPairState,
    createEngineState,
    appendEvent
  };
})();
