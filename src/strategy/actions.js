(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function toPosInt(v, fallback, minValue) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    const min = Number.isFinite(minValue) ? Number(minValue) : 1;
    return Math.max(min, n);
  }

  function toNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function uniqueSorted(arr) {
    const set = new Set(arr.filter((v) => Number.isFinite(v)));
    return Array.from(set).sort((a, b) => a - b);
  }

  function spreadInts(center, offsets, min, max) {
    return uniqueSorted(offsets.map((d) => Math.round(center + d)).filter((v) => v >= min && v <= max));
  }

  function spreadFloats(center, multipliers, min, max, step) {
    const vals = multipliers
      .map((m) => Math.round((center * m) / step) * step)
      .map((v) => Number(v.toFixed(6)))
      .filter((v) => v >= min && v <= max);
    return uniqueSorted(vals);
  }

  function runSmaCrossover(input) {
    const params = input && input.params ? input.params : {};
    const fastLen = toPosInt(params.fastLen, 9, 2);
    const slowLen = toPosInt(params.slowLen, 21, 3);
    const keepN = toPosInt(input && input.keepN, 5, 1);

    return window.LCPro.Backtest.lastCrossSignals(input.instrumentId, input.timeframeSec, input.lookback, fastLen, slowLen, keepN);
  }

  async function runNas100HybridScalper(input) {
    const p = (input && input.params) || {};
    const timeZone = p.timeZone || "America/Chicago";
    const sessionStartMin = parseHmToMinutes(p.sessionStart || "09:35", "09:35");
    const sessionEndMin = parseHmToMinutes(p.sessionEnd || "11:30", "11:30");
    const altSessionStartMin = parseHmToMinutes(p.altSessionStart || "14:00", "14:00");
    const altSessionEndMin = parseHmToMinutes(p.altSessionEnd || "15:30", "15:30");
    const useAltSession = p.useAltSession === true;
    const allowAltSession = p.allowAltSession !== false;
    const skipFirstMinutes = toPosInt(p.skipFirstMinutes, 5, 1);
    const m5EmaFast = toPosInt(p.m5EmaFast, 20, 5);
    const m5EmaSlow = toPosInt(p.m5EmaSlow, 50, 10);
    const m5AdxLen = toPosInt(p.m5AdxLen, 14, 5);
    const m5AdxThreshold = Math.max(15, toNum(p.m5AdxThreshold, 22));
    const trendBurstMode = p.trendBurstMode !== false;
    const wickRejectionMode = p.wickRejectionMode !== false;
    const pullbackRetraceMax = Math.max(0.1, Math.min(0.9, toNum(p.pullbackRetraceMax, 0.45)));
    const minCandleRangePoints = Math.max(0, toNum(p.minCandleRangePoints, 2));
    const consolidationLookback = Math.max(3, toPosInt(p.consolidationLookback, 10, 3));
    const maxConsolidationRange = Math.max(1, toNum(p.maxConsolidationRange, 6));
    const minAdxForEntry = Math.max(15, toNum(p.minAdxForEntry, 20));

    const keepN = toPosInt(input && input.keepN, 25, 1);
    const m5Msg = await window.LCPro.MarketData.requestCandles(input.instrumentId, 300, input.lookback * 5);
    const m5Candles = m5Msg && m5Msg.candles ? m5Msg.candles : [];
    if (!m5Candles.length) return [];

    const signals = [];
    const closes = m5Candles.map((c) => Number(c.c));
    const highs = m5Candles.map((c) => Number(c.h));
    const lows = m5Candles.map((c) => Number(c.l));
    const opens = m5Candles.map((c) => Number(c.o));
    const ema5 = emaSeries(closes, m5EmaFast);
    const ema20 = emaSeries(closes, m5EmaSlow);

    for (let i = m5AdxLen + consolidationLookback; i < m5Candles.length; i++) {
      const candleMs = candleTimeMs(m5Candles[i]);
      const minOfDay = chicagoMinutesOfDay(candleMs, timeZone);
      let inSession = minOfDay >= sessionStartMin && minOfDay <= sessionEndMin;
      if (allowAltSession && minOfDay >= altSessionStartMin && minOfDay <= altSessionEndMin) {
        inSession = useAltSession ? true : inSession;
      }
      if (!inSession || minOfDay - sessionStartMin < skipFirstMinutes) continue;

      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      const open = opens[i];
      const emaFast = ema5[i];
      const emaSlow = ema20[i];
      if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(emaFast) || !Number.isFinite(emaSlow)) continue;

      const candleRange = high - low;
      if (candleRange < minCandleRangePoints) continue;

      const isConsolidating = isInConsolidation(closes, highs, lows, i, consolidationLookback, maxConsolidationRange);
      if (isConsolidating) continue;

      const bullBias = emaFast > emaSlow && close > emaFast;
      const bearBias = emaFast < emaSlow && close < emaFast;

      let signal = null;

      if (trendBurstMode && bullBias && i > consolidationLookback) {
        const pullback = analyzePullback(closes, highs, lows, i, pullbackRetraceMax);
        if (pullback.isPullback && pullback.pullbackLow < emaFast && pullback.pullbackLow > emaSlow) {
          if (high > emaFast && close > emaFast) {
            signal = { type: "BUY", price: high, time: candleMs, label: "TREND_BURST_BULL" };
          }
        }
      } else if (trendBurstMode && bearBias && i > consolidationLookback) {
        const pullback = analyzePullback(closes, highs, lows, i, pullbackRetraceMax);
        if (pullback.isPullback && pullback.pullbackHigh > emaFast && pullback.pullbackHigh < emaSlow) {
          if (low < emaFast && close < emaFast) {
            signal = { type: "SELL", price: low, time: candleMs, label: "TREND_BURST_BEAR" };
          }
        }
      }

      if (!signal && wickRejectionMode && bullBias && i > 2) {
        const prevWick = lows[i - 1] < opens[i - 1] ? (opens[i - 1] - lows[i - 1]) / candleRange : 0;
        if (prevWick > 0.3 && close > opens[i - 1] && high > highs[i - 1]) {
          signal = { type: "BUY", price: high, time: candleMs, label: "WICK_REJECTION_BULL" };
        }
      } else if (!signal && wickRejectionMode && bearBias && i > 2) {
        const prevWick = highs[i - 1] > opens[i - 1] ? (highs[i - 1] - opens[i - 1]) / candleRange : 0;
        if (prevWick > 0.3 && close < opens[i - 1] && low < lows[i - 1]) {
          signal = { type: "SELL", price: low, time: candleMs, label: "WICK_REJECTION_BEAR" };
        }
      }

      if (signal) {
        signals.push(signal);
        if (signals.length >= keepN) break;
      }
    }

    return signals;
  }

  function isInConsolidation(closes, highs, lows, idx, lookback, maxRange) {
    const start = Math.max(0, idx - lookback + 1);
    let minH = Infinity;
    let maxL = -Infinity;
    for (let i = start; i <= idx; i++) {
      const h = Number(highs[i]);
      const l = Number(lows[i]);
      if (Number.isFinite(h) && h < minH) minH = h;
      if (Number.isFinite(l) && l > maxL) maxL = l;
    }
    return Number.isFinite(minH) && Number.isFinite(maxL) && minH - maxL <= maxRange;
  }

  function analyzePullback(closes, highs, lows, idx, retraceMax) {
    let pullbackHigh = -Infinity;
    let pullbackLow = Infinity;
    const direction = closes[idx] > closes[idx - 1] ? "up" : "down";

    for (let i = Math.max(0, idx - 15); i < idx; i++) {
      if (direction === "up" && (i === idx - 1 || (closes[i] > closes[i - 1] && lows[i] < lows[idx - 1]))) {
        pullbackLow = Math.min(pullbackLow, lows[i]);
      }
      if (direction === "down" && (i === idx - 1 || (closes[i] < closes[i - 1] && highs[i] > highs[idx - 1]))) {
        pullbackHigh = Math.max(pullbackHigh, highs[i]);
      }
    }

    const isPullback = direction === "up" ? pullbackLow < lows[idx - 1] : pullbackHigh > highs[idx - 1];
    return { isPullback, pullbackHigh, pullbackLow };
  }

  async function runNas100VwapLiquiditySweepScalper(input) {
    const p = (input && input.params) || {};
    const set = await window.LCPro.Backtest.buildNas100VwapLiquiditySweepSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 25, 1),
      rangePreset: input.rangePreset || "week",
      timeZone: p.timeZone || "America/Chicago",
      sessionStart: p.session_start || "08:30",
      sessionEnd: p.session_end || "11:30",
      minSwingLookbackCandles: toPosInt(p.min_swing_lookback_candles, 5, 2),
      maxSwingLookbackCandles: toPosInt(p.max_swing_lookback_candles, 15, 3),
      pivotLeftRight: toPosInt(p.pivot_left_right, 2, 1),
      minSweepPoints: Math.max(0, toNum(p.min_sweep_points, 3)),
      displacementBodyMultiplier: Math.max(0.5, toNum(p.displacement_body_multiplier, 1.3)),
      displacementLookback: toPosInt(p.displacement_lookback, 10, 3),
      displacementCloseBand: Math.min(0.49, Math.max(0.05, toNum(p.displacement_close_band, 0.3))),
      minVolumeRatio: Math.max(0, toNum(p.min_volume_ratio, 0)),
      tickSize: Math.max(0.00001, toNum(p.tick_size, 1)),
      allowLong: p.allow_long !== false,
      allowShort: p.allow_short !== false,
      fvgEnabled: p.enable_fvg_filter !== false,
      debug: !!p.debug_mode
    });
    return set.signals || [];
  }

  async function runNas100RsiSrStochScalper(input) {
    const p = (input && input.params) || {};
    const set = await window.LCPro.Backtest.buildNas100RsiSrStochSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 50, 1),
      rangePreset: input.rangePreset || "week",
      rsiLen: toPosInt(p.rsiLen, 14, 2),
      trendEmaLen: toPosInt(p.trendEmaLen, 50, 5),
      fastEmaLen: toPosInt(p.fastEmaLen, 9, 2),
      slowEmaLen: toPosInt(p.slowEmaLen, 21, 3),
      stochLen: toPosInt(p.stochLen, 14, 3),
      stochSmoothK: toPosInt(p.stochSmoothK, 3, 1),
      stochSmoothD: toPosInt(p.stochSmoothD, 3, 1),
      stochLower: Math.max(1, toNum(p.stochLower, 40)),
      stochUpper: Math.min(99, toNum(p.stochUpper, 65)),
      rsiBuyMax: Math.max(1, toNum(p.rsiBuyMax, 50)),
      rsiSellMin: Math.min(99, toNum(p.rsiSellMin, 50)),
      srLookback: toPosInt(p.srLookback, 20, 5),
      srBufferTicks: Math.max(0, toNum(p.srBufferTicks, 4)),
      trendSlopeBars: toPosInt(p.trendSlopeBars, 3, 1),
      cooldownBars: toPosInt(p.cooldownBars, 1, 0),
      tickSize: Math.max(0.00001, toNum(p.tickSize, 1))
    });
    return set.signals || [];
  }

  function getDayKey(ms, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const parts = dtf.formatToParts(new Date(ms));
    const map = {};
    for (let i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
    return String(map.year || "0000") + "-" + String(map.month || "00") + "-" + String(map.day || "00");
  }

  function getEntryFromMode(mode, setup, candle, side, biasOk) {
    const h = Number(candle.h);
    const l = Number(candle.l);
    if (!Number.isFinite(h) || !Number.isFinite(l)) return { ok: false, reason: "bad_candle" };

    const tryBreakout = mode === "breakout_only" || mode === "both";
    const tryFvg = mode === "fvg_retest_only" || mode === "both";

    if (!biasOk) return { ok: false, reason: "vwap_bias_failed" };

    if (tryBreakout) {
      if (side === "BUY" && h >= Number(setup.displacementHigh)) {
        return { ok: true, reason: "breakout", entryPrice: Number(setup.displacementHigh) };
      }
      if (side === "SELL" && l <= Number(setup.displacementLow)) {
        return { ok: true, reason: "breakout", entryPrice: Number(setup.displacementLow) };
      }
    }

    if (tryFvg && setup.fvg) {
      const fvgLow = Number(setup.fvg.low);
      const fvgHigh = Number(setup.fvg.high);
      const touched = l <= fvgHigh && h >= fvgLow;
      if (touched) {
        return { ok: true, reason: "fvg_retest", entryPrice: (fvgLow + fvgHigh) / 2 };
      }
    }

    return { ok: false, reason: "entry_not_triggered" };
  }

  function targetByMode(tpMode, side, entryPrice, riskPoints, vwapNow, setup, rr) {
    const rrTarget = side === "BUY" ? entryPrice + riskPoints * rr : entryPrice - riskPoints * rr;
    if (tpMode === "fixed_rr") return rrTarget;
    if (tpMode === "vwap_touch" && Number.isFinite(vwapNow)) {
      if (side === "BUY" && vwapNow > entryPrice) return vwapNow;
      if (side === "SELL" && vwapNow < entryPrice) return vwapNow;
    }
    if (tpMode === "next_liquidity") {
      if (side === "BUY" && Number.isFinite(setup.swingHigh) && setup.swingHigh > entryPrice) return setup.swingHigh;
      if (side === "SELL" && Number.isFinite(setup.swingLow) && setup.swingLow < entryPrice) return setup.swingLow;
    }
    return rrTarget;
  }

  function toMs(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  function candleTimeMs(c) {
    if (!c || typeof c !== "object") return 0;
    return toMs(c.date || c.t || c.ts || c.time || 0);
  }

  function parseHmToMinutes(hhmm, fallback) {
    const src = String(hhmm || fallback || "08:30").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(src);
    if (!m) return parseHmToMinutes(fallback || "08:30", "08:30");
    const h = Math.max(0, Math.min(23, Number(m[1])));
    const min = Math.max(0, Math.min(59, Number(m[2])));
    return h * 60 + min;
  }

  function chicagoMinutesOfDay(ms, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = dtf.formatToParts(new Date(ms));
    let h = 0;
    let m = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") h = Number(parts[i].value || 0);
      if (parts[i].type === "minute") m = Number(parts[i].value || 0);
    }
    return h * 60 + m;
  }

  function emaSeries(values, len) {
    const out = new Array(values.length).fill(null);
    if (!values.length || len < 1) return out;
    const alpha = 2 / (len + 1);
    let prev = Number(values[0]);
    if (!Number.isFinite(prev)) return out;
    out[0] = prev;
    for (let i = 1; i < values.length; i++) {
      const v = Number(values[i]);
      if (!Number.isFinite(v)) {
        out[i] = out[i - 1];
        continue;
      }
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  function avgAbsBody(candles, idx, lookback) {
    const start = Math.max(0, idx - lookback + 1);
    let sum = 0;
    let n = 0;
    for (let i = start; i <= idx; i++) {
      const o = Number(candles[i].o);
      const c = Number(candles[i].c);
      if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
      sum += Math.abs(c - o);
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function avgRange(candles, idx, lookback) {
    const start = Math.max(0, idx - lookback + 1);
    let sum = 0;
    let n = 0;
    for (let i = start; i <= idx; i++) {
      const h = Number(candles[i].h);
      const l = Number(candles[i].l);
      if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
      sum += Math.max(0, h - l);
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function avgVolume(candles, idx, lookback) {
    const start = Math.max(0, idx - lookback + 1);
    let sum = 0;
    let n = 0;
    for (let i = start; i <= idx; i++) {
      const v = Number(candles[i].v != null ? candles[i].v : candles[i].volume != null ? candles[i].volume : candles[i].tickVolume);
      if (!Number.isFinite(v)) continue;
      sum += v;
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function trendStructureState(candles, idx, bars) {
    if (idx - bars < 2) return "flat";
    let hh = 0;
    let hl = 0;
    let lh = 0;
    let ll = 0;
    for (let i = idx - bars + 1; i <= idx; i++) {
      const ph = Number(candles[i - 1].h);
      const pl = Number(candles[i - 1].l);
      const h = Number(candles[i].h);
      const l = Number(candles[i].l);
      if (h > ph) hh += 1;
      if (l > pl) hl += 1;
      if (h < ph) lh += 1;
      if (l < pl) ll += 1;
    }
    if (hh >= Math.ceil(bars * 0.6) && hl >= Math.ceil(bars * 0.6)) return "bull";
    if (lh >= Math.ceil(bars * 0.6) && ll >= Math.ceil(bars * 0.6)) return "bear";
    return "flat";
  }

  function chopScore(candles, idx, lookback, minRange) {
    if (idx - lookback < 2) return { isChop: false, alternationRatio: 0, avgR: 0 };
    let alternations = 0;
    let comps = 0;
    let prevDir = 0;
    for (let i = idx - lookback + 1; i <= idx; i++) {
      const o = Number(candles[i].o);
      const c = Number(candles[i].c);
      if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
      const dir = c > o ? 1 : c < o ? -1 : 0;
      if (dir !== 0 && prevDir !== 0) {
        comps += 1;
        if (dir !== prevDir) alternations += 1;
      }
      if (dir !== 0) prevDir = dir;
    }
    const avgR = avgRange(candles, idx, lookback);
    const alternationRatio = comps > 0 ? alternations / comps : 0;
    return {
      isChop: avgR < minRange || alternationRatio > 0.6,
      alternationRatio,
      avgR
    };
  }

  function evaluateNas100VwapLiquiditySweepFromSignalSet(set, strategy, strategyParams, tradeManagement) {
    const p = strategyParams || {};
    const tm = tradeManagement || {};

    const tickSize = Math.max(0.00001, toNum(tm.tickSize, toNum(p.tick_size, 1)));
    const pointValue = Math.max(0.00001, toNum(tm.pointValue, 1));
    const initialEquity = Math.max(100, toNum(tm.initialEquity, 100000));
    const riskPerTradePct = Math.max(0.01, toNum(p.risk_per_trade, 0.5));
    const stopBufferPoints = Math.max(0, toNum(p.stop_buffer_points, 5));
    const maxOpenTrades = Math.max(1, toPosInt(p.max_open_trades, 2, 1));
    const maxConsecutiveLosses = Math.max(1, toPosInt(p.max_consecutive_losses, 2, 1));
    const pauseMinutesAfterLosses = Math.max(1, toPosInt(p.pause_minutes_after_losses, 30, 1));
    const cooldownMinutes = Math.max(0, toPosInt(p.cooldown_minutes, 3, 0));
    const dailyLossLimitPct = Math.max(0.1, toNum(p.daily_loss_limit_percent, 2));
    const dailyProfitLockPct = Math.max(0.1, toNum(p.daily_profit_lock_percent, 3));
    const fixedLotSize = Math.max(0, toNum(p.fixed_lot_size, 0));
    const maxDrawdownPercent = Math.max(0, toNum(p.max_drawdown_percent, 0));
    const entryMode = String(p.entry_mode || "both");
    const tpMode = String(p.tp_mode || "partial_rr");
    const tp1Rr = Math.max(0.2, toNum(p.tp1_rr, 1));
    const tp2Rr = Math.max(tp1Rr, toNum(p.tp2_rr, 1.5));
    const moveToBeAfterTp1 = p.move_sl_to_breakeven_after_tp1 !== false;
    const entryWindowBars = Math.max(1, toPosInt(p.entry_window_bars, 8, 1));
    const maxSpreadPoints = toNum(p.max_spread_points, Infinity);
    const newsFilterEnabled = !!p.news_filter_enabled;
    const debugMode = !!p.debug_mode;
    const timeZone = p.timeZone || "America/Chicago";
    const bothHitModel = tm.bothHitModel === "tp_first" ? "tp_first" : "sl_first";

    const strategyMode = String(p.strategy_execution_mode || "both");
    const runMain = strategyMode === "both" || strategyMode === "main_only";
    const runBurst = strategyMode === "both" || strategyMode === "burst_only";
    const allowSameCandleDualEntry = !!p.allow_same_candle_main_and_burst;

    const enableBurstMode = p.enable_burst_mode !== false;
    const burstModeRequiresMainBias = p.burst_mode_requires_main_bias !== false;
    const burstSessionStartMin = parseHmToMinutes(p.burst_session_start || p.session_start || "08:30", "08:30");
    const burstSessionEndMin = parseHmToMinutes(p.burst_session_end || p.session_end || "11:30", "11:30");
    const burstRiskPerTradePct = Math.max(0.01, toNum(p.burst_risk_per_trade, 0.25));
    const burstStopBufferPoints = Math.max(0, toNum(p.burst_stop_buffer_points, 3));
    const burstTp1Points = Math.max(1, toNum(p.burst_tp1_points, 8));
    const burstTp2Points = Math.max(burstTp1Points, toNum(p.burst_tp2_points, 12));
    const burstTpMode = String(p.burst_tp_mode || "points_partial");
    const burstTp1Rr = Math.max(0.2, toNum(p.burst_tp1_rr, 0.8));
    const burstTp2Rr = Math.max(burstTp1Rr, toNum(p.burst_tp2_rr, 1.2));
    const burstMoveToBeAfterTp1 = p.burst_move_sl_to_breakeven_after_tp1 !== false;
    const burstUseEmaFilter = p.burst_use_ema_filter !== false;
    const burstFastEmaLen = Math.max(2, toPosInt(p.burst_fast_ema, 9, 2));
    const burstSlowEmaLen = Math.max(3, toPosInt(p.burst_slow_ema, 20, 3));
    const burstDispMultiplier = Math.max(0.8, toNum(p.burst_displacement_multiplier, 1.2));
    const burstMaxEntriesPerLeg = Math.max(1, toPosInt(p.burst_max_entries_per_leg, 3, 1));
    const burstCooldownMinutes = Math.max(0, toPosInt(p.burst_cooldown_minutes, 1, 0));
    const burstDisableAfterConsecutiveLosses = Math.max(1, toPosInt(p.burst_disable_after_consecutive_losses, 2, 1));
    const burstPauseMinutesAfterLossStreak = Math.max(1, toPosInt(p.burst_pause_minutes_after_loss_streak, 30, 1));
    const burstRequireVolumeConfirmation = !!p.burst_require_volume_confirmation;
    const burstVolumeMultiplier = Math.max(0.5, toNum(p.burst_volume_multiplier, 1.1));
    const burstMaxOpenTrades = Math.max(1, toPosInt(p.burst_max_open_trades, 1, 1));
    const burstMinMomentumScore = Math.max(0, toNum(p.burst_min_momentum_score, 2.0));
    const burstMinCandleRangePoints = Math.max(0, toNum(p.burst_min_candle_range_points, 3));
    const burstMinPullbackQualityScore = Math.max(0, toNum(p.burst_min_pullback_quality_score, 1.0));
    const burstEmaDistanceMaxPoints = Math.max(0.5, toNum(p.burst_ema_distance_max_points, 6));
    const burstVolumeSpikeMultiplier = Math.max(0.5, toNum(p.burst_volume_spike_multiplier, 1.0));
    const burstMaxSpreadPoints = toNum(p.burst_max_spread_points, maxSpreadPoints);
    const burstPullbackRetraceMax = Math.max(0.1, Math.min(0.9, toNum(p.burst_pullback_retrace_max, 0.45)));
    const burstTrendLookback = Math.max(3, toPosInt(p.burst_trend_lookback, 5, 3));
    const burstChopLookback = Math.max(5, toPosInt(p.burst_chop_lookback, 8, 5));

    const candles = set.candlesChron || [];
    const vwap = set.vwap || [];
    const signals = set.allSignals || [];
    const closeSeries = candles.map((c) => Number(c.c));
    const emaFast = emaSeries(closeSeries, burstFastEmaLen);
    const emaSlow = emaSeries(closeSeries, burstSlowEmaLen);

    const signalsByIdx = {};
    for (let i = 0; i < signals.length; i++) {
      const idx = Number(signals[i].idx);
      if (!signalsByIdx[idx]) signalsByIdx[idx] = [];
      signalsByIdx[idx].push(signals[i]);
    }

    let equity = initialEquity;
    let peakEquity = initialEquity;
    let maxObservedDrawdownPercent = 0;
    let drawdownStopTriggered = false;
    let drawdownStopTime = 0;
    let dayKey = "";
    let dayStartEquity = initialEquity;
    let dayLocked = false;
    let mainConsecutiveLosses = 0;
    let mainPauseUntilMs = 0;
    let lastMainExitMs = 0;
    let lastBurstExitMs = 0;

    let burstConsecutiveLosses = 0;
    let burstPauseUntilMs = 0;
    let burstModeActive = false;
    let burstModeSide = "";
    let burstLegId = 0;
    let burstEntriesThisLeg = 0;
    let lastMainQualifiedSignalIdx = -9999;
    let lastMainQualifiedSignalSide = "";

    const pending = [];
    const openTrades = [];
    const trades = [];
    const decisionLog = [];
    const burstDecisionLog = [];

    function hasOpenTradeForSystem(systemName) {
      for (let i = 0; i < openTrades.length; i++) {
        if (openTrades[i].system === systemName) return true;
      }
      return false;
    }

    function logDecision(payload) {
      if (debugMode) decisionLog.push(payload);
    }

    function logBurst(payload) {
      if (debugMode) burstDecisionLog.push(payload);
    }

    function deactivateBurst(reason, t, idx) {
      if (burstModeActive) {
        logBurst({ time: t, idx, burstModeActive: false, deactivated: true, reason, side: burstModeSide, legId: burstLegId });
      }
      burstModeActive = false;
      burstModeSide = "";
    }

    function closeTrade(trade, exitPrice, exitTime, exitReason) {
      const signedPoints = trade.side === "BUY" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice;
      const pnlCurrency = signedPoints * trade.qtyRemaining * pointValue;
      const pnlTicks = signedPoints / tickSize;
      trade.realizedPnlCurrency += pnlCurrency;
      trade.realizedPnlTicks += pnlTicks;
      trade.qtyRemaining = 0;
      trade.closed = true;
      trade.exitPrice = exitPrice;
      trade.exitTime = exitTime;
      trade.exitReason = exitReason;
      equity += pnlCurrency;
      if (equity > peakEquity) peakEquity = equity;

      const ddPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (Number.isFinite(ddPct) && ddPct > maxObservedDrawdownPercent) {
        maxObservedDrawdownPercent = ddPct;
      }

      const tradeRow = {
        trade: trades.length + 1,
        side: trade.side,
        system: trade.system,
        entryLabel: trade.system === "BURST" ? "BURST_MODE_ENTRY" : "MAIN_STRATEGY_ENTRY",
        entryTime: trade.entryTime,
        entryPrice: trade.entryPrice,
        exitTime,
        exitPrice,
        exitReason,
        pnlTicks: trade.realizedPnlTicks,
        pnlR: trade.riskPoints > 0 ? trade.realizedPnlTicks / (trade.riskPoints / tickSize) : 0,
        qty: trade.qty,
        tp1Hit: !!trade.tp1Hit,
        signalReason: trade.entryReason,
        burstLegId: trade.burstLegId || null
      };
      trades.push(tradeRow);

      if (trade.system === "MAIN") {
        if (trade.realizedPnlCurrency < 0) {
          mainConsecutiveLosses += 1;
          if (mainConsecutiveLosses >= maxConsecutiveLosses) {
            mainPauseUntilMs = exitTime + pauseMinutesAfterLosses * 60 * 1000;
          }
        } else {
          mainConsecutiveLosses = 0;
        }
        lastMainExitMs = exitTime;
      } else {
        if (trade.realizedPnlCurrency < 0) {
          burstConsecutiveLosses += 1;
          if (burstConsecutiveLosses >= burstDisableAfterConsecutiveLosses) {
            burstPauseUntilMs = exitTime + burstPauseMinutesAfterLossStreak * 60 * 1000;
            deactivateBurst("burst_loss_streak_pause", exitTime, trade.entryIdx);
          }
        } else {
          burstConsecutiveLosses = 0;
        }
        lastBurstExitMs = exitTime;
      }
    }

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i] || {};
      const t = window.LCPro.Backtest.candleTimeMs(c);
      const o = Number(c.o);
      const h = Number(c.h);
      const l = Number(c.l);
      const cl = Number(c.c);
      const vw = Number(vwap[i]);
      const ef = Number(emaFast[i]);
      const es = Number(emaSlow[i]);
      const minOfDay = chicagoMinutesOfDay(t, timeZone);
      const inBurstSession = minOfDay >= burstSessionStartMin && minOfDay <= burstSessionEndMin;

      if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) {
        continue;
      }

      const currentDay = getDayKey(t, timeZone);
      if (currentDay !== dayKey) {
        dayKey = currentDay;
        dayStartEquity = equity;
        dayLocked = false;
        mainConsecutiveLosses = 0;
        burstConsecutiveLosses = 0;
        deactivateBurst("new_session_day", t, i);
      }

      const dayPnLPct = dayStartEquity > 0 ? ((equity - dayStartEquity) / dayStartEquity) * 100 : 0;
      if (dayPnLPct <= -dailyLossLimitPct || dayPnLPct >= dailyProfitLockPct) {
        dayLocked = true;
        deactivateBurst("daily_lock", t, i);
      }

      const openedThisCandle = { MAIN: 0, BURST: 0 };

      for (let k = openTrades.length - 1; k >= 0; k--) {
        const tr = openTrades[k];
        const slHit = tr.side === "BUY" ? l <= tr.stopPrice : h >= tr.stopPrice;
        const tp1Hit = !tr.tp1Hit && (tr.side === "BUY" ? h >= tr.tp1Price : l <= tr.tp1Price);
        const tp2Target = tr.side === "BUY" ? h >= tr.tp2Price : l <= tr.tp2Price;

        if (!tr.tp1Hit) {
          if (slHit && tp1Hit) {
            if (bothHitModel === "tp_first") {
              const takeQty = tr.qty * 0.5;
              const gainPoints = tr.side === "BUY" ? tr.tp1Price - tr.entryPrice : tr.entryPrice - tr.tp1Price;
              tr.realizedPnlCurrency += gainPoints * takeQty * pointValue;
              tr.realizedPnlTicks += gainPoints / tickSize;
              tr.qtyRemaining = tr.qty - takeQty;
              tr.tp1Hit = true;
              if (tr.moveToBeAfterTp1) tr.stopPrice = tr.entryPrice;
            } else {
              closeTrade(tr, tr.stopPrice, t, "sl_before_tp1");
              openTrades.splice(k, 1);
              continue;
            }
          } else if (tp1Hit) {
            const takeQty = tr.qty * 0.5;
            const gainPoints = tr.side === "BUY" ? tr.tp1Price - tr.entryPrice : tr.entryPrice - tr.tp1Price;
            tr.realizedPnlCurrency += gainPoints * takeQty * pointValue;
            tr.realizedPnlTicks += gainPoints / tickSize;
            tr.qtyRemaining = tr.qty - takeQty;
            tr.tp1Hit = true;
            if (tr.moveToBeAfterTp1) tr.stopPrice = tr.entryPrice;
          } else if (slHit) {
            closeTrade(tr, tr.stopPrice, t, "sl");
            openTrades.splice(k, 1);
            continue;
          }
        }

        const stopAfterTp1 = tr.side === "BUY" ? l <= tr.stopPrice : h >= tr.stopPrice;
        if (tr.tp1Hit) {
          if (tp2Target && stopAfterTp1) {
            if (bothHitModel === "tp_first") {
              closeTrade(tr, tr.tp2Price, t, "tp2");
            } else {
              closeTrade(tr, tr.stopPrice, t, tr.stopPrice === tr.entryPrice ? "breakeven" : "sl_after_tp1");
            }
            openTrades.splice(k, 1);
            continue;
          }
          if (tp2Target) {
            closeTrade(tr, tr.tp2Price, t, "tp2");
            openTrades.splice(k, 1);
            continue;
          }
          if (stopAfterTp1) {
            closeTrade(tr, tr.stopPrice, t, tr.stopPrice === tr.entryPrice ? "breakeven" : "sl_after_tp1");
            openTrades.splice(k, 1);
            continue;
          }
        }

        if (i === candles.length - 1) {
          closeTrade(tr, cl, t, "end_of_data");
          openTrades.splice(k, 1);
        }
      }

      const currentDdPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      if (
        !drawdownStopTriggered &&
        maxDrawdownPercent > 0 &&
        Number.isFinite(currentDdPct) &&
        currentDdPct >= maxDrawdownPercent
      ) {
        drawdownStopTriggered = true;
        drawdownStopTime = t;
        dayLocked = true;
        deactivateBurst("max_drawdown_stop", t, i);

        for (let k = openTrades.length - 1; k >= 0; k--) {
          const tr = openTrades[k];
          closeTrade(tr, cl, t, "max_drawdown_stop");
          openTrades.splice(k, 1);
        }
      }

      if (drawdownStopTriggered) {
        continue;
      }

      if (signalsByIdx[i] && signalsByIdx[i].length) {
        for (let s = 0; s < signalsByIdx[i].length; s++) {
          pending.push({ signal: signalsByIdx[i][s], expiresAt: i + entryWindowBars, entered: false });
          lastMainQualifiedSignalIdx = i;
          lastMainQualifiedSignalSide = signalsByIdx[i][s].type;
        }
      }

      if (runMain) {
        for (let q = pending.length - 1; q >= 0; q--) {
          const pnd = pending[q];
          if (pnd.entered || i > pnd.expiresAt) {
            pending.splice(q, 1);
            continue;
          }

          const sig = pnd.signal;
          const setup = sig && sig.setup ? sig.setup : null;
          if (!setup) {
            pending.splice(q, 1);
            continue;
          }

          if (openTrades.length >= maxOpenTrades) {
            logDecision({ time: t, idx: i, blocked: true, reason: "max_open_trades", side: sig.type, system: "MAIN" });
            continue;
          }
          if (dayLocked) {
            logDecision({ time: t, idx: i, blocked: true, reason: "daily_lock", side: sig.type, system: "MAIN" });
            continue;
          }
          if (t < mainPauseUntilMs) {
            logDecision({ time: t, idx: i, blocked: true, reason: "loss_pause", side: sig.type, system: "MAIN" });
            continue;
          }
          if (lastMainExitMs && t - lastMainExitMs < cooldownMinutes * 60 * 1000) {
            logDecision({ time: t, idx: i, blocked: true, reason: "cooldown", side: sig.type, system: "MAIN" });
            continue;
          }

          const spreadPoints = Number(c.spreadPoints || c.spread || 0);
          if (Number.isFinite(maxSpreadPoints) && Number.isFinite(spreadPoints) && spreadPoints > maxSpreadPoints) {
            logDecision({ time: t, idx: i, blocked: true, reason: "spread_filter", spreadPoints, side: sig.type, system: "MAIN" });
            continue;
          }
          if (newsFilterEnabled) {
            const newsBlocked = false;
            if (newsBlocked) {
              logDecision({ time: t, idx: i, blocked: true, reason: "news_filter", side: sig.type, system: "MAIN" });
              continue;
            }
          }

          const biasOk = sig.type === "BUY" ? cl > vw : cl < vw;
          const entry = getEntryFromMode(entryMode, setup, c, sig.type, biasOk);
          if (!entry.ok) {
            logDecision({
              time: t,
              idx: i,
              blocked: true,
              reason: entry.reason,
              side: sig.type,
              system: "MAIN",
              vwapBias: sig.type === "BUY" ? "above" : "below",
              vwap: vw,
              lastSwingHigh: setup.swingHigh,
              lastSwingLow: setup.swingLow,
              sweepDetected: true,
              displacementPassed: true,
              fvgFound: !!setup.fvg
            });
            continue;
          }

          const stopPrice = sig.type === "BUY" ? Number(setup.sweepWick) - stopBufferPoints : Number(setup.sweepWick) + stopBufferPoints;
          const riskPoints = Math.abs(entry.entryPrice - stopPrice);
          if (!Number.isFinite(riskPoints) || riskPoints <= 0) {
            logDecision({ time: t, idx: i, blocked: true, reason: "invalid_risk", side: sig.type, system: "MAIN" });
            pending.splice(q, 1);
            continue;
          }
          const riskAmount = equity * (riskPerTradePct / 100);
          const qty = fixedLotSize > 0 ? fixedLotSize : riskAmount / (riskPoints * pointValue);
          if (!Number.isFinite(qty) || qty <= 0) {
            logDecision({ time: t, idx: i, blocked: true, reason: "position_size_failed", side: sig.type, system: "MAIN" });
            pending.splice(q, 1);
            continue;
          }

          if (!allowSameCandleDualEntry && openedThisCandle.BURST > 0) {
            logDecision({ time: t, idx: i, blocked: true, reason: "same_candle_burst_conflict", side: sig.type, system: "MAIN" });
            continue;
          }

          const tp1Price = sig.type === "BUY" ? entry.entryPrice + riskPoints * tp1Rr : entry.entryPrice - riskPoints * tp1Rr;
          const modeTarget = targetByMode(tpMode, sig.type, entry.entryPrice, riskPoints, vw, setup, tp2Rr);
          const tp2Price =
            tpMode === "partial_rr"
              ? targetByMode("next_liquidity", sig.type, entry.entryPrice, riskPoints, vw, setup, tp2Rr)
              : modeTarget;

          openTrades.push({
            system: "MAIN",
            side: sig.type,
            entryIdx: i,
            entryTime: t,
            entryPrice: Number(entry.entryPrice),
            stopPrice: Number(stopPrice),
            tp1Price: Number(tp1Price),
            tp2Price: Number(tp2Price),
            qty: Number(qty),
            qtyRemaining: Number(qty),
            riskPoints,
            tp1Hit: false,
            moveToBeAfterTp1,
            entryReason: entry.reason,
            realizedPnlCurrency: 0,
            realizedPnlTicks: 0,
            closed: false
          });
          openedThisCandle.MAIN += 1;

          logDecision({
            time: t,
            idx: i,
            allowed: true,
            reason: entry.reason,
            side: sig.type,
            system: "MAIN",
            vwapBias: sig.type === "BUY" ? "above" : "below",
            vwap: vw,
            lastSwingHigh: setup.swingHigh,
            lastSwingLow: setup.swingLow,
            sweepDetected: true,
            displacementPassed: true,
            fvgFound: !!setup.fvg
          });

          pnd.entered = true;
          pending.splice(q, 1);
        }
      }

      if (runBurst && enableBurstMode) {
        const bias = cl > vw ? "BUY" : cl < vw ? "SELL" : "FLAT";
        const trendState = trendStructureState(candles, i, burstTrendLookback);
        const bodyNow = Math.abs(cl - o);
        const bodyAvg10 = avgAbsBody(candles, i - 1, 10);
        const dispStrength = bodyAvg10 > 0 ? bodyNow / bodyAvg10 : 0;
        const chop = chopScore(candles, i, burstChopLookback, burstMinCandleRangePoints * tickSize);
        const volNow = Number(c.v != null ? c.v : c.volume != null ? c.volume : c.tickVolume);
        const volAvg10 = avgVolume(candles, i - 1, 10);
        const volumeOk = !burstRequireVolumeConfirmation || (volAvg10 > 0 && volNow >= volAvg10 * burstVolumeMultiplier);
        const momentumScore = (dispStrength >= burstDispMultiplier ? 1 : 0) + (trendState !== "flat" ? 1 : 0) + (chop.isChop ? 0 : 1);

        const spreadPoints = Number(c.spreadPoints || c.spread || 0);
        const spreadOk = !Number.isFinite(burstMaxSpreadPoints) || !Number.isFinite(spreadPoints) || spreadPoints <= burstMaxSpreadPoints;
        const inBurstBias = bias === "BUY" || bias === "SELL";
        const trendBiasOk = (bias === "BUY" && trendState === "bull") || (bias === "SELL" && trendState === "bear");
        const recentMainSignalOk =
          i - lastMainQualifiedSignalIdx <= 20 &&
          (lastMainQualifiedSignalSide === bias || hasOpenTradeForSystem("MAIN"));
        const mainBiasOk = !burstModeRequiresMainBias || recentMainSignalOk;
        const canActivate =
          inBurstSession &&
          inBurstBias &&
          trendBiasOk &&
          dispStrength >= burstDispMultiplier &&
          volumeOk &&
          !chop.isChop &&
          momentumScore >= burstMinMomentumScore &&
          spreadOk &&
          mainBiasOk;

        if (signalsByIdx[i] && signalsByIdx[i].some((s0) => s0.type !== bias && s0.type !== "FLAT")) {
          deactivateBurst("opposite_liquidity_sweep", t, i);
        }

        if (burstModeActive) {
          if (!inBurstSession) deactivateBurst("session_end", t, i);
          else if (dayLocked) deactivateBurst("daily_lock", t, i);
          else if ((burstModeSide === "BUY" && cl <= vw) || (burstModeSide === "SELL" && cl >= vw)) deactivateBurst("vwap_cross", t, i);
          else if ((burstModeSide === "BUY" && trendState !== "bull") || (burstModeSide === "SELL" && trendState !== "bear")) deactivateBurst("trend_break", t, i);
          else if (dispStrength >= burstDispMultiplier && ((burstModeSide === "BUY" && cl < o) || (burstModeSide === "SELL" && cl > o))) {
            deactivateBurst("opposite_displacement", t, i);
          }
        }

        if (!burstModeActive) {
          if (!inBurstSession) {
            logBurst({ time: t, idx: i, burstModeActive: false, blocked: true, reason: "session_filter", currentVwapBias: bias, trendState });
          } else if (t < burstPauseUntilMs) {
            logBurst({ time: t, idx: i, burstModeActive: false, blocked: true, reason: "burst_pause", currentVwapBias: bias, trendState });
          } else if (!canActivate) {
            logBurst({
              time: t,
              idx: i,
              burstModeActive: false,
              blocked: true,
              reason: "activation_requirements_not_met",
              currentVwapBias: bias,
              trendState,
              displacementStrength: dispStrength,
              chop: chop.isChop,
              momentumScore
            });
          } else {
            burstModeActive = true;
            burstModeSide = bias;
            burstLegId += 1;
            burstEntriesThisLeg = 0;
            logBurst({
              time: t,
              idx: i,
              burstModeActive: true,
              activated: true,
              reason: "momentum_activation",
              currentVwapBias: bias,
              trendState,
              displacementStrength: dispStrength,
              momentumScore,
              legId: burstLegId
            });
          }
        }

        if (burstModeActive && burstEntriesThisLeg < burstMaxEntriesPerLeg) {
          if (dayLocked) {
            logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "daily_lock", side: burstModeSide });
          } else if (t < burstPauseUntilMs) {
            logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "burst_pause", side: burstModeSide });
          } else if (hasOpenTradeForSystem("BURST") && burstMaxOpenTrades <= 1) {
            logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "max_burst_open_trades", side: burstModeSide });
          } else if (lastBurstExitMs && t - lastBurstExitMs < burstCooldownMinutes * 60 * 1000) {
            logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "burst_cooldown", side: burstModeSide });
          } else if (!allowSameCandleDualEntry && openedThisCandle.MAIN > 0) {
            logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "same_candle_main_conflict", side: burstModeSide });
          } else {
            const side = burstModeSide;
            const bodyDir = cl > o ? "BUY" : cl < o ? "SELL" : "FLAT";
            const emaMin = Math.min(ef, es);
            const emaMax = Math.max(ef, es);
            const pullbackCount = Math.min(3, i);
            let oppositeCount = 0;
            let pbHigh = -Infinity;
            let pbLow = Infinity;
            for (let j = i - pullbackCount; j < i; j++) {
              const oo = Number(candles[j].o);
              const cc = Number(candles[j].c);
              if ((side === "BUY" && cc < oo) || (side === "SELL" && cc > oo)) oppositeCount += 1;
              pbHigh = Math.max(pbHigh, Number(candles[j].h));
              pbLow = Math.min(pbLow, Number(candles[j].l));
            }
            const pullbackCandlesOk = oppositeCount >= 1 && oppositeCount <= 3;
            const touchedEmaZone = Number.isFinite(emaMin) && Number.isFinite(emaMax) && l <= emaMax && h >= emaMin;
            const reclaimFastEma = side === "BUY" ? cl > ef : cl < ef;

            const lastDispMove = avgAbsBody(candles, i - 1, 3);
            const retracePoints = side === "BUY" ? Math.max(0, pbHigh - cl) : Math.max(0, cl - pbLow);
            const retraceRatio = lastDispMove > 0 ? retracePoints / lastDispMove : 1;
            const shallowRetrace = retraceRatio <= burstPullbackRetraceMax;

            const contBreak = side === "BUY" ? cl > Number(candles[i - 1] && candles[i - 1].h) : cl < Number(candles[i - 1] && candles[i - 1].l);
            const continuation = bodyDir === side && (contBreak || reclaimFastEma);

            const emaDistancePoints = Number.isFinite(ef) ? Math.abs(cl - ef) / tickSize : Infinity;
            const emaDistanceOk = emaDistancePoints <= burstEmaDistanceMaxPoints;
            const volumeSpikeOk = volAvg10 <= 0 || volNow >= volAvg10 * burstVolumeSpikeMultiplier;

            const pullbackQualityScore =
              (pullbackCandlesOk ? 1 : 0) +
              (touchedEmaZone ? 1 : 0) +
              (shallowRetrace ? 1 : 0) +
              (emaDistanceOk ? 1 : 0);

            const pullbackDetected = pullbackCandlesOk || touchedEmaZone || shallowRetrace;
            if (!pullbackDetected) {
              logBurst({
                time: t,
                idx: i,
                burstModeActive: true,
                blocked: true,
                reason: "pullback_not_detected",
                currentVwapBias: side,
                trendState,
                displacementStrength: dispStrength,
                pullbackDetected: false,
                continuationPassed: false
              });
            } else if (burstUseEmaFilter && !touchedEmaZone) {
              logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "ema_pullback_filter", side });
            } else if (burstUseEmaFilter && !reclaimFastEma) {
              logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "ema_reclaim_filter", side });
            } else if (!continuation) {
              logBurst({
                time: t,
                idx: i,
                burstModeActive: true,
                blocked: true,
                reason: "continuation_failed",
                currentVwapBias: side,
                trendState,
                displacementStrength: dispStrength,
                pullbackDetected: true,
                continuationPassed: false
              });
            } else if (pullbackQualityScore < burstMinPullbackQualityScore) {
              logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "pullback_quality_low", pullbackQualityScore });
            } else if (!emaDistanceOk) {
              logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "ema_distance_filter", emaDistancePoints });
            } else if (!volumeSpikeOk) {
              logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "volume_spike_filter" });
            } else {
              const entryPrice = cl;
              const stopAnchor = side === "BUY" ? pbLow : pbHigh;
              const stopPrice = side === "BUY" ? stopAnchor - burstStopBufferPoints : stopAnchor + burstStopBufferPoints;
              const riskPoints = Math.abs(entryPrice - stopPrice);

              if (!Number.isFinite(riskPoints) || riskPoints <= 0) {
                logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "invalid_risk" });
              } else {
                const riskAmount = equity * (burstRiskPerTradePct / 100);
                const qty = fixedLotSize > 0 ? fixedLotSize : riskAmount / (riskPoints * pointValue);
                if (!Number.isFinite(qty) || qty <= 0) {
                  logBurst({ time: t, idx: i, burstModeActive: true, blocked: true, reason: "position_size_failed" });
                } else {
                  const tp1Price =
                    burstTpMode === "rr_partial"
                      ? side === "BUY"
                        ? entryPrice + riskPoints * burstTp1Rr
                        : entryPrice - riskPoints * burstTp1Rr
                      : side === "BUY"
                        ? entryPrice + burstTp1Points
                        : entryPrice - burstTp1Points;

                  const tp2Price =
                    burstTpMode === "rr_partial"
                      ? side === "BUY"
                        ? entryPrice + riskPoints * burstTp2Rr
                        : entryPrice - riskPoints * burstTp2Rr
                      : side === "BUY"
                        ? entryPrice + burstTp2Points
                        : entryPrice - burstTp2Points;

                  openTrades.push({
                    system: "BURST",
                    burstLegId,
                    side,
                    entryIdx: i,
                    entryTime: t,
                    entryPrice: Number(entryPrice),
                    stopPrice: Number(stopPrice),
                    tp1Price: Number(tp1Price),
                    tp2Price: Number(tp2Price),
                    qty: Number(qty),
                    qtyRemaining: Number(qty),
                    riskPoints,
                    tp1Hit: false,
                    moveToBeAfterTp1: burstMoveToBeAfterTp1,
                    entryReason: "micro_pullback_continuation",
                    realizedPnlCurrency: 0,
                    realizedPnlTicks: 0,
                    closed: false
                  });

                  burstEntriesThisLeg += 1;
                  openedThisCandle.BURST += 1;
                  logBurst({
                    time: t,
                    idx: i,
                    burstModeActive: true,
                    allowed: true,
                    reason: "burst_entry_allowed",
                    currentVwapBias: side,
                    trendState,
                    displacementStrength: dispStrength,
                    pullbackDetected: true,
                    continuationPassed: true,
                    pullbackQualityScore,
                    legId: burstLegId,
                    entriesThisLeg: burstEntriesThisLeg
                  });
                }
              }
            }
          }
        } else if (burstModeActive && burstEntriesThisLeg >= burstMaxEntriesPerLeg) {
          deactivateBurst("max_entries_per_leg", t, i);
        }
      }
    }

    let wins = 0;
    let losses = 0;
    let grossTicks = 0;
    let grossCurrency = 0;
    let avgR = 0;
    const bySystem = {
      MAIN: { totalTrades: 0, wins: 0, losses: 0, grossTicks: 0, grossCurrency: 0 },
      BURST: { totalTrades: 0, wins: 0, losses: 0, grossTicks: 0, grossCurrency: 0 }
    };

    for (let i = 0; i < trades.length; i++) {
      const tr = trades[i];
      grossTicks += Number(tr.pnlTicks || 0);
      const points = Number(tr.pnlTicks || 0) * tickSize;
      const money = points * pointValue;
      grossCurrency += money;
      avgR += Number(tr.pnlR || 0);
      const isWin = Number(tr.pnlTicks || 0) >= 0;
      if (isWin) wins += 1;
      else losses += 1;

      const bucket = tr.system === "BURST" ? bySystem.BURST : bySystem.MAIN;
      bucket.totalTrades += 1;
      bucket.grossTicks += Number(tr.pnlTicks || 0);
      bucket.grossCurrency += money;
      if (isWin) bucket.wins += 1;
      else bucket.losses += 1;
    }
    avgR = trades.length ? avgR / trades.length : 0;

    bySystem.MAIN.winRate = bySystem.MAIN.totalTrades ? (bySystem.MAIN.wins / bySystem.MAIN.totalTrades) * 100 : 0;
    bySystem.BURST.winRate = bySystem.BURST.totalTrades ? (bySystem.BURST.wins / bySystem.BURST.totalTrades) * 100 : 0;

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      params: p,
      tradeManagement: {
        tickSize,
        pointValue,
        initialEquity,
        riskPerTradePct,
        stopBufferPoints,
        entryMode,
        tpMode,
        tp1Rr,
        tp2Rr,
        cooldownMinutes,
        maxOpenTrades,
        maxConsecutiveLosses,
        dailyLossLimitPct,
        dailyProfitLockPct,
        fixedLotSize,
        maxDrawdownPercent,
        newsFilterEnabled,
        bothHitModel,
        strategyMode,
        enableBurstMode,
        burstRiskPerTradePct,
        burstMaxEntriesPerLeg,
        burstCooldownMinutes,
        burstTpMode,
        allowSameCandleDualEntry
      },
      summary: {
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length ? (wins / trades.length) * 100 : 0,
        grossTicks,
        grossCurrency,
        avgR,
        endingEquity: equity,
        maxObservedDrawdownPercent,
        drawdownStopTriggered,
        drawdownStopTime,
        bySystem
      },
      trades,
      signals: set.signals || [],
      verification: Object.assign({}, set.verification || {}, {
        pendingSignalsFinal: pending.length,
        decisionsLogged: decisionLog.length,
        burstDecisionsLogged: burstDecisionLog.length,
        dayLockEnabled: true,
        drawdownStopEnabled: maxDrawdownPercent > 0,
        lossPauseMinutes: pauseMinutesAfterLosses,
        burstPauseMinutes: burstPauseMinutesAfterLossStreak
      }),
      debug: {
        signalDebugRows: set.debugRows || [],
        decisionLog,
        burstDecisionLog
      }
    };
  }

  function evaluateSmaFromSignalSet(set, strategy, strategyParams, tradeManagement) {
    const p = strategyParams || {};
    const tm = tradeManagement || {};

    const slTicks = Math.max(1, toNum(tm.slTicks, 55));
    const tpTicks = Math.max(1, toNum(tm.tpTicks, 55));
    const tickSize = Math.max(0.00001, toNum(tm.tickSize, 1));
    const lots = Math.max(0.00001, toNum(tm.lots, 1));
    const pointValue = Math.max(0, toNum(tm.pointValue, 1));
    const exitOnOpposite = tm.exitOnOpposite !== false;
    const bothHitModel = tm.bothHitModel === "tp_first" ? "tp_first" : "sl_first";
    const tpMode = String(tm.tpMode || "fixed");
    const slMode = String(tm.slMode || "fixed");
    const dynamicRangeLookback = Math.max(1, toPosInt(tm.dynamicRangeLookback, 8, 1));
    const tpRangeMultiplier = Math.max(0.1, toNum(tm.tpRangeMultiplier, 1));
    const slRangeMultiplier = Math.max(0.1, toNum(tm.slRangeMultiplier, 1));
    const minDynamicTpTicks = Math.max(1, toNum(tm.minDynamicTpTicks, tpTicks));
    const maxDynamicTpTicks = Math.max(minDynamicTpTicks, toNum(tm.maxDynamicTpTicks, Math.max(tpTicks, minDynamicTpTicks)));
    const minDynamicSlTicks = Math.max(1, toNum(tm.minDynamicSlTicks, slTicks));
    const maxDynamicSlTicks = Math.max(minDynamicSlTicks, toNum(tm.maxDynamicSlTicks, Math.max(slTicks, minDynamicSlTicks)));
    const breakEvenTriggerTicks = Math.max(0, toNum(tm.breakEvenTriggerTicks, 0));
    const trailingStopTicks = Math.max(0, toNum(tm.trailingStopTicks, 0));
    const trailingActivationTicks = Math.max(0, toNum(tm.trailingActivationTicks, trailingStopTicks > 0 ? trailingStopTicks : breakEvenTriggerTicks));
    const maxBarsInTrade = Math.max(0, toPosInt(tm.maxBarsInTrade, 0, 0));

    const signals = set.allSignals || [];
    const candles = set.candlesChron || [];
    const byIdx = {};
    for (let i = 0; i < signals.length; i++) byIdx[signals[i].idx] = signals[i];

    function clampTicks(value, minTicks, maxTicks, fallbackTicks) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallbackTicks;
      return Math.max(minTicks, Math.min(maxTicks, n));
    }

    function resolveDynamicTicks(mode, fixedTicks, signalIdx, multiplier, minTicks, maxTicks) {
      if (mode !== "range") return fixedTicks;

      const end = Math.max(0, Number(signalIdx) - 1);
      const start = Math.max(0, end - dynamicRangeLookback + 1);
      let sum = 0;
      let count = 0;
      for (let candleIdx = start; candleIdx <= end; candleIdx++) {
        const candle = candles[candleIdx] || {};
        const h = Number(candle.h);
        const l = Number(candle.l);
        if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
        sum += Math.max(0, h - l);
        count += 1;
      }

      if (!count || tickSize <= 0) return fixedTicks;
      const avgRangePoints = sum / count;
      const rangeTicks = avgRangePoints / tickSize;
      const scaledTicks = Math.round(rangeTicks * multiplier);
      return clampTicks(scaledTicks, minTicks, maxTicks, fixedTicks);
    }

    const trades = [];
    let wins = 0;
    let losses = 0;
    let grossTicks = 0;
    let grossCurrency = 0;

    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      const side = sig.type;
      const entry = Number(sig.price);
      if (!Number.isFinite(entry)) continue;

      const tradeTpTicks = resolveDynamicTicks(tpMode, tpTicks, sig.idx, tpRangeMultiplier, minDynamicTpTicks, maxDynamicTpTicks);
      const tradeSlTicks = resolveDynamicTicks(slMode, slTicks, sig.idx, slRangeMultiplier, minDynamicSlTicks, maxDynamicSlTicks);
      let activeTpPrice = side === "BUY" ? entry + tradeTpTicks * tickSize : entry - tradeTpTicks * tickSize;
      let activeSlPrice = side === "BUY" ? entry - tradeSlTicks * tickSize : entry + tradeSlTicks * tickSize;
      let movedToBreakEven = false;

      let exitPrice = entry;
      let exitTime = sig.time;
      let exitReason = "end_of_data";

      for (let j = sig.idx + 1; j < candles.length; j++) {
        const c = candles[j] || {};
        const h = Number(c.h);
        const l = Number(c.l);
        const close = Number(c.c);
        const t = window.LCPro.Backtest.candleTimeMs(c);
        const barsHeld = j - sig.idx;

        const hitTp = side === "BUY" ? h >= activeTpPrice : l <= activeTpPrice;
        const hitSl = side === "BUY" ? l <= activeSlPrice : h >= activeSlPrice;

        if (hitTp && hitSl) {
          exitPrice = bothHitModel === "tp_first" ? activeTpPrice : activeSlPrice;
          exitReason = bothHitModel === "tp_first" ? "both_hit_tp_first" : "both_hit_sl_first";
          exitTime = t || exitTime;
          break;
        }
        if (hitTp) {
          exitPrice = activeTpPrice;
          exitReason = "tp";
          exitTime = t || exitTime;
          break;
        }
        if (hitSl) {
          exitPrice = activeSlPrice;
          exitReason = "sl";
          exitTime = t || exitTime;
          break;
        }

        const favorableTicks = side === "BUY" ? (h - entry) / tickSize : (entry - l) / tickSize;

        if (!movedToBreakEven && breakEvenTriggerTicks > 0 && favorableTicks >= breakEvenTriggerTicks) {
          activeSlPrice = side === "BUY" ? Math.max(activeSlPrice, entry) : Math.min(activeSlPrice, entry);
          movedToBreakEven = true;
        }

        if (trailingStopTicks > 0 && favorableTicks >= trailingActivationTicks && Number.isFinite(close)) {
          const trailPrice = side === "BUY" ? close - trailingStopTicks * tickSize : close + trailingStopTicks * tickSize;
          activeSlPrice = side === "BUY" ? Math.max(activeSlPrice, trailPrice) : Math.min(activeSlPrice, trailPrice);
        }

        if (exitOnOpposite && byIdx[j] && byIdx[j].type !== side) {
          exitPrice = Number.isFinite(close) ? close : entry;
          exitReason = "opposite_signal";
          exitTime = t || exitTime;
          break;
        }

        if (maxBarsInTrade > 0 && barsHeld >= maxBarsInTrade) {
          exitPrice = Number.isFinite(close) ? close : entry;
          exitReason = "time_stop";
          exitTime = t || exitTime;
          break;
        }

        if (j === candles.length - 1) {
          exitPrice = Number.isFinite(close) ? close : entry;
          exitReason = "end_of_data";
          exitTime = t || exitTime;
        }
      }

      const pnlTicksRaw = side === "BUY" ? (exitPrice - entry) / tickSize : (entry - exitPrice) / tickSize;
      const pnlTicks = Number.isFinite(pnlTicksRaw) ? pnlTicksRaw : 0;
      const pnlCurrency = pnlTicks * lots * pointValue;
      const pnlR = tradeSlTicks > 0 ? pnlTicks / tradeSlTicks : 0;

      if (pnlTicks >= 0) wins += 1;
      else losses += 1;
      grossTicks += pnlTicks;
      grossCurrency += pnlCurrency;

      trades.push({
        trade: trades.length + 1,
        side,
        entryTime: sig.time,
        entryPrice: entry,
        exitTime,
        exitPrice,
        exitReason,
        tpTicks: tradeTpTicks,
        slTicks: tradeSlTicks,
        pnlTicks,
        pnlCurrency,
        pnlR
      });
    }

    const totalTrades = trades.length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const avgR = totalTrades ? trades.reduce((a, t) => a + Number(t.pnlR || 0), 0) / totalTrades : 0;

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      params: p,
      tradeManagement: {
        slTicks,
        tpTicks,
        tickSize,
        exitOnOpposite,
        bothHitModel,
        tpMode,
        slMode,
        dynamicRangeLookback,
        tpRangeMultiplier,
        slRangeMultiplier,
        minDynamicTpTicks,
        maxDynamicTpTicks,
        minDynamicSlTicks,
        maxDynamicSlTicks,
        breakEvenTriggerTicks,
        trailingStopTicks,
        trailingActivationTicks,
        maxBarsInTrade
      },
      summary: {
        totalTrades,
        wins,
        losses,
        winRate,
        grossTicks,
        grossCurrency,
        avgR
      },
      trades,
      signals: set.signals || [],
      verification: set.verification || {}
    };
  }

  async function runSmaBacktest(input, strategy) {
    const pInput = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const fastLen = toPosInt(pInput.fastLen, 9, 2);
    const slowLen = toPosInt(pInput.slowLen, 21, 3);
    const keepN = toPosInt(input && input.keepN, 25, 1);

    const p = { fastLen, slowLen };
    const tm = {
      slTicks: Math.max(1, toNum(tmInput.slTicks, toNum(tmDefaults.slTicks, 55))),
      tpTicks: Math.max(1, toNum(tmInput.tpTicks, toNum(tmDefaults.tpTicks, 55))),
      tickSize: Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))),
      lots: Math.max(0.00001, toNum(tmInput.lots, toNum(strategy && strategy.liveDefaults && strategy.liveDefaults.lots, 1))),
      pointValue: Math.max(0, toNum(tmInput.pointValue, toNum(tmDefaults.pointValue, 1))),
      exitOnOpposite: tmInput.exitOnOpposite !== false,
      bothHitModel: tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first"
    };

    const set = await window.LCPro.Backtest.buildSmaSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      fastLen: p.fastLen,
      slowLen: p.slowLen,
      keepN,
      rangePreset: input.rangePreset || "week"
    });

    const report = evaluateSmaFromSignalSet(set, strategy, p, tm);
    report.rangePreset = input.rangePreset || "week";
    return report;
  }

  async function runNas100HybridBacktest(input, strategy) {
    const pInput = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const p = {
      timeZone: pInput.timeZone || "America/Chicago",
      sessionStart: pInput.sessionStart || "09:35",
      sessionEnd: pInput.sessionEnd || "11:30",
      altSessionStart: pInput.altSessionStart || "14:00",
      altSessionEnd: pInput.altSessionEnd || "15:30",
      useAltSession: pInput.useAltSession === true,
      allowAltSession: pInput.allowAltSession !== false,
      skipFirstMinutes: toPosInt(pInput.skipFirstMinutes, 5, 1),
      m5EmaFast: toPosInt(pInput.m5EmaFast, 20, 5),
      m5EmaSlow: toPosInt(pInput.m5EmaSlow, 50, 10),
      m5AdxLen: toPosInt(pInput.m5AdxLen, 14, 5),
      m5AdxThreshold: Math.max(15, toNum(pInput.m5AdxThreshold, 22)),
      trendBurstMode: pInput.trendBurstMode !== false,
      wickRejectionMode: pInput.wickRejectionMode !== false,
      pullbackRetraceMax: Math.max(0.1, Math.min(0.9, toNum(pInput.pullbackRetraceMax, 0.45))),
      minCandleRangePoints: Math.max(0, toNum(pInput.minCandleRangePoints, 2)),
      consolidationLookback: Math.max(3, toPosInt(pInput.consolidationLookback, 10, 3)),
      maxConsolidationRange: Math.max(1, toNum(pInput.maxConsolidationRange, 6)),
      minAdxForEntry: Math.max(15, toNum(pInput.minAdxForEntry, 20))
    };

    const tm = {
      slTicks: Math.max(1, toNum(tmInput.slTicks, toNum(tmDefaults.slTicks, 25))),
      tpTicks: Math.max(1, toNum(tmInput.tpTicks, toNum(tmDefaults.tpTicks, 35))),
      tickSize: Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))),
      lots: Math.max(0.00001, toNum(tmInput.lots, toNum(strategy && strategy.liveDefaults && strategy.liveDefaults.lots, 1))),
      pointValue: Math.max(0, toNum(tmInput.pointValue, toNum(tmDefaults.pointValue, 1))),
      exitOnOpposite: tmInput.exitOnOpposite !== false,
      bothHitModel: tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first"
    };

      const signalArray = await runNas100HybridScalper({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec || 300,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 25, 1),
      params: p
    });

      // Load candles to map signals to indices
      const m5Msg = await window.LCPro.MarketData.requestCandles(input.instrumentId, 300, input.lookback * 5);
      const candles = m5Msg && m5Msg.candles ? m5Msg.candles : [];

      // Build candle time map for fast lookup
      const candleTimeMap = {};
      for (let i = 0; i < candles.length; i++) {
        const t = candleTimeMs(candles[i]);
        if (t > 0) candleTimeMap[t] = i;
      }

      // Map signals to include idx property
      const allSignals = signalArray.map((sig) => ({
        type: sig.type,
        price: sig.price,
        time: sig.time,
        label: sig.label,
        idx: candleTimeMap[sig.time] !== undefined ? candleTimeMap[sig.time] : 0
      }));

      const report = evaluateSmaFromSignalSet({ allSignals: allSignals, candlesChron: candles }, strategy, p, tm);
    report.rangePreset = input.rangePreset || "week";
    return report;
  }

  async function runNas100VwapLiquiditySweepBacktest(input, strategy) {
    const pInput = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const p = {
      symbol: pInput.symbol || input.instrumentId || "NAS100",
      timeframe: pInput.timeframe || "1m",
      session_start: pInput.session_start || "08:30",
      session_end: pInput.session_end || "11:30",
      timeZone: pInput.timeZone || "America/Chicago",
      risk_per_trade: Math.max(0.01, toNum(pInput.risk_per_trade, 0.5)),
      fixed_lot_size: Math.max(0, toNum(pInput.fixed_lot_size, 0)),
      max_drawdown_percent: Math.max(0, toNum(pInput.max_drawdown_percent, 0)),
      stop_buffer_points: Math.max(0, toNum(pInput.stop_buffer_points, 5)),
      min_sweep_points: Math.max(0, toNum(pInput.min_sweep_points, 3)),
      displacement_body_multiplier: Math.max(0.5, toNum(pInput.displacement_body_multiplier, 1.3)),
      min_volume_ratio: Math.max(0, toNum(pInput.min_volume_ratio, 0)),
      max_spread_points: toNum(pInput.max_spread_points, Infinity),
      news_filter_enabled: !!pInput.news_filter_enabled,
      cooldown_minutes: Math.max(0, toPosInt(pInput.cooldown_minutes, 3, 0)),
      max_consecutive_losses: Math.max(1, toPosInt(pInput.max_consecutive_losses, 2, 1)),
      pause_minutes_after_losses: Math.max(1, toPosInt(pInput.pause_minutes_after_losses, 30, 1)),
      daily_loss_limit_percent: Math.max(0.1, toNum(pInput.daily_loss_limit_percent, 2.0)),
      daily_profit_lock_percent: Math.max(0.1, toNum(pInput.daily_profit_lock_percent, 3.0)),
      allow_long: pInput.allow_long !== false,
      allow_short: pInput.allow_short !== false,
      entry_mode: pInput.entry_mode || "both",
      tp_mode: pInput.tp_mode || "partial_rr",
      tp1_rr: Math.max(0.2, toNum(pInput.tp1_rr, 1.0)),
      tp2_rr: Math.max(0.2, toNum(pInput.tp2_rr, 1.5)),
      move_sl_to_breakeven_after_tp1: pInput.move_sl_to_breakeven_after_tp1 !== false,
      strategy_execution_mode: pInput.strategy_execution_mode || "both",
      allow_same_candle_main_and_burst: !!pInput.allow_same_candle_main_and_burst,
      max_open_trades: Math.max(1, toPosInt(pInput.max_open_trades, 2, 1)),
      min_swing_lookback_candles: Math.max(2, toPosInt(pInput.min_swing_lookback_candles, 5, 2)),
      max_swing_lookback_candles: Math.max(3, toPosInt(pInput.max_swing_lookback_candles, 15, 3)),
      pivot_left_right: Math.max(1, toPosInt(pInput.pivot_left_right, 2, 1)),
      displacement_lookback: Math.max(3, toPosInt(pInput.displacement_lookback, 10, 3)),
      displacement_close_band: Math.min(0.49, Math.max(0.05, toNum(pInput.displacement_close_band, 0.3))),
      tick_size: Math.max(0.00001, toNum(pInput.tick_size, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1)))),
      entry_window_bars: Math.max(1, toPosInt(pInput.entry_window_bars, 8, 1)),
      enable_fvg_filter: pInput.enable_fvg_filter !== false,
      enable_burst_mode: pInput.enable_burst_mode !== false,
      burst_mode_requires_main_bias: pInput.burst_mode_requires_main_bias !== false,
      burst_session_start: pInput.burst_session_start || pInput.session_start || "08:30",
      burst_session_end: pInput.burst_session_end || pInput.session_end || "11:30",
      burst_risk_per_trade: Math.max(0.01, toNum(pInput.burst_risk_per_trade, 0.25)),
      burst_stop_buffer_points: Math.max(0, toNum(pInput.burst_stop_buffer_points, 3)),
      burst_tp_mode: pInput.burst_tp_mode || "points_partial",
      burst_tp1_points: Math.max(1, toNum(pInput.burst_tp1_points, 8)),
      burst_tp2_points: Math.max(1, toNum(pInput.burst_tp2_points, 12)),
      burst_tp1_rr: Math.max(0.2, toNum(pInput.burst_tp1_rr, 0.8)),
      burst_tp2_rr: Math.max(0.2, toNum(pInput.burst_tp2_rr, 1.2)),
      burst_move_sl_to_breakeven_after_tp1: pInput.burst_move_sl_to_breakeven_after_tp1 !== false,
      burst_use_ema_filter: pInput.burst_use_ema_filter !== false,
      burst_fast_ema: Math.max(2, toPosInt(pInput.burst_fast_ema, 9, 2)),
      burst_slow_ema: Math.max(3, toPosInt(pInput.burst_slow_ema, 20, 3)),
      burst_displacement_multiplier: Math.max(0.8, toNum(pInput.burst_displacement_multiplier, 1.2)),
      burst_max_entries_per_leg: Math.max(1, toPosInt(pInput.burst_max_entries_per_leg, 3, 1)),
      burst_max_open_trades: Math.max(1, toPosInt(pInput.burst_max_open_trades, 1, 1)),
      burst_cooldown_minutes: Math.max(0, toPosInt(pInput.burst_cooldown_minutes, 1, 0)),
      burst_disable_after_consecutive_losses: Math.max(1, toPosInt(pInput.burst_disable_after_consecutive_losses, 2, 1)),
      burst_pause_minutes_after_loss_streak: Math.max(1, toPosInt(pInput.burst_pause_minutes_after_loss_streak, 30, 1)),
      burst_require_volume_confirmation: !!pInput.burst_require_volume_confirmation,
      burst_volume_multiplier: Math.max(0.5, toNum(pInput.burst_volume_multiplier, 1.1)),
      burst_min_momentum_score: Math.max(0, toNum(pInput.burst_min_momentum_score, 2.0)),
      burst_min_candle_range_points: Math.max(0, toNum(pInput.burst_min_candle_range_points, 3)),
      burst_min_pullback_quality_score: Math.max(0, toNum(pInput.burst_min_pullback_quality_score, 1.0)),
      burst_ema_distance_max_points: Math.max(0.5, toNum(pInput.burst_ema_distance_max_points, 6)),
      burst_volume_spike_multiplier: Math.max(0.5, toNum(pInput.burst_volume_spike_multiplier, 1.0)),
      burst_max_spread_points: toNum(pInput.burst_max_spread_points, toNum(pInput.max_spread_points, Infinity)),
      burst_pullback_retrace_max: Math.max(0.1, Math.min(0.9, toNum(pInput.burst_pullback_retrace_max, 0.45))),
      burst_trend_lookback: Math.max(3, toPosInt(pInput.burst_trend_lookback, 5, 3)),
      burst_chop_lookback: Math.max(5, toPosInt(pInput.burst_chop_lookback, 8, 5)),
      debug_mode: !!pInput.debug_mode
    };

    const tm = {
      tickSize: Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))),
      pointValue: Math.max(0.00001, toNum(tmInput.pointValue, toNum(tmDefaults.pointValue, 1))),
      initialEquity: Math.max(100, toNum(tmInput.initialEquity, toNum(tmDefaults.initialEquity, 100000))),
      bothHitModel: tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first"
    };

    const set = await window.LCPro.Backtest.buildNas100VwapLiquiditySweepSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 25, 1),
      rangePreset: input.rangePreset || "week",
      timeZone: p.timeZone,
      sessionStart: p.session_start,
      sessionEnd: p.session_end,
      minSwingLookbackCandles: p.min_swing_lookback_candles,
      maxSwingLookbackCandles: p.max_swing_lookback_candles,
      pivotLeftRight: p.pivot_left_right,
      minSweepPoints: p.min_sweep_points,
      displacementBodyMultiplier: p.displacement_body_multiplier,
      displacementLookback: p.displacement_lookback,
      displacementCloseBand: p.displacement_close_band,
      minVolumeRatio: p.min_volume_ratio,
      tickSize: p.tick_size,
      allowLong: p.allow_long,
      allowShort: p.allow_short,
      fvgEnabled: p.enable_fvg_filter,
      debug: p.debug_mode
    });

    const report = evaluateNas100VwapLiquiditySweepFromSignalSet(set, strategy, p, tm);
    report.rangePreset = input.rangePreset || "week";
    return report;
  }

  async function runNas100RsiSrStochBacktest(input, strategy) {
    const pInput = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const p = {
      rsiLen: toPosInt(pInput.rsiLen, 14, 2),
      trendEmaLen: toPosInt(pInput.trendEmaLen, 50, 5),
      fastEmaLen: toPosInt(pInput.fastEmaLen, 9, 2),
      slowEmaLen: toPosInt(pInput.slowEmaLen, 21, 3),
      stochLen: toPosInt(pInput.stochLen, 14, 3),
      stochSmoothK: toPosInt(pInput.stochSmoothK, 3, 1),
      stochSmoothD: toPosInt(pInput.stochSmoothD, 3, 1),
      stochLower: Math.max(1, toNum(pInput.stochLower, 40)),
      stochUpper: Math.min(99, toNum(pInput.stochUpper, 65)),
      rsiBuyMax: Math.max(1, toNum(pInput.rsiBuyMax, 50)),
      rsiSellMin: Math.min(99, toNum(pInput.rsiSellMin, 50)),
      srLookback: toPosInt(pInput.srLookback, 20, 5),
      srBufferTicks: Math.max(0, toNum(pInput.srBufferTicks, 4)),
      trendSlopeBars: toPosInt(pInput.trendSlopeBars, 3, 1),
      cooldownBars: Math.max(0, toPosInt(pInput.cooldownBars, 1, 0)),
      tickSize: Math.max(0.00001, toNum(pInput.tickSize, 1))
    };

    const tm = {
      slTicks: Math.max(1, toNum(tmInput.slTicks, toNum(tmDefaults.slTicks, 7))),
      tpTicks: Math.max(1, toNum(tmInput.tpTicks, toNum(tmDefaults.tpTicks, 6))),
      tickSize: Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))),
      lots: Math.max(0.00001, toNum(tmInput.lots, toNum(strategy && strategy.liveDefaults && strategy.liveDefaults.lots, 0.01))),
      pointValue: Math.max(0, toNum(tmInput.pointValue, toNum(tmDefaults.pointValue, 1))),
      exitOnOpposite: tmInput.exitOnOpposite !== false,
      bothHitModel: tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first",
      tpMode: tmInput.tpMode || tmDefaults.tpMode || "fixed",
      slMode: tmInput.slMode || tmDefaults.slMode || "fixed",
      dynamicRangeLookback: Math.max(1, toPosInt(tmInput.dynamicRangeLookback, toPosInt(tmDefaults.dynamicRangeLookback, 8, 1), 1)),
      tpRangeMultiplier: Math.max(0.1, toNum(tmInput.tpRangeMultiplier, toNum(tmDefaults.tpRangeMultiplier, 1))),
      slRangeMultiplier: Math.max(0.1, toNum(tmInput.slRangeMultiplier, toNum(tmDefaults.slRangeMultiplier, 1))),
      minDynamicTpTicks: Math.max(1, toNum(tmInput.minDynamicTpTicks, toNum(tmDefaults.minDynamicTpTicks, 4))),
      maxDynamicTpTicks: Math.max(1, toNum(tmInput.maxDynamicTpTicks, toNum(tmDefaults.maxDynamicTpTicks, 12))),
      minDynamicSlTicks: Math.max(1, toNum(tmInput.minDynamicSlTicks, toNum(tmDefaults.minDynamicSlTicks, 4))),
      maxDynamicSlTicks: Math.max(1, toNum(tmInput.maxDynamicSlTicks, toNum(tmDefaults.maxDynamicSlTicks, 12))),
      breakEvenTriggerTicks: Math.max(0, toNum(tmInput.breakEvenTriggerTicks, toNum(tmDefaults.breakEvenTriggerTicks, 0))),
      trailingStopTicks: Math.max(0, toNum(tmInput.trailingStopTicks, toNum(tmDefaults.trailingStopTicks, 0))),
      trailingActivationTicks: Math.max(0, toNum(tmInput.trailingActivationTicks, toNum(tmDefaults.trailingActivationTicks, 0))),
      maxBarsInTrade: Math.max(0, toPosInt(tmInput.maxBarsInTrade, toPosInt(tmDefaults.maxBarsInTrade, 0, 0), 0))
    };

    const set = await window.LCPro.Backtest.buildNas100RsiSrStochSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 50, 1),
      rangePreset: input.rangePreset || "week",
      rsiLen: p.rsiLen,
      trendEmaLen: p.trendEmaLen,
      fastEmaLen: p.fastEmaLen,
      slowEmaLen: p.slowEmaLen,
      stochLen: p.stochLen,
      stochSmoothK: p.stochSmoothK,
      stochSmoothD: p.stochSmoothD,
      stochLower: p.stochLower,
      stochUpper: p.stochUpper,
      rsiBuyMax: p.rsiBuyMax,
      rsiSellMin: p.rsiSellMin,
      srLookback: p.srLookback,
      srBufferTicks: p.srBufferTicks,
      trendSlopeBars: p.trendSlopeBars,
      cooldownBars: p.cooldownBars,
      tickSize: p.tickSize
    });

    const report = evaluateSmaFromSignalSet(set, strategy, p, tm);
    report.rangePreset = input.rangePreset || "week";
    return report;
  }

  function scoreTowardTarget(summary, targetWinRate) {
    const wr = toNum(summary && summary.winRate, 0);
    return -Math.abs(wr - targetWinRate);
  }

  function isBetterCandidate(a, b, targetWinRate) {
    if (!b) return false;
    if (!a) return true;

    const aScore = scoreTowardTarget(a.summary, targetWinRate);
    const bScore = scoreTowardTarget(b.summary, targetWinRate);
    if (bScore !== aScore) return bScore > aScore;

    const aWin = toNum(a.summary.winRate, 0);
    const bWin = toNum(b.summary.winRate, 0);
    if (bWin !== aWin) return bWin > aWin;

    const aGross = toNum(a.summary.grossTicks, 0);
    const bGross = toNum(b.summary.grossTicks, 0);
    if (bGross !== aGross) return bGross > aGross;

    return toNum(b.summary.totalTrades, 0) > toNum(a.summary.totalTrades, 0);
  }

  function getChangedFields(baseObj, bestObj, label) {
    const out = [];
    const keys = Object.keys(bestObj || {});
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const a = baseObj ? baseObj[k] : undefined;
      const b = bestObj[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        out.push(`${label}.${k}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      }
    }
    return out;
  }

  async function optimizeSmaBacktest(input, strategy, options) {
    const targetWinRate = toNum(options && options.targetWinRate, 60);
    const maxCandidates = Math.max(10, Math.min(300, toPosInt(options && options.maxCandidates, 120, 10)));

    const baseParams = Object.assign({}, strategy.defaultParams, (input && input.params) || {});
    const baseTM = Object.assign({}, strategy.tradeManagementDefaults || {}, (input && input.tradeManagement) || {});

    const lookback = toPosInt(input && input.lookback, 3000, 200);
    const candlesMsg = await window.LCPro.MarketData.requestCandles(input.instrumentId, input.timeframeSec, lookback);
    const candles = candlesMsg && candlesMsg.candles ? candlesMsg.candles : null;
    if (!candles || candles.length < 100) {
      throw new Error("Not enough candles for optimization");
    }

    const keepN = toPosInt(input && input.keepN, 25, 1);
    const rangePreset = (input && input.rangePreset) || "week";

    const fastVals = spreadInts(toPosInt(baseParams.fastLen, 9, 2), [-4, -2, 0, 2, 4], 2, 120);
    const slowVals = spreadInts(toPosInt(baseParams.slowLen, 21, 3), [-10, -5, 0, 5, 10], 4, 260);
    const tpVals = spreadFloats(Math.max(1, toNum(baseTM.tpTicks, 55)), [0.7, 0.85, 1, 1.15, 1.3], 3, 500, 1);
    const slVals = spreadFloats(Math.max(1, toNum(baseTM.slTicks, 55)), [0.7, 0.85, 1, 1.15, 1.3], 3, 400, 1);

    const candidates = [];
    for (let fi = 0; fi < fastVals.length; fi++) {
      for (let si = 0; si < slowVals.length; si++) {
        if (fastVals[fi] >= slowVals[si]) continue;
        for (let ti = 0; ti < tpVals.length; ti++) {
          for (let li = 0; li < slVals.length; li++) {
            candidates.push({
              fastLen: fastVals[fi],
              slowLen: slowVals[si],
              tpTicks: tpVals[ti],
              slTicks: slVals[li]
            });
          }
        }
      }
    }

    const sampled = candidates.slice(0, maxCandidates);
    let bestCandidate = null;

    for (let i = 0; i < sampled.length; i++) {
      const c = sampled[i];
      const p = Object.assign({}, baseParams, { fastLen: c.fastLen, slowLen: c.slowLen });
      const tm = Object.assign({}, baseTM, { tpTicks: c.tpTicks, slTicks: c.slTicks });

      const signalSet = window.LCPro.Backtest.buildSmaSignalSetFromCandles(candles, {
        fastLen: p.fastLen,
        slowLen: p.slowLen,
        keepN,
        rangePreset
      });
      const report = evaluateSmaFromSignalSet(signalSet, strategy, p, tm);
      const candidate = {
        params: p,
        tradeManagement: tm,
        summary: report.summary,
        report
      };
      if (isBetterCandidate(bestCandidate, candidate, targetWinRate)) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      throw new Error("No optimization candidates evaluated");
    }

    const baseline = await runSmaBacktest(input || {}, strategy);
    const changed = [
      ...getChangedFields(baseParams, bestCandidate.params, "params"),
      ...getChangedFields(baseTM, bestCandidate.tradeManagement, "tradeManagement")
    ];

    const explanation = [];
    explanation.push(`Target win rate: ${targetWinRate.toFixed(2)}%`);
    explanation.push(`Evaluated candidates: ${sampled.length}`);
    explanation.push(`Baseline win rate: ${toNum(baseline.summary.winRate, 0).toFixed(2)}%`);
    explanation.push(`Optimized win rate: ${toNum(bestCandidate.summary.winRate, 0).toFixed(2)}%`);
    explanation.push(`Baseline trades: ${baseline.summary.totalTrades}`);
    explanation.push(`Optimized trades: ${bestCandidate.summary.totalTrades}`);
    explanation.push(`Baseline gross ticks: ${toNum(baseline.summary.grossTicks, 0).toFixed(2)}`);
    explanation.push(`Optimized gross ticks: ${toNum(bestCandidate.summary.grossTicks, 0).toFixed(2)}`);
    if (changed.length) {
      explanation.push("Changes selected:");
      for (let i = 0; i < changed.length; i++) explanation.push(`- ${changed[i]}`);
    } else {
      explanation.push("No parameter changes from baseline were required.");
    }

    const bestReport = Object.assign({}, bestCandidate.report, { rangePreset });
    return {
      strategyId: strategy.id,
      targetWinRate,
      evaluated: sampled.length,
      baseline,
      best: bestReport,
      bestParams: bestCandidate.params,
      bestTradeManagement: bestCandidate.tradeManagement,
      explanation: explanation.join("\n")
    };
  }

  const STRATEGIES = {
    sma_crossover: {
      id: "sma_crossover",
      name: "SMA Crossover",
      notes: "Fast SMA crossing Slow SMA on closed candles.",
      liveDefaults: {
        instrumentId: "NAS100",
        timeframeSec: 900,
        lookback: 900,
        lots: 0.01,
        tpTicks: 0,
        slTicks: 0,
        tickSize: 1
      },
      defaultParams: { fastLen: 9, slowLen: 21, timeframeSec: 900, tpTicks: 0, slTicks: 0 },
      tradeManagementDefaults: {
        slTicks: 55,
        tpTicks: 55,
        tickSize: 1,
        pointValue: 1,
        exitOnOpposite: true,
        bothHitModel: "sl_first"
      },
      runSignals: runSmaCrossover
    },
    nas100_hybrid_scalper: {
      id: "nas100_hybrid_scalper",
      name: "NAS100 Hybrid Scalper (Trend+Wick)",
      notes: "2-mode scalper combining trend-burst continuation (Setup A) and wick-rejection at key zones (Setup B) with M5 trend filter and consolidation detection.",
      liveDefaults: {
        instrumentId: "NAS100",
        timeframeSec: 300,
        lookback: 400,
        lots: 0.01,
        tpTicks: 35,
        slTicks: 25,
        tickSize: 1
      },
      defaultParams: {
        timeZone: "America/Chicago",
        sessionStart: "09:35",
        sessionEnd: "11:30",
        altSessionStart: "14:00",
        altSessionEnd: "15:30",
        useAltSession: false,
        allowAltSession: true,
        skipFirstMinutes: 5,
        m5EmaFast: 20,
        m5EmaSlow: 50,
        m5AdxLen: 14,
        m5AdxThreshold: 22,
        trendBurstMode: true,
        wickRejectionMode: true,
        pullbackRetraceMax: 0.45,
        minCandleRangePoints: 2,
        consolidationLookback: 10,
        maxConsolidationRange: 6,
        minAdxForEntry: 20,
        tickSize: 1
      },
      tradeManagementDefaults: {
        slTicks: 25,
        tpTicks: 35,
        tickSize: 1,
        pointValue: 1,
        exitOnOpposite: true,
        bothHitModel: "sl_first"
      },
      runSignals: runNas100HybridScalper
    },
    nas100_vwap_liquidity_sweep_fvg_scalper: {
      id: "nas100_vwap_liquidity_sweep_fvg_scalper",
      name: "NAS100_VWAP_LIQUIDITY_SWEEP_FVG_SCALPER",
      notes:
        "M1 NAS100 session VWAP bias + liquidity sweep rejection + displacement + optional FVG entries with strict risk controls.",
      liveDefaults: {
        instrumentId: "NAS100",
        timeframeSec: 60,
        lookback: 1500,
        lots: 0.01,
        tpTicks: 0,
        slTicks: 0,
        tickSize: 1
      },
      defaultParams: {
        symbol: "NAS100",
        timeframe: "1m",
        session_start: "08:30",
        session_end: "11:30",
        timeZone: "America/Chicago",
        risk_per_trade: 0.5,
        stop_buffer_points: 5,
        min_sweep_points: 3,
        displacement_body_multiplier: 1.3,
        cooldown_minutes: 3,
        max_consecutive_losses: 2,
        pause_minutes_after_losses: 30,
        daily_loss_limit_percent: 2.0,
        daily_profit_lock_percent: 3.0,
        allow_long: true,
        allow_short: true,
        entry_mode: "both",
        tp_mode: "partial_rr",
        tp1_rr: 1.0,
        tp2_rr: 1.5,
        move_sl_to_breakeven_after_tp1: true,
        strategy_execution_mode: "both",
        allow_same_candle_main_and_burst: false,
        max_open_trades: 2,
        min_swing_lookback_candles: 5,
        max_swing_lookback_candles: 15,
        pivot_left_right: 2,
        displacement_lookback: 10,
        displacement_close_band: 0.3,
        min_volume_ratio: 0,
        max_spread_points: 999,
        news_filter_enabled: false,
        enable_fvg_filter: true,
        entry_window_bars: 8,
        enable_burst_mode: true,
        burst_mode_requires_main_bias: true,
        burst_session_start: "08:30",
        burst_session_end: "11:30",
        burst_risk_per_trade: 0.25,
        burst_stop_buffer_points: 3,
        burst_tp_mode: "points_partial",
        burst_tp1_points: 8,
        burst_tp2_points: 12,
        burst_tp1_rr: 0.8,
        burst_tp2_rr: 1.2,
        burst_move_sl_to_breakeven_after_tp1: true,
        burst_use_ema_filter: true,
        burst_fast_ema: 9,
        burst_slow_ema: 20,
        burst_displacement_multiplier: 1.2,
        burst_max_entries_per_leg: 3,
        burst_max_open_trades: 1,
        burst_cooldown_minutes: 1,
        burst_disable_after_consecutive_losses: 2,
        burst_pause_minutes_after_loss_streak: 30,
        burst_require_volume_confirmation: false,
        burst_volume_multiplier: 1.1,
        burst_min_momentum_score: 2.0,
        burst_min_candle_range_points: 3,
        burst_min_pullback_quality_score: 1.0,
        burst_ema_distance_max_points: 6,
        burst_volume_spike_multiplier: 1.0,
        burst_max_spread_points: 999,
        burst_pullback_retrace_max: 0.45,
        burst_trend_lookback: 5,
        burst_chop_lookback: 8,
        tick_size: 1,
        debug_mode: true
      },
      tradeManagementDefaults: {
        tickSize: 1,
        pointValue: 1,
        initialEquity: 100000,
        bothHitModel: "sl_first"
      },
      runSignals: runNas100VwapLiquiditySweepScalper
    },
    nas100_rsi_sr_stoch_scalper: {
      id: "nas100_rsi_sr_stoch_scalper",
      name: "NAS100 RSI+SR+Stoch Scalper (M1)",
      notes:
        "M1 momentum pullback scalper using trend EMA filter + support/resistance touch + RSI recovery + stochastic cross, with optional adaptive exit controls.",
      liveDefaults: {
        instrumentId: "NAS100",
        timeframeSec: 60,
        lookback: 1500,
        lots: 0.01,
        tpTicks: 6,
        slTicks: 7,
        tickSize: 1
      },
      defaultParams: {
        rsiLen: 14,
        trendEmaLen: 50,
        fastEmaLen: 9,
        slowEmaLen: 21,
        stochLen: 14,
        stochSmoothK: 3,
        stochSmoothD: 3,
        stochLower: 40,
        stochUpper: 65,
        rsiBuyMax: 50,
        rsiSellMin: 50,
        srLookback: 20,
        srBufferTicks: 4,
        trendSlopeBars: 3,
        cooldownBars: 1,
        tickSize: 1
      },
      tradeManagementDefaults: {
        slTicks: 7,
        tpTicks: 6,
        tickSize: 1,
        pointValue: 1,
        exitOnOpposite: true,
        bothHitModel: "sl_first",
        tpMode: "fixed",
        slMode: "fixed",
        dynamicRangeLookback: 8,
        tpRangeMultiplier: 1.2,
        slRangeMultiplier: 1.0,
        minDynamicTpTicks: 4,
        maxDynamicTpTicks: 12,
        minDynamicSlTicks: 4,
        maxDynamicSlTicks: 12,
        breakEvenTriggerTicks: 3,
        trailingStopTicks: 0,
        trailingActivationTicks: 0,
        maxBarsInTrade: 5
      },
      runSignals: runNas100RsiSrStochScalper
    }
  };

  function getStrategy(id) {
    return STRATEGIES[id] || null;
  }

  async function runSignals(id, input) {
    const s = getStrategy(id);
    if (!s || typeof s.runSignals !== "function") {
      throw new Error("Strategy not found or has no runner: " + id);
    }
    return await s.runSignals(input || {});
  }

  async function runBacktest(id, input) {
    const s = getStrategy(id);
    if (!s) throw new Error("Strategy not found: " + id);
    if (id === "sma_crossover") {
      return await runSmaBacktest(input || {}, s);
    }
    if (id === "nas100_hybrid_scalper") {
      return await runNas100HybridBacktest(input || {}, s);
    }
    if (id === "nas100_vwap_liquidity_sweep_fvg_scalper") {
      return await runNas100VwapLiquiditySweepBacktest(input || {}, s);
    }
    if (id === "nas100_rsi_sr_stoch_scalper") {
      return await runNas100RsiSrStochBacktest(input || {}, s);
    }
    throw new Error("Backtest runner not implemented for strategy: " + id);
  }

  async function optimizeBacktest(id, input, options) {
    const s = getStrategy(id);
    if (!s) throw new Error("Strategy not found: " + id);
    if (id === "sma_crossover") {
      return await optimizeSmaBacktest(input || {}, s, options || {});
    }
    throw new Error("Optimizer not implemented for strategy: " + id);
  }

  LCPro.Strategy = {
    STRATEGIES,
    getStrategy,
    runSignals,
    runBacktest,
    optimizeBacktest
  };
})();
