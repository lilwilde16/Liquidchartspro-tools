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

  async function runNas100MomentumScalper(input) {
    const p = (input && input.params) || {};
    const tickSize = Math.max(0.00001, toNum(p.tickSize, 1));
    const set = await window.LCPro.Backtest.buildNas100MomentumSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 25, 1),
      rangePreset: input.rangePreset || "week",
      fastEma: toPosInt(p.fastEma, 18, 3),
      slowEma: toPosInt(p.slowEma, 55, 8),
      breakoutLen: toPosInt(p.breakoutLen, 8, 3),
      breakoutBufferTicks: Math.max(0, toNum(p.breakoutBufferTicks, 3)),
      atrShortLen: toPosInt(p.atrShortLen, 8, 2),
      atrLongLen: toPosInt(p.atrLongLen, 34, 5),
      minAtrRatio: Math.max(0.5, toNum(p.minAtrRatio, 1.12)),
      slopeLen: toPosInt(p.slopeLen, 5, 2),
      minSlopeTicks: Math.max(0, toNum(p.minSlopeTicks, 20)),
      rangeLen: toPosInt(p.rangeLen, 14, 4),
      minRangeTicks: Math.max(1, toNum(p.minRangeTicks, 55)),
      cooldownBars: toPosInt(p.cooldownBars, 3, 0),
      tickSize
    });
    return set.signals || [];
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

    const candles = set.candlesChron || [];
    const vwap = set.vwap || [];
    const signals = set.allSignals || [];

    const signalsByIdx = {};
    for (let i = 0; i < signals.length; i++) {
      const idx = Number(signals[i].idx);
      if (!signalsByIdx[idx]) signalsByIdx[idx] = [];
      signalsByIdx[idx].push(signals[i]);
    }

    let equity = initialEquity;
    let dayKey = "";
    let dayStartEquity = initialEquity;
    let dayLocked = false;
    let consecutiveLosses = 0;
    let pauseUntilMs = 0;
    let lastFlatExitMs = 0;

    const pending = [];
    const openTrades = [];
    const trades = [];
    const decisionLog = [];

    function logDecision(payload) {
      if (debugMode) decisionLog.push(payload);
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
      trades.push({
        trade: trades.length + 1,
        side: trade.side,
        entryTime: trade.entryTime,
        entryPrice: trade.entryPrice,
        exitTime,
        exitPrice,
        exitReason,
        pnlTicks: trade.realizedPnlTicks,
        pnlR: trade.riskPoints > 0 ? trade.realizedPnlTicks / (trade.riskPoints / tickSize) : 0,
        qty: trade.qty,
        tp1Hit: !!trade.tp1Hit,
        signalReason: trade.entryReason
      });

      if (trade.realizedPnlCurrency < 0) {
        consecutiveLosses += 1;
        if (consecutiveLosses >= maxConsecutiveLosses) {
          pauseUntilMs = exitTime + pauseMinutesAfterLosses * 60 * 1000;
        }
      } else {
        consecutiveLosses = 0;
      }

      lastFlatExitMs = exitTime;
    }

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i] || {};
      const t = window.LCPro.Backtest.candleTimeMs(c);
      const o = Number(c.o);
      const h = Number(c.h);
      const l = Number(c.l);
      const cl = Number(c.c);
      const vw = Number(vwap[i]);

      if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) {
        continue;
      }

      const currentDay = getDayKey(t, timeZone);
      if (currentDay !== dayKey) {
        dayKey = currentDay;
        dayStartEquity = equity;
        dayLocked = false;
        consecutiveLosses = 0;
      }

      const dayPnLPct = dayStartEquity > 0 ? ((equity - dayStartEquity) / dayStartEquity) * 100 : 0;
      if (dayPnLPct <= -dailyLossLimitPct || dayPnLPct >= dailyProfitLockPct) dayLocked = true;

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
              if (moveToBeAfterTp1) tr.stopPrice = tr.entryPrice;
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
            if (moveToBeAfterTp1) tr.stopPrice = tr.entryPrice;
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

      if (signalsByIdx[i] && signalsByIdx[i].length) {
        for (let s = 0; s < signalsByIdx[i].length; s++) {
          pending.push({ signal: signalsByIdx[i][s], expiresAt: i + entryWindowBars, entered: false });
        }
      }

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
          logDecision({ time: t, idx: i, blocked: true, reason: "max_open_trades", side: sig.type });
          continue;
        }
        if (dayLocked) {
          logDecision({ time: t, idx: i, blocked: true, reason: "daily_lock", side: sig.type });
          continue;
        }
        if (t < pauseUntilMs) {
          logDecision({ time: t, idx: i, blocked: true, reason: "loss_pause", side: sig.type });
          continue;
        }
        if (lastFlatExitMs && t - lastFlatExitMs < cooldownMinutes * 60 * 1000) {
          logDecision({ time: t, idx: i, blocked: true, reason: "cooldown", side: sig.type });
          continue;
        }

        const spreadPoints = Number(c.spreadPoints || c.spread || 0);
        if (Number.isFinite(maxSpreadPoints) && Number.isFinite(spreadPoints) && spreadPoints > maxSpreadPoints) {
          logDecision({ time: t, idx: i, blocked: true, reason: "spread_filter", spreadPoints, side: sig.type });
          continue;
        }

        if (newsFilterEnabled) {
          // Placeholder hook: connect broker/news calendar feed here.
          const newsBlocked = false;
          if (newsBlocked) {
            logDecision({ time: t, idx: i, blocked: true, reason: "news_filter", side: sig.type });
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

        const stopPrice =
          sig.type === "BUY"
            ? Number(setup.sweepWick) - stopBufferPoints
            : Number(setup.sweepWick) + stopBufferPoints;
        const riskPoints = Math.abs(entry.entryPrice - stopPrice);
        if (!Number.isFinite(riskPoints) || riskPoints <= 0) {
          logDecision({ time: t, idx: i, blocked: true, reason: "invalid_risk", side: sig.type });
          pending.splice(q, 1);
          continue;
        }

        const riskAmount = equity * (riskPerTradePct / 100);
        const qty = riskAmount / (riskPoints * pointValue);
        if (!Number.isFinite(qty) || qty <= 0) {
          logDecision({ time: t, idx: i, blocked: true, reason: "position_size_failed", side: sig.type });
          pending.splice(q, 1);
          continue;
        }

        const tp1Price = sig.type === "BUY" ? entry.entryPrice + riskPoints * tp1Rr : entry.entryPrice - riskPoints * tp1Rr;
        const modeTarget = targetByMode(tpMode, sig.type, entry.entryPrice, riskPoints, vw, setup, tp2Rr);
        const tp2Price =
          tpMode === "partial_rr"
            ? targetByMode("next_liquidity", sig.type, entry.entryPrice, riskPoints, vw, setup, tp2Rr)
            : modeTarget;

        openTrades.push({
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
          entryReason: entry.reason,
          realizedPnlCurrency: 0,
          realizedPnlTicks: 0,
          closed: false
        });

        logDecision({
          time: t,
          idx: i,
          allowed: true,
          reason: entry.reason,
          side: sig.type,
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

    let wins = 0;
    let losses = 0;
    let grossTicks = 0;
    let grossCurrency = 0;
    let avgR = 0;
    for (let i = 0; i < trades.length; i++) {
      const tr = trades[i];
      grossTicks += Number(tr.pnlTicks || 0);
      const points = Number(tr.pnlTicks || 0) * tickSize;
      grossCurrency += points * pointValue;
      avgR += Number(tr.pnlR || 0);
      if (Number(tr.pnlTicks || 0) >= 0) wins += 1;
      else losses += 1;
    }
    avgR = trades.length ? avgR / trades.length : 0;

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
        newsFilterEnabled,
        bothHitModel
      },
      summary: {
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length ? (wins / trades.length) * 100 : 0,
        grossTicks,
        grossCurrency,
        avgR,
        endingEquity: equity
      },
      trades,
      signals: set.signals || [],
      verification: Object.assign({}, set.verification || {}, {
        pendingSignalsFinal: pending.length,
        decisionsLogged: decisionLog.length,
        dayLockEnabled: true,
        lossPauseMinutes: pauseMinutesAfterLosses
      }),
      debug: {
        signalDebugRows: set.debugRows || [],
        decisionLog
      }
    };
  }

  function evaluateSmaFromSignalSet(set, strategy, strategyParams, tradeManagement) {
    const p = strategyParams || {};
    const tm = tradeManagement || {};

    const slTicks = Math.max(1, toNum(tm.slTicks, 55));
    const tpTicks = Math.max(1, toNum(tm.tpTicks, 55));
    const tickSize = Math.max(0.00001, toNum(tm.tickSize, 1));
    const exitOnOpposite = tm.exitOnOpposite !== false;
    const bothHitModel = tm.bothHitModel === "tp_first" ? "tp_first" : "sl_first";

    const signals = set.allSignals || [];
    const candles = set.candlesChron || [];
    const byIdx = {};
    for (let i = 0; i < signals.length; i++) byIdx[signals[i].idx] = signals[i];

    const trades = [];
    let wins = 0;
    let losses = 0;
    let grossTicks = 0;

    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      const side = sig.type;
      const entry = Number(sig.price);
      if (!Number.isFinite(entry)) continue;

      const tpPrice = side === "BUY" ? entry + tpTicks * tickSize : entry - tpTicks * tickSize;
      const slPrice = side === "BUY" ? entry - slTicks * tickSize : entry + slTicks * tickSize;

      let exitPrice = entry;
      let exitTime = sig.time;
      let exitReason = "end_of_data";

      for (let j = sig.idx + 1; j < candles.length; j++) {
        const c = candles[j] || {};
        const h = Number(c.h);
        const l = Number(c.l);
        const close = Number(c.c);
        const t = window.LCPro.Backtest.candleTimeMs(c);

        const hitTp = side === "BUY" ? h >= tpPrice : l <= tpPrice;
        const hitSl = side === "BUY" ? l <= slPrice : h >= slPrice;

        if (hitTp && hitSl) {
          exitPrice = bothHitModel === "tp_first" ? tpPrice : slPrice;
          exitReason = bothHitModel === "tp_first" ? "both_hit_tp_first" : "both_hit_sl_first";
          exitTime = t || exitTime;
          break;
        }
        if (hitTp) {
          exitPrice = tpPrice;
          exitReason = "tp";
          exitTime = t || exitTime;
          break;
        }
        if (hitSl) {
          exitPrice = slPrice;
          exitReason = "sl";
          exitTime = t || exitTime;
          break;
        }

        if (exitOnOpposite && byIdx[j] && byIdx[j].type !== side) {
          exitPrice = Number.isFinite(close) ? close : entry;
          exitReason = "opposite_signal";
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
      const pnlR = slTicks > 0 ? pnlTicks / slTicks : 0;

      if (pnlTicks >= 0) wins += 1;
      else losses += 1;
      grossTicks += pnlTicks;

      trades.push({
        trade: trades.length + 1,
        side,
        entryTime: sig.time,
        entryPrice: entry,
        exitTime,
        exitPrice,
        exitReason,
        pnlTicks,
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
      tradeManagement: { slTicks, tpTicks, tickSize, exitOnOpposite, bothHitModel },
      summary: {
        totalTrades,
        wins,
        losses,
        winRate,
        grossTicks,
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

  async function runNas100MomentumBacktest(input, strategy) {
    const pInput = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const p = {
      fastEma: toPosInt(pInput.fastEma, 18, 3),
      slowEma: toPosInt(pInput.slowEma, 55, 8),
      breakoutLen: toPosInt(pInput.breakoutLen, 8, 3),
      breakoutBufferTicks: Math.max(0, toNum(pInput.breakoutBufferTicks, 3)),
      atrShortLen: toPosInt(pInput.atrShortLen, 8, 2),
      atrLongLen: toPosInt(pInput.atrLongLen, 34, 5),
      minAtrRatio: Math.max(0.5, toNum(pInput.minAtrRatio, 1.12)),
      slopeLen: toPosInt(pInput.slopeLen, 5, 2),
      minSlopeTicks: Math.max(0, toNum(pInput.minSlopeTicks, 20)),
      rangeLen: toPosInt(pInput.rangeLen, 14, 4),
      minRangeTicks: Math.max(1, toNum(pInput.minRangeTicks, 55)),
      cooldownBars: toPosInt(pInput.cooldownBars, 3, 0),
      tickSize: Math.max(0.00001, toNum(pInput.tickSize, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))))
    };

    const tm = {
      slTicks: Math.max(1, toNum(tmInput.slTicks, toNum(tmDefaults.slTicks, 28))),
      tpTicks: Math.max(1, toNum(tmInput.tpTicks, toNum(tmDefaults.tpTicks, 32))),
      tickSize: Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1))),
      exitOnOpposite: tmInput.exitOnOpposite !== false,
      bothHitModel: tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first"
    };

    const set = await window.LCPro.Backtest.buildNas100MomentumSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      keepN: toPosInt(input && input.keepN, 25, 1),
      rangePreset: input.rangePreset || "week",
      fastEma: p.fastEma,
      slowEma: p.slowEma,
      breakoutLen: p.breakoutLen,
      breakoutBufferTicks: p.breakoutBufferTicks,
      atrShortLen: p.atrShortLen,
      atrLongLen: p.atrLongLen,
      minAtrRatio: p.minAtrRatio,
      slopeLen: p.slopeLen,
      minSlopeTicks: p.minSlopeTicks,
      rangeLen: p.rangeLen,
      minRangeTicks: p.minRangeTicks,
      cooldownBars: p.cooldownBars,
      tickSize: p.tickSize
    });

    const report = evaluateSmaFromSignalSet(set, strategy, p, tm);
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
      max_open_trades: Math.max(1, toPosInt(pInput.max_open_trades, 2, 1)),
      min_swing_lookback_candles: Math.max(2, toPosInt(pInput.min_swing_lookback_candles, 5, 2)),
      max_swing_lookback_candles: Math.max(3, toPosInt(pInput.max_swing_lookback_candles, 15, 3)),
      pivot_left_right: Math.max(1, toPosInt(pInput.pivot_left_right, 2, 1)),
      displacement_lookback: Math.max(3, toPosInt(pInput.displacement_lookback, 10, 3)),
      displacement_close_band: Math.min(0.49, Math.max(0.05, toNum(pInput.displacement_close_band, 0.3))),
      tick_size: Math.max(0.00001, toNum(pInput.tick_size, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1)))),
      entry_window_bars: Math.max(1, toPosInt(pInput.entry_window_bars, 8, 1)),
      enable_fvg_filter: pInput.enable_fvg_filter !== false,
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
      defaultParams: { fastLen: 9, slowLen: 21 },
      tradeManagementDefaults: {
        slTicks: 55,
        tpTicks: 55,
        tickSize: 1,
        exitOnOpposite: true,
        bothHitModel: "sl_first"
      },
      runSignals: runSmaCrossover
    },
    nas100_momentum_scalper: {
      id: "nas100_momentum_scalper",
      name: "NAS100 Momentum Scalper",
      notes: "Fast trend-following breakout entries with ATR momentum and anti-consolidation filters.",
      defaultParams: {
        fastEma: 18,
        slowEma: 55,
        breakoutLen: 8,
        breakoutBufferTicks: 3,
        atrShortLen: 8,
        atrLongLen: 34,
        minAtrRatio: 1.12,
        slopeLen: 5,
        minSlopeTicks: 20,
        rangeLen: 14,
        minRangeTicks: 55,
        cooldownBars: 3,
        tickSize: 1
      },
      tradeManagementDefaults: {
        slTicks: 28,
        tpTicks: 32,
        tickSize: 1,
        exitOnOpposite: true,
        bothHitModel: "sl_first"
      },
      runSignals: runNas100MomentumScalper
    },
    nas100_vwap_liquidity_sweep_fvg_scalper: {
      id: "nas100_vwap_liquidity_sweep_fvg_scalper",
      name: "NAS100_VWAP_LIQUIDITY_SWEEP_FVG_SCALPER",
      notes:
        "M1 NAS100 session VWAP bias + liquidity sweep rejection + displacement + optional FVG entries with strict risk controls.",
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
    if (id === "nas100_momentum_scalper") {
      return await runNas100MomentumBacktest(input || {}, s);
    }
    if (id === "nas100_vwap_liquidity_sweep_fvg_scalper") {
      return await runNas100VwapLiquiditySweepBacktest(input || {}, s);
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
