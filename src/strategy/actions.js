(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function toPosInt(v, fallback, minValue) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(minValue || 1, n);
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

  function scoreTowardTarget(summary, targetWinRate) {
    const wr = toNum(summary && summary.winRate, 0);
    return -Math.abs(wr - targetWinRate);
  }

  function isBetterCandidate(a, b, targetWinRate) {
    if (!a) return false;
    if (!b) return true;

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
