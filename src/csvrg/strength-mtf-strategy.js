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

  function candleBarKey(candle) {
    if (!candle || typeof candle !== "object") return "";
    const t = candle.t || candle.time || candle.ts || candle.timestamp || null;
    if (t !== null && t !== undefined) return String(t);
    const o = toNum(candle.o, NaN);
    const h = toNum(candle.h, NaN);
    const l = toNum(candle.l, NaN);
    const c = toNum(candle.c, NaN);
    return [o, h, l, c].map((v) => (Number.isFinite(v) ? String(v) : "na")).join("|");
  }

  function closedCandleSignal(m5) {
    if (!Array.isArray(m5) || m5.length < 4) return { side: "NONE", barKey: "", reason: "M5_DATA" };

    const latestClosed = m5[m5.length - 2];
    const prevClosed = m5[m5.length - 3];
    if (!latestClosed || !prevClosed) return { side: "NONE", barKey: "", reason: "M5_DATA" };

    const closeNow = toNum(latestClosed.c, NaN);
    const closePrev = toNum(prevClosed.c, NaN);
    if (![closeNow, closePrev].every(Number.isFinite)) {
      return { side: "NONE", barKey: "", reason: "M5_CLOSE_INVALID" };
    }

    const side = closeNow > closePrev ? "BUY" : closeNow < closePrev ? "SELL" : "NONE";
    return {
      side,
      barKey: candleBarKey(latestClosed),
      closeNow,
      closePrev
    };
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

  function pivotLow(candles, idx, left, right) {
    const c = candles[idx];
    if (!c) return false;
    const low = toNum(c.l, NaN);
    if (!Number.isFinite(low)) return false;
    for (let i = idx - left; i <= idx + right; i++) {
      if (i === idx || i < 0 || i >= candles.length) continue;
      const cmp = toNum(candles[i].l, NaN);
      if (!Number.isFinite(cmp) || cmp <= low) return false;
    }
    return true;
  }

  function pivotHigh(candles, idx, left, right) {
    const c = candles[idx];
    if (!c) return false;
    const high = toNum(c.h, NaN);
    if (!Number.isFinite(high)) return false;
    for (let i = idx - left; i <= idx + right; i++) {
      if (i === idx || i < 0 || i >= candles.length) continue;
      const cmp = toNum(candles[i].h, NaN);
      if (!Number.isFinite(cmp) || cmp >= high) return false;
    }
    return true;
  }

  function buildZone(kind, candles, idx, atrValue) {
    const c = candles[idx];
    if (!c) return null;
    const open = toNum(c.o, NaN);
    const close = toNum(c.c, NaN);
    const high = toNum(c.h, NaN);
    const low = toNum(c.l, NaN);
    if (![open, close, high, low].every(Number.isFinite)) return null;

    if (kind === "demand") {
      return {
        kind,
        startIdx: idx,
        low,
        high: Math.max(open, close),
        pivotPrice: low,
        atr: atrValue
      };
    }

    return {
      kind,
      startIdx: idx,
      low: Math.min(open, close),
      high,
      pivotPrice: high,
      atr: atrValue
    };
  }

  function zoneDisplacementOk(kind, candles, idx, atrValue, departureBars, minDepartureAtr) {
    if (!Number.isFinite(atrValue) || atrValue <= 0) return false;
    const pivot = candles[idx];
    if (!pivot) return false;
    const ref = kind === "demand" ? toNum(pivot.h, NaN) : toNum(pivot.l, NaN);
    if (!Number.isFinite(ref)) return false;

    for (let i = idx + 1; i <= Math.min(candles.length - 1, idx + departureBars); i++) {
      const c = candles[i];
      if (!c) continue;
      const close = toNum(c.c, NaN);
      if (!Number.isFinite(close)) continue;
      const move = kind === "demand" ? close - ref : ref - close;
      if (move >= atrValue * minDepartureAtr) return true;
    }
    return false;
  }

  function zoneStillFresh(zone, candles, freshnessBars) {
    if (!zone) return false;
    const latestIdx = candles.length - 1;
    if (latestIdx - zone.startIdx > freshnessBars) return false;
    for (let i = zone.startIdx + 1; i <= latestIdx; i++) {
      const c = candles[i];
      if (!c) continue;
      const low = toNum(c.l, NaN);
      const high = toNum(c.h, NaN);
      if (zone.kind === "demand" && Number.isFinite(low) && low < zone.low) return false;
      if (zone.kind === "supply" && Number.isFinite(high) && high > zone.high) return false;
    }
    return true;
  }

  function findActiveZone(candles, kind, settings) {
    if (!Array.isArray(candles) || candles.length < 20) return null;
    const closes = Indicators.closeSeries ? Indicators.closeSeries(candles) : [];
    const atrValue = Indicators.atr ? Indicators.atr(candles, settings.signal_atr_period) : null;
    const lookback = Math.max(20, toNum(settings.signal_sd_lookback_bars, 80));
    const left = Math.max(1, toNum(settings.signal_sd_pivot_left, 2));
    const right = Math.max(1, toNum(settings.signal_sd_pivot_right, 2));
    const departureBars = Math.max(2, toNum(settings.signal_sd_departure_bars, 6));
    const minDepartureAtr = Math.max(0.1, toNum(settings.signal_sd_departure_atr, 0.6));
    const freshnessBars = Math.max(6, toNum(settings.signal_sd_freshness_bars, 36));
    if (!closes.length || !Number.isFinite(atrValue) || atrValue <= 0) return null;

    const latestIdx = candles.length - 1;
    const startIdx = Math.max(left, latestIdx - lookback);
    let best = null;
    for (let idx = latestIdx - right; idx >= startIdx; idx--) {
      const isPivot = kind === "demand" ? pivotLow(candles, idx, left, right) : pivotHigh(candles, idx, left, right);
      if (!isPivot) continue;
      if (!zoneDisplacementOk(kind, candles, idx, atrValue, departureBars, minDepartureAtr)) continue;
      const zone = buildZone(kind, candles, idx, atrValue);
      if (!zone) continue;
      if (!zoneStillFresh(zone, candles, freshnessBars)) continue;
      best = zone;
      break;
    }
    return best;
  }

  function detectSupplyDemand(ps, settings) {
    const m5 = ps.timeframe.M5 || [];
    const demand = findActiveZone(m5, "demand", settings);
    const supply = findActiveZone(m5, "supply", settings);
    ps.supply_demand = {
      demand,
      supply,
      last_updated_at: Date.now()
    };
    return ps.supply_demand;
  }

  function priceNearZone(side, price, zone, settings) {
    if (!zone || !Number.isFinite(price)) return false;
    const buffer = Math.max(0, toNum(settings.signal_sd_entry_atr_buffer, 0.2)) * Math.max(0, toNum(zone.atr, 0));
    if (side === "BUY") {
      return price >= zone.low - buffer && price <= zone.high + buffer;
    }
    if (side === "SELL") {
      return price >= zone.low - buffer && price <= zone.high + buffer;
    }
    return false;
  }

  function reclaimEntryOk(ps, side, settings) {
    const m5 = ps.timeframe.M5 || [];
    const closes = Indicators.closeSeries ? Indicators.closeSeries(m5) : [];
    const atr = Indicators.atr ? Indicators.atr(m5, settings.signal_atr_period) : null;
    if (!Array.isArray(m5) || m5.length < 30 || !Number.isFinite(atr) || atr <= 0) {
      return { ok: false, reason: "RECLAIM_DATA" };
    }

    const lookback = Math.max(3, toNum(settings.signal_entry_reclaim_lookback_bars, 6));
    const minBodyAtr = Math.max(0, toNum(settings.signal_entry_reclaim_min_body_atr, 0.1));
    const crossBufferAtr = Math.max(0, toNum(settings.signal_entry_reclaim_cross_buffer_atr, 0.05));
    const crossBuffer = atr * crossBufferAtr;

    const latestIdx = m5.length - 2;
    const prevIdx = latestIdx - 1;
    if (prevIdx < 0) return { ok: false, reason: "RECLAIM_DATA" };

    const latest = m5[latestIdx];
    const prev = m5[prevIdx];
    if (!latest || !prev) return { ok: false, reason: "RECLAIM_DATA" };

    const latestOpen = toNum(latest.o, NaN);
    const latestClose = toNum(latest.c, NaN);
    const prevClose = toNum(prev.c, NaN);
    const prevHigh = toNum(prev.h, NaN);
    const prevLow = toNum(prev.l, NaN);
    if (![latestOpen, latestClose, prevClose, prevHigh, prevLow].every(Number.isFinite)) {
      return { ok: false, reason: "RECLAIM_DATA" };
    }

    const body = Math.abs(latestClose - latestOpen);
    if (body < atr * minBodyAtr) {
      return { ok: false, reason: "RECLAIM_WEAK_BODY" };
    }

    const useEma = settings.signal_entry_reclaim_use_ema !== false;
    let trendRef = NaN;
    if (useEma) {
      const emaPeriod = Math.max(5, toNum(settings.signal_entry_reclaim_ema_period, 20));
      trendRef = Indicators.ema ? Indicators.ema(closes, emaPeriod) : NaN;
    } else {
      const bb = Indicators.bollinger
        ? Indicators.bollinger(closes, settings.signal_bb_period, settings.signal_bb_stddev)
        : null;
      trendRef = toNum(bb && bb.middle, NaN);
    }
    if (!Number.isFinite(trendRef)) return { ok: false, reason: "RECLAIM_TREND_REF" };

    const start = Math.max(0, latestIdx - lookback);
    let pullbackSeen = false;
    for (let i = start; i <= prevIdx; i++) {
      const c = m5[i];
      if (!c) continue;
      const close = toNum(c.c, NaN);
      const low = toNum(c.l, NaN);
      const high = toNum(c.h, NaN);
      if (side === "BUY" && (close <= trendRef + crossBuffer || low <= trendRef + crossBuffer)) {
        pullbackSeen = true;
        break;
      }
      if (side === "SELL" && (close >= trendRef - crossBuffer || high >= trendRef - crossBuffer)) {
        pullbackSeen = true;
        break;
      }
    }
    if (!pullbackSeen) return { ok: false, reason: "RECLAIM_NO_PULLBACK" };

    if (side === "BUY") {
      const closeBackInTrend = latestClose > trendRef + crossBuffer;
      const crossedBack = prevClose <= trendRef + crossBuffer;
      const brokeStructure = latestClose > prevHigh;
      if (!closeBackInTrend || !crossedBack || !brokeStructure) {
        return { ok: false, reason: "RECLAIM_PATTERN" };
      }
    } else if (side === "SELL") {
      const closeBackInTrend = latestClose < trendRef - crossBuffer;
      const crossedBack = prevClose >= trendRef - crossBuffer;
      const brokeStructure = latestClose < prevLow;
      if (!closeBackInTrend || !crossedBack || !brokeStructure) {
        return { ok: false, reason: "RECLAIM_PATTERN" };
      }
    } else {
      return { ok: false, reason: "RECLAIM_SIDE" };
    }

    return {
      ok: true,
      trendRef,
      body,
      atr,
      pullbackSeen
    };
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
    const signalCandle = m5[m5.length - 1] || null;
    const signalLow = toNum(signalCandle && signalCandle.l, NaN);
    const signalHigh = toNum(signalCandle && signalCandle.h, NaN);
    const atrFallbackDist = atrValue * slAtrMult;

    let sl = NaN;
    if (side === "BUY" && Number.isFinite(signalLow)) sl = signalLow;
    if (side === "SELL" && Number.isFinite(signalHigh)) sl = signalHigh;

    if (!Number.isFinite(sl)) {
      sl = side === "BUY" ? entry - atrFallbackDist : entry + atrFallbackDist;
    }

    let slDist = Math.abs(entry - sl);
    if (!Number.isFinite(slDist) || slDist <= 0) {
      slDist = atrFallbackDist;
      sl = side === "BUY" ? entry - slDist : entry + slDist;
    }

    const tpDist = slDist * rr;
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

    const closedSignal = closedCandleSignal(m5);
    if (closedSignal.side === "NONE") return { allowed: false, reason: closedSignal.reason || "NO_CANDLE_SIGNAL" };
    if (closedSignal.barKey && ps.signal_last_entry_bar_key === closedSignal.barKey) {
      return { allowed: false, reason: "WAIT_CANDLE_CLOSE" };
    }

    const closes = Indicators.closeSeries ? Indicators.closeSeries(m5) : [];
    const rsi = Indicators.rsi ? Indicators.rsi(closes, state.settings.signal_rsi_period) : null;
    const adxPack = Indicators.adxComponents ? Indicators.adxComponents(m5, state.settings.signal_adx_period) : null;
    const signal = closedSignal.side;

    const adxNow = toNum(adxPack && adxPack.adx, NaN);

    const rsiNow = toNum(rsi, NaN);
    const buyMin = toNum(state.settings.signal_rsi_buy_max, 50);
    const sellMax = toNum(state.settings.signal_rsi_sell_min, 50);
    if (!Number.isFinite(rsiNow)) return { allowed: false, reason: "RSI_INVALID" };
    if (signal === "BUY" && rsiNow < buyMin) return { allowed: false, reason: "RSI_BASIS" };
    if (signal === "SELL" && rsiNow > sellMax) return { allowed: false, reason: "RSI_BASIS" };

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

    if (state.settings.signal_entry_reclaim_enabled !== false) {
      const reclaim = reclaimEntryOk(ps, signal, state.settings);
      if (!reclaim.ok) {
        return { allowed: false, reason: reclaim.reason || "RECLAIM_FILTER" };
      }
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
        barKey: closedSignal.barKey,
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

    if (diagnostics && diagnostics.barKey) {
      ps.signal_last_entry_bar_key = String(diagnostics.barKey);
    }

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
    if (!m5.length) return;

    const t = ps.signal_trade;
    const atr = Indicators.atr ? Indicators.atr(m5, state.settings.signal_atr_period) : null;
    const atrTrail = Math.max(0, toNum(state.settings.signal_trail_atr_buffer, 0.2)) * Math.max(0, toNum(atr, 0));
    const lb = Math.max(1, toNum(state.settings.signal_trail_candle_lookback, 2));
    const start = Math.max(0, m5.length - lb);

    if (t.side === "BUY") {
      let trailLow = Infinity;
      for (let i = start; i < m5.length; i++) {
        const low = toNum(m5[i] && m5[i].l, NaN);
        if (Number.isFinite(low) && low < trailLow) trailLow = low;
      }
      const nextSl = trailLow - atrTrail;
      if (Number.isFinite(nextSl) && nextSl > t.sl_price) t.sl_price = nextSl;
    } else if (t.side === "SELL") {
      let trailHigh = -Infinity;
      for (let i = start; i < m5.length; i++) {
        const high = toNum(m5[i] && m5[i].h, NaN);
        if (Number.isFinite(high) && high > trailHigh) trailHigh = high;
      }
      const nextSl = trailHigh + atrTrail;
      if (Number.isFinite(nextSl) && nextSl < t.sl_price) t.sl_price = nextSl;
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
