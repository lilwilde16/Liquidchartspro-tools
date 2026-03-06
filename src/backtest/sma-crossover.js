(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const MarketData = LCPro.MarketData || {};

  function toMs(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  function candleTimeMs(c) {
    if (!c || typeof c !== "object") return 0;
    return toMs(c.date || c.t || c.ts || c.time || 0);
  }

  function sma(series, len) {
    const out = new Array(series.length).fill(null);
    let sum = 0;
    for (let i = 0; i < series.length; i++) {
      sum += series[i];
      if (i >= len) sum -= series[i - len];
      if (i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  async function lastCrossSignals(instrumentId, timeframeSec, pullCount, fastN, slowN, keepN) {
    const msg = await MarketData.requestCandles(instrumentId, timeframeSec, pullCount);
    const candles = msg && msg.candles ? msg.candles : null;
    if (!candles || candles.length < slowN + 50) return [];

    // Closed candles only: skip index 0 (forming/newest)
    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);

    const close = cChron.map((c) => c.c);
    const date = cChron.map((c) => c.date);
    const f = sma(close, fastN);
    const s = sma(close, slowN);

    const signals = [];
    for (let i = 1; i < cChron.length; i++) {
      if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;

      const prevDiff = f[i - 1] - s[i - 1];
      const diff = f[i] - s[i];
      if (prevDiff <= 0 && diff > 0) {
        signals.push({ type: "BUY", time: date[i], price: close[i], idx: i });
      } else if (prevDiff >= 0 && diff < 0) {
        signals.push({ type: "SELL", time: date[i], price: close[i], idx: i });
      }
    }

    return signals.slice(-keepN).reverse();
  }

  function getRangeWindowMs(rangePreset, endMs) {
    const end = Number(endMs) || Date.now();
    if (rangePreset === "day") return { fromMs: end - 24 * 60 * 60 * 1000, toMs: end };
    if (rangePreset === "week") return { fromMs: end - 7 * 24 * 60 * 60 * 1000, toMs: end };
    if (rangePreset === "month") return { fromMs: end - 30 * 24 * 60 * 60 * 1000, toMs: end };
    return { fromMs: 0, toMs: end };
  }

  async function buildSmaSignalSet(input) {
    const instrumentId = input.instrumentId;
    const timeframeSec = Number(input.timeframeSec);
    const pullCount = Number(input.lookback);
    const fastN = Number(input.fastLen);
    const slowN = Number(input.slowLen);
    const keepN = Number(input.keepN || 5);
    const rangePreset = input.rangePreset || "week";

    const msg = await MarketData.requestCandles(instrumentId, timeframeSec, pullCount);
    const candles = msg && msg.candles ? msg.candles : null;
    if (!candles || candles.length < slowN + 50) {
      return {
        ok: true,
        signals: [],
        allSignals: [],
        candlesChron: [],
        verification: {
          candlesReceived: candles ? candles.length : 0,
          candlesClosed: candles && candles.length ? Math.max(0, candles.length - 1) : 0,
          candlesInRange: 0,
          signalsTotal: 0,
          signalsInRange: 0,
          monotonicTime: true,
          missingTimeCount: 0
        }
      };
    }

    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);

    const close = cChron.map((c) => Number(c.c));
    const timeMs = cChron.map((c) => candleTimeMs(c));
    const f = sma(close, fastN);
    const s = sma(close, slowN);

    const allSignals = [];
    for (let i = 1; i < cChron.length; i++) {
      if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;
      const prevDiff = f[i - 1] - s[i - 1];
      const diff = f[i] - s[i];
      if (prevDiff <= 0 && diff > 0) {
        allSignals.push({ type: "BUY", time: timeMs[i], price: close[i], idx: i });
      } else if (prevDiff >= 0 && diff < 0) {
        allSignals.push({ type: "SELL", time: timeMs[i], price: close[i], idx: i });
      }
    }

    const endMs = timeMs.length ? Math.max.apply(null, timeMs) : Date.now();
    const windowRange = getRangeWindowMs(rangePreset, endMs);

    const inRangeSignals = allSignals.filter((s0) => {
      const t = Number(s0.time);
      if (!Number.isFinite(t) || t <= 0) return false;
      return t >= windowRange.fromMs && t <= windowRange.toMs;
    });

    let missingTimeCount = 0;
    let monotonicTime = true;
    let prev = 0;
    for (let i = 0; i < timeMs.length; i++) {
      const t = timeMs[i];
      if (!t) missingTimeCount += 1;
      if (t && prev && t < prev) monotonicTime = false;
      if (t) prev = t;
    }

    const candlesInRange = timeMs.filter((t) => t >= windowRange.fromMs && t <= windowRange.toMs).length;

    return {
      ok: true,
      signals: inRangeSignals.slice(-keepN).reverse(),
      allSignals: inRangeSignals,
      candlesChron: cChron,
      verification: {
        rangePreset,
        rangeFrom: windowRange.fromMs,
        rangeTo: windowRange.toMs,
        candlesReceived: candles.length,
        candlesClosed: closed.length,
        candlesInRange,
        signalsTotal: allSignals.length,
        signalsInRange: inRangeSignals.length,
        monotonicTime,
        missingTimeCount
      }
    };
  }

  LCPro.Backtest = {
    sma,
    lastCrossSignals,
    candleTimeMs,
    getRangeWindowMs,
    buildSmaSignalSet
  };
})();
