(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Logger = (LCPro.CSVRG && LCPro.CSVRG.LoggerAnalytics) || {};
  const GridExecution = (LCPro.CSVRG && LCPro.CSVRG.GridExecution) || {};
  const Trading = LCPro.Trading || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function isLive(state) {
    return String((state && state.settings && state.settings.execution_mode) || "paper").toLowerCase() === "live";
  }

  function symbolToInstrument(symbol) {
    const s = String(symbol || "").replace(/\//g, "").toUpperCase();
    if (s.length !== 6) return symbol;
    return s.slice(0, 3) + "/" + s.slice(3);
  }

  function meanTarget(ps) {
    const bb = ps.indicators.BB || {};
    const ema = Number(ps.indicators.EMA);
    if (Number.isFinite(bb.middle)) return Number(bb.middle);
    return Number.isFinite(ema) ? ema : null;
  }

  function openLevelIfTriggered(ps, mid, level) {
    if (level.active || level.order_in_flight) return null;
    if (level.side === "BUY" && mid <= level.entry_price) {
      // trigger reached
    }
    if (level.side === "SELL" && mid >= level.entry_price) {
      // trigger reached
    }
    const triggered =
      (level.side === "BUY" && mid <= level.entry_price) || (level.side === "SELL" && mid >= level.entry_price);
    if (!triggered) return null;

    const position = {
      side: level.side,
      entry_price: level.entry_price,
      size_lots: level.size_lots,
      opened_at: Date.now(),
      source: "GRID",
      level: level.level
    };
    ps.positions.push(position);
    level.active = true;
    return position;
  }

  function openLevelLive(state, pair, ps, level) {
    if (!Trading || typeof Trading.sendMarketOrder !== "function") return;
    const now = Date.now();
    const lastAttempt = Number(level.last_attempt_at || 0);
    if (now - lastAttempt < 2000) return;

    level.order_in_flight = true;
    level.last_attempt_at = now;
    const instrumentId = symbolToInstrument(pair);

    Trading.sendMarketOrder(instrumentId, level.side, level.size_lots)
      .then(function (res) {
        const ok = !!(res && res.ok);
        if (!ok) {
          level.last_error = (res && res.reason) || "Live entry rejected";
          return;
        }

        level.active = true;
        const fillPrice = Number(ps.mid);
        const position = {
          side: level.side,
          entry_price: Number.isFinite(fillPrice) ? fillPrice : level.entry_price,
          size_lots: level.size_lots,
          opened_at: Date.now(),
          source: "GRID_LIVE",
          level: level.level,
          instrument_id: instrumentId,
          broker_response: res && res.response ? res.response : null
        };
        ps.positions.push(position);

        if (Logger.log_trade_open) {
          Logger.log_trade_open(state, pair, {
            side: position.side,
            entry_price: position.entry_price,
            size_lots: position.size_lots,
            grid_level: position.level,
            reason_for_entry: "GRID_LEVEL_TRIGGER_LIVE"
          });
        }
      })
      .catch(function (e) {
        level.last_error = e && e.message ? e.message : String(e);
      })
      .finally(function () {
        level.order_in_flight = false;
      });
  }

  function calcUnrealized(ps) {
    const mid = Number(ps.mid);
    if (!Number.isFinite(mid)) return 0;
    let pnl = 0;
    for (let i = 0; i < ps.positions.length; i++) {
      const p = ps.positions[i];
      if (p.side === "BUY") pnl += (mid - p.entry_price) * p.size_lots;
      if (p.side === "SELL") pnl += (p.entry_price - mid) * p.size_lots;
    }
    return pnl;
  }

  function manage_take_profits(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.positions.length) return 0;

    const target = meanTarget(ps);
    const mid = Number(ps.mid);
    if (![target, mid].every(Number.isFinite)) return 0;

    let closed = 0;
    const keep = [];
    for (let i = 0; i < ps.positions.length; i++) {
      const p = ps.positions[i];
      const hit = p.side === "BUY" ? mid >= target : mid <= target;
      if (!hit) {
        keep.push(p);
        continue;
      }

      const pnl = p.side === "BUY" ? (mid - p.entry_price) * p.size_lots : (p.entry_price - mid) * p.size_lots;
      ps.realized_pnl += pnl;
      state.portfolio.weekly_pnl += pnl;
      closed += 1;
      if (Logger.log_trade_close) {
        Logger.log_trade_close(state, pair, {
          side: p.side,
          entry_price: p.entry_price,
          exit_price: mid,
          size_lots: p.size_lots,
          reason_for_exit: "MEAN_REVERSION_TARGET",
          pnl
        });
      }
    }

    ps.positions = keep;
    return closed;
  }

  function manage_partial_profits(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || ps.positions.length < 2) return 0;

    const target = meanTarget(ps);
    const mid = Number(ps.mid);
    const spacing = Number(ps.grid.spacing);
    if (![target, mid, spacing].every(Number.isFinite) || spacing <= 0) return 0;

    if (Math.abs(mid - target) > spacing * 0.5) return 0;

    const idx = ps.positions.length - 1;
    const p = ps.positions[idx];
    const closeSize = p.size_lots * 0.5;
    const pnl = p.side === "BUY" ? (mid - p.entry_price) * closeSize : (p.entry_price - mid) * closeSize;

    p.size_lots -= closeSize;
    if (p.size_lots <= 0.000001) ps.positions.splice(idx, 1);

    ps.realized_pnl += pnl;
    state.portfolio.weekly_pnl += pnl;

    if (Logger.log_trade_close) {
      Logger.log_trade_close(state, pair, {
        side: p.side,
        entry_price: p.entry_price,
        exit_price: mid,
        size_lots: closeSize,
        reason_for_exit: "PARTIAL_MEAN_REVERSION",
        pnl
      });
    }

    return 1;
  }

  function manage_grid_positions(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.grid.active) return;

    const mid = Number(ps.mid);
    if (!Number.isFinite(mid)) return;

    for (let i = 0; i < ps.grid.levels.length; i++) {
      const level = ps.grid.levels[i];
      const triggered = (level.side === "BUY" && mid <= level.entry_price) || (level.side === "SELL" && mid >= level.entry_price);
      if (!triggered) continue;

      if (isLive(state)) {
        openLevelLive(state, pair, ps, level);
      } else {
        const opened = openLevelIfTriggered(ps, mid, level);
        if (opened && Logger.log_trade_open) {
          Logger.log_trade_open(state, pair, {
            side: opened.side,
            entry_price: opened.entry_price,
            size_lots: opened.size_lots,
            grid_level: opened.level,
            reason_for_entry: "GRID_LEVEL_TRIGGER"
          });
        }
      }
    }

    manage_partial_profits(state, pair);
    manage_take_profits(state, pair);

    ps.unrealized_pnl = calcUnrealized(ps);
    ps.last_trade_time = Date.now();
    ps.last_trade_direction = ps.grid.side;

    if (ps.positions.length === 0) {
      ps.grid.active = false;
      ps.grid.side = "NONE";
      ps.grid.levels = [];
      GridExecution.cancel_grid_orders(state, pair);
    }
  }

  function close_pair_positions(state, pair, reason) {
    const ps = state.pair_states[pair];
    if (!ps) return 0;

    const mid = Number(ps.mid);
    let closed = 0;

    for (let i = 0; i < ps.positions.length; i++) {
      const p = ps.positions[i];
      if (isLive(state) && Trading && typeof Trading.closeSideOnInstrument === "function") {
        const instrumentId = symbolToInstrument(pair);
        Trading.closeSideOnInstrument(instrumentId, p.side).catch(function () {});
      }
      if (!Number.isFinite(mid)) continue;
      const pnl = p.side === "BUY" ? (mid - p.entry_price) * p.size_lots : (p.entry_price - mid) * p.size_lots;
      ps.realized_pnl += pnl;
      state.portfolio.weekly_pnl += pnl;
      closed += 1;
      if (Logger.log_trade_close) {
        Logger.log_trade_close(state, pair, {
          side: p.side,
          entry_price: p.entry_price,
          exit_price: mid,
          size_lots: p.size_lots,
          reason_for_exit: reason || "FORCED_EXIT",
          pnl
        });
      }
    }

    ps.positions = [];
    ps.unrealized_pnl = 0;
    ps.grid.active = false;
    ps.grid.side = "NONE";
    ps.grid.levels = [];
    GridExecution.cancel_grid_orders(state, pair);
    return closed;
  }

  function close_all_positions(state, reason) {
    const symbols = Object.keys(state.pair_states || {});
    let total = 0;
    for (let i = 0; i < symbols.length; i++) {
      total += close_pair_positions(state, symbols[i], reason || "GLOBAL_FLATTEN");
    }
    return total;
  }

  LCPro.CSVRG.TradeManager = {
    manage_grid_positions,
    manage_take_profits,
    manage_partial_profits,
    close_pair_positions,
    close_all_positions
  };
})();
