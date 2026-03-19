(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Indicators = (LCPro.CSVRG && LCPro.CSVRG.Indicators) || {};
  const CurrencyStrength = (LCPro.CSVRG && LCPro.CSVRG.CurrencyStrength) || {};
  const Session = (LCPro.CSVRG && LCPro.CSVRG.SessionManager) || {};
  const Risk = (LCPro.CSVRG && LCPro.CSVRG.RiskManagement) || {};
  const Logger = (LCPro.CSVRG && LCPro.CSVRG.LoggerAnalytics) || {};
  const Trading = LCPro.Trading || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function toNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function getPairBias(state, pair) {
    const parsed = CurrencyStrength.parsePair ? CurrencyStrength.parsePair(pair) : null;
    if (!parsed) return { valid: false, score: 0, side: "NONE" };

    const scores = state.currency_strength || {};
    const base = toNum(scores[parsed.base], 0);
    const quote = toNum(scores[parsed.quote], 0);
    const score = base - quote;
    const side = score > 0 ? "BUY" : score < 0 ? "SELL" : "NONE";

    return { valid: true, score, side, base: parsed.base, quote: parsed.quote };
  }

  function crossSignal(adxPack) {
    if (!adxPack || !Number.isFinite(adxPack.plusDI) || !Number.isFinite(adxPack.minusDI)) return "NONE";
    if (!Number.isFinite(adxPack.prevPlusDI) || !Number.isFinite(adxPack.prevMinusDI)) return "NONE";

    const buyCross = adxPack.prevPlusDI <= adxPack.prevMinusDI && adxPack.plusDI > adxPack.minusDI;
    const sellCross = adxPack.prevMinusDI <= adxPack.prevPlusDI && adxPack.minusDI > adxPack.plusDI;

    if (buyCross) return "BUY";
    if (sellCross) return "SELL";
    return "NONE";
  }

  function mtfMomentumOk(ps, side, settings) {
    const lookbackM15 = Math.max(2, toNum(settings.mtf_strength_m15_lookback, 3));
    const lookbackH1 = Math.max(1, toNum(settings.mtf_strength_h1_lookback, 2));
    const minM15 = Math.max(0, toNum(settings.mtf_strength_m15_min_momentum, 0));
    const minH1 = Math.max(0, toNum(settings.mtf_strength_h1_min_momentum, 0));

    const m15 = ps.timeframe.M15 || [];
    const h1 = ps.timeframe.H1 || [];
    if (m15.length <= lookbackM15 || h1.length <= lookbackH1) return false;

    const m15Now = toNum(m15[m15.length - 1].c, NaN);
    const m15Prev = toNum(m15[m15.length - 1 - lookbackM15].c, NaN);
    const h1Now = toNum(h1[h1.length - 1].c, NaN);
    const h1Prev = toNum(h1[h1.length - 1 - lookbackH1].c, NaN);
    if (![m15Now, m15Prev, h1Now, h1Prev].every(Number.isFinite)) return false;

    const m15Mom = (m15Now - m15Prev) / Math.max(1e-12, m15Prev);
    const h1Mom = (h1Now - h1Prev) / Math.max(1e-12, h1Prev);

    if (side === "BUY") {
      return m15Mom >= minM15 && h1Mom >= minH1;
    }
    if (side === "SELL") {
      return m15Mom <= -minM15 && h1Mom <= -minH1;
    }
    return false;
  }

  function hasRecentFvg(ps, side, maxAgeBars) {
    const m5 = ps.timeframe.M5 || [];
    if (m5.length < 6) return false;

    const latestIdx = m5.length - 1;
    const startIdx = Math.max(2, latestIdx - Math.max(2, maxAgeBars));

    for (let i = latestIdx; i >= startIdx; i--) {
      const c0 = m5[i - 2];
      const c1 = m5[i - 1];
      const c2 = m5[i];
      if (!c0 || !c1 || !c2) continue;

      const low0 = toNum(c0.l, NaN);
      const high0 = toNum(c0.h, NaN);
      const low2 = toNum(c2.l, NaN);
      const high2 = toNum(c2.h, NaN);
      if (![low0, high0, low2, high2].every(Number.isFinite)) continue;

      const bullishFvg = low2 > high0;
      const bearishFvg = high2 < low0;
      if (side === "BUY" && bullishFvg) return true;
      if (side === "SELL" && bearishFvg) return true;
    }

    return false;
  }

  function buildTradePlan(state, pair, side) {
    const ps = state.pair_states[pair];
    if (!ps) return null;

    const m5 = ps.timeframe.M5 || [];
    const closes = Indicators.closeSeries ? Indicators.closeSeries(m5) : [];
    const bb = Indicators.bollinger ? Indicators.bollinger(closes, state.settings.signal_bb_period, state.settings.signal_bb_stddev) : null;
    const atr = Indicators.atr ? Indicators.atr(m5, state.settings.signal_atr_period) : null;

    const entry = toNum(ps.mid, NaN);
    const atrValue = toNum(atr, NaN);
    if (![entry, atrValue].every(Number.isFinite) || atrValue <= 0) return null;

    const slAtrMult = Math.max(0.3, toNum(state.settings.signal_sl_atr_mult, 1.0));
    const rr = Math.max(0.4, toNum(state.settings.signal_tp_rr, 1.2));

    const slDist = atrValue * slAtrMult;
    const tpDist = slDist * rr;

    const sl = side === "BUY" ? entry - slDist : entry + slDist;
    const tp = side === "BUY" ? entry + tpDist : entry - tpDist;

    return {
      side,
      entry,
      sl,
      tp,
      size_lots: Math.max(0.01, toNum(state.settings.signal_trade_lot, state.settings.base_grid_lot || 0.01)),
      opened_at: Date.now(),
      opened_cycle: Number(state.cycle_timestamp || Date.now()),
      trailing_ref: bb || null,
      source: "STRENGTH_MTF_SIGNAL"
    };
  }

  function isLive(state) {
    return String((state && state.settings && state.settings.execution_mode) || "paper").toLowerCase() === "live";
  }

  function symbolToInstrument(symbol) {
    const s = String(symbol || "").replace(/\//g, "").toUpperCase();
    if (s.length !== 6) return symbol;
    return s.slice(0, 3) + "/" + s.slice(3);
  }

  function check_entry(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return { allowed: false, reason: "NO_PAIR" };
    if (!state.settings.mtf_signal_enabled) return { allowed: false, reason: "DISABLED" };
    if (!state.bot_enabled) return { allowed: false, reason: "BOT_DISABLED" };
    if (!Session.is_valid_session(state.settings, Date.now())) return { allowed: false, reason: "SESSION" };
    if (ps.disabled_until_reset) return { allowed: false, reason: "PAIR_DISABLED" };
    if (!Risk.check_spread_safety(state, pair)) return { allowed: false, reason: "SPREAD" };

    if (ps.signal_trade && ps.signal_trade.active) return { allowed: false, reason: "TRADE_ACTIVE" };
    if (state.settings.mtf_strategy_exclusive && (ps.grid.active || ps.scalp.active || ps.positions.length > 0)) {
      return { allowed: false, reason: "EXCLUSIVE_BUSY" };
    }

    const m5 = ps.timeframe.M5 || [];
    if (m5.length < 60) return { allowed: false, reason: "M5_DATA" };

    const closes = Indicators.closeSeries ? Indicators.closeSeries(m5) : [];
    const rsi = Indicators.rsi ? Indicators.rsi(closes, state.settings.signal_rsi_period) : null;
    const adxPack = Indicators.adxComponents ? Indicators.adxComponents(m5, state.settings.signal_adx_period) : null;
    const signal = crossSignal(adxPack);
    if (signal === "NONE") return { allowed: false, reason: "NO_ADX_CROSS" };

    const adxNow = toNum(adxPack && adxPack.adx, NaN);
    if (!Number.isFinite(adxNow) || adxNow < Math.max(8, toNum(state.settings.signal_adx_min, 18))) {
      return { allowed: false, reason: "ADX_LOW" };
    }

    const rsiNow = toNum(rsi, NaN);
    const buyMax = Math.min(80, toNum(state.settings.signal_rsi_buy_max, 60));
    const sellMin = Math.max(20, toNum(state.settings.signal_rsi_sell_min, 40));
    if (!Number.isFinite(rsiNow)) return { allowed: false, reason: "RSI_INVALID" };
    if (signal === "BUY" && rsiNow > buyMax) return { allowed: false, reason: "RSI_FILTER" };
    if (signal === "SELL" && rsiNow < sellMin) return { allowed: false, reason: "RSI_FILTER" };

    const pairBias = getPairBias(state, pair);
    const minStrengthDiff = Math.max(0, toNum(state.settings.signal_strength_min_diff, 0.0006));
    if (!pairBias.valid || Math.abs(pairBias.score) < minStrengthDiff) {
      return { allowed: false, reason: "STRENGTH_WEAK" };
    }
    if (signal !== pairBias.side) {
      return { allowed: false, reason: "STRENGTH_MISMATCH" };
    }

    if (!mtfMomentumOk(ps, signal, state.settings)) {
      return { allowed: false, reason: "MTF_MISMATCH" };
    }

    if (state.settings.signal_use_fvg_filter) {
      const maxFvgAge = Math.max(2, toNum(state.settings.signal_fvg_max_age_bars, 10));
      if (!hasRecentFvg(ps, signal, maxFvgAge)) {
        return { allowed: false, reason: "NO_FVG" };
      }
    }

    return {
      allowed: true,
      side: signal,
      diagnostics: {
        rsi: rsiNow,
        adx: adxNow,
        plusDI: toNum(adxPack && adxPack.plusDI, NaN),
        minusDI: toNum(adxPack && adxPack.minusDI, NaN),
        strengthScore: pairBias.score,
        biasBase: pairBias.base,
        biasQuote: pairBias.quote
      }
    };
  }

  function open_trade(state, pair, side, diagnostics) {
    const ps = state.pair_states[pair];
    if (!ps) return false;

    const plan = buildTradePlan(state, pair, side);
    if (!plan) return false;

    ps.signal_trade = {
      active: true,
      side: plan.side,
      entry_price: plan.entry,
      sl_price: plan.sl,
      tp_price: plan.tp,
      size_lots: plan.size_lots,
      opened_at: plan.opened_at,
      diagnostics: diagnostics || null
    };

    ps.positions.push({
      side: plan.side,
      entry_price: plan.entry,
      size_lots: plan.size_lots,
      opened_at: plan.opened_at,
      source: plan.source
    });

    if (isLive(state) && Trading && typeof Trading.executeAction === "function") {
      const instrumentId = symbolToInstrument(pair);
      Trading.executeAction(side, {
        instrumentId,
        lots: plan.size_lots
      }).catch(function () {});
    }

    if (Logger.log_trade_open) {
      Logger.log_trade_open(state, pair, {
        side: plan.side,
        entry_price: plan.entry,
        size_lots: plan.size_lots,
        tp: plan.tp,
        sl: plan.sl,
        reason_for_entry: "CS_MTF_ADX_RSI_SIGNAL",
        diagnostics: diagnostics || null
      });
    }

    return true;
  }

  function updateTrailing(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.signal_trade || !ps.signal_trade.active) return;

    const m5 = ps.timeframe.M5 || [];
    const closes = Indicators.closeSeries ? Indicators.closeSeries(m5) : [];
    const bb = Indicators.bollinger
      ? Indicators.bollinger(closes, state.settings.signal_bb_period, state.settings.signal_bb_stddev)
      : null;
    if (!bb) return;

    const t = ps.signal_trade;
    const atr = Indicators.atr ? Indicators.atr(m5, state.settings.signal_atr_period) : null;
    const atrTrail = Math.max(0, toNum(state.settings.signal_trail_atr_buffer, 0.2)) * Math.max(0, toNum(atr, 0));

    if (t.side === "BUY") {
      const nextSl = toNum(bb.middle, t.sl_price) - atrTrail;
      if (Number.isFinite(nextSl) && nextSl > t.sl_price) t.sl_price = nextSl;
      const nextTp = toNum(bb.upper, t.tp_price);
      if (Number.isFinite(nextTp) && nextTp > t.entry_price) t.tp_price = Math.max(t.tp_price, nextTp);
    } else if (t.side === "SELL") {
      const nextSl = toNum(bb.middle, t.sl_price) + atrTrail;
      if (Number.isFinite(nextSl) && nextSl < t.sl_price) t.sl_price = nextSl;
      const nextTp = toNum(bb.lower, t.tp_price);
      if (Number.isFinite(nextTp) && nextTp < t.entry_price) t.tp_price = Math.min(t.tp_price, nextTp);
    }
  }

  function close_trade(state, pair, reason) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.signal_trade || !ps.signal_trade.active) return false;

    const t = ps.signal_trade;
    const mid = toNum(ps.mid, NaN);
    if (!Number.isFinite(mid)) return false;

    const pnl = t.side === "BUY" ? (mid - t.entry_price) * t.size_lots : (t.entry_price - mid) * t.size_lots;
    ps.realized_pnl += pnl;
    state.portfolio.weekly_pnl += pnl;

    ps.positions = ps.positions.filter(function (p) {
      return p.source !== "STRENGTH_MTF_SIGNAL";
    });

    ps.signal_trade = {
      active: false,
      side: "NONE",
      entry_price: null,
      sl_price: null,
      tp_price: null,
      size_lots: 0,
      opened_at: null,
      diagnostics: null
    };

    if (isLive(state) && Trading && typeof Trading.executeAction === "function") {
      const instrumentId = symbolToInstrument(pair);
      Trading.executeAction("CLOSE_SIDE", { instrumentId, side: t.side }).catch(function () {});
    }

    if (Logger.log_trade_close) {
      Logger.log_trade_close(state, pair, {
        side: t.side,
        entry_price: t.entry_price,
        exit_price: mid,
        size_lots: t.size_lots,
        reason_for_exit: reason || "SIGNAL_EXIT",
        pnl
      });
    }

    return true;
  }

  function manage_trade(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.signal_trade || !ps.signal_trade.active) return false;

    updateTrailing(state, pair);

    const t = ps.signal_trade;
    const mid = toNum(ps.mid, NaN);
    if (!Number.isFinite(mid)) return false;

    if (t.side === "BUY" && mid <= t.sl_price) return close_trade(state, pair, "SIGNAL_SL");
    if (t.side === "BUY" && mid >= t.tp_price) return close_trade(state, pair, "SIGNAL_TP");
    if (t.side === "SELL" && mid >= t.sl_price) return close_trade(state, pair, "SIGNAL_SL");
    if (t.side === "SELL" && mid <= t.tp_price) return close_trade(state, pair, "SIGNAL_TP");

    const maxMinutes = Math.max(10, toNum(state.settings.signal_max_trade_minutes, 180));
    if (Date.now() - Number(t.opened_at || 0) >= maxMinutes * 60000) {
      return close_trade(state, pair, "SIGNAL_TIMEOUT");
    }

    const activePnl = t.side === "BUY" ? (mid - t.entry_price) * t.size_lots : (t.entry_price - mid) * t.size_lots;
    ps.unrealized_pnl = activePnl;
    return false;
  }

  LCPro.CSVRG.StrengthMtfStrategy = {
    check_entry,
    open_trade,
    manage_trade,
    close_trade
  };
})();
