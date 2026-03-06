(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function toPosInt(v, fallback, minValue) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(minValue || 1, n);
  }

  function runSmaCrossover(input) {
    const params = input && input.params ? input.params : {};
    const fastLen = toPosInt(params.fastLen, 9, 2);
    const slowLen = toPosInt(params.slowLen, 21, 3);
    const keepN = toPosInt(input && input.keepN, 5, 1);

    return window.LCPro.Backtest.lastCrossSignals(input.instrumentId, input.timeframeSec, input.lookback, fastLen, slowLen, keepN);
  }

  function toNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function runSmaBacktest(input, strategy) {
    const p = input && input.params ? input.params : {};
    const tmDefaults = (strategy && strategy.tradeManagementDefaults) || {};
    const tmInput = input && input.tradeManagement ? input.tradeManagement : {};

    const fastLen = toPosInt(p.fastLen, 9, 2);
    const slowLen = toPosInt(p.slowLen, 21, 3);
    const keepN = toPosInt(input && input.keepN, 25, 1);

    const slTicks = Math.max(1, toNum(tmInput.slTicks, toNum(tmDefaults.slTicks, 55)));
    const tpTicks = Math.max(1, toNum(tmInput.tpTicks, toNum(tmDefaults.tpTicks, 55)));
    const tickSize = Math.max(0.00001, toNum(tmInput.tickSize, toNum(tmDefaults.tickSize, 1)));
    const exitOnOpposite = tmInput.exitOnOpposite !== false;
    const bothHitModel = tmInput.bothHitModel === "tp_first" ? "tp_first" : "sl_first";

    return window.LCPro.Backtest.buildSmaSignalSet({
      instrumentId: input.instrumentId,
      timeframeSec: input.timeframeSec,
      lookback: input.lookback,
      fastLen,
      slowLen,
      keepN,
      rangePreset: input.rangePreset || "week"
    }).then((set) => {
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
        rangePreset: input.rangePreset || "week",
        params: { fastLen, slowLen },
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
    });
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

  LCPro.Strategy = {
    STRATEGIES,
    getStrategy,
    runSignals,
    runBacktest
  };
})();
