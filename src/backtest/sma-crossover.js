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

  function ema(series, len) {
    const out = new Array(series.length).fill(null);
    if (!series.length || !Number.isFinite(len) || len < 1) return out;
    const alpha = 2 / (len + 1);
    let prev = Number(series[0]);
    if (!Number.isFinite(prev)) return out;
    out[0] = prev;
    for (let i = 1; i < series.length; i++) {
      const px = Number(series[i]);
      if (!Number.isFinite(px)) {
        out[i] = out[i - 1];
        continue;
      }
      prev = alpha * px + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  function trueRangeSeries(high, low, close) {
    const out = new Array(close.length).fill(0);
    for (let i = 0; i < close.length; i++) {
      const h = Number(high[i]);
      const l = Number(low[i]);
      const prevC = Number(i > 0 ? close[i - 1] : close[i]);
      const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
      out[i] = Number.isFinite(tr) ? tr : 0;
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

  function buildSmaSignalSetFromCandles(candles, options) {
    const fastN = Number(options.fastLen);
    const slowN = Number(options.slowLen);
    const keepN = Number(options.keepN || 5);
    const rangePreset = options.rangePreset || "week";

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
    return buildSmaSignalSetFromCandles(candles, {
      fastLen: fastN,
      slowLen: slowN,
      keepN,
      rangePreset
    });
  }

  function buildNas100MomentumSignalSetFromCandles(candles, options) {
    const fastEma = Number(options.fastEma || 18);
    const slowEma = Number(options.slowEma || 55);
    const breakoutLen = Number(options.breakoutLen || 8);
    const breakoutBufferTicks = Number(options.breakoutBufferTicks || 3);
    const atrShortLen = Number(options.atrShortLen || 8);
    const atrLongLen = Number(options.atrLongLen || 34);
    const minAtrRatio = Number(options.minAtrRatio || 1.12);
    const slopeLen = Number(options.slopeLen || 5);
    const minSlopeTicks = Number(options.minSlopeTicks || 20);
    const rangeLen = Number(options.rangeLen || 14);
    const minRangeTicks = Number(options.minRangeTicks || 55);
    const cooldownBars = Number(options.cooldownBars || 3);
    const tickSize = Number(options.tickSize || 1);
    const keepN = Number(options.keepN || 25);
    const rangePreset = options.rangePreset || "week";

    const minBars = Math.max(slowEma + slopeLen + 5, breakoutLen + 5, atrLongLen + 5, rangeLen + 5);
    if (!candles || candles.length < minBars + 10) {
      return {
        ok: true,
        signals: [],
        allSignals: [],
        candlesChron: [],
        verification: {
          strategy: "nas100_momentum_scalper",
          candlesReceived: candles ? candles.length : 0,
          candlesClosed: candles && candles.length ? Math.max(0, candles.length - 1) : 0,
          candlesInRange: 0,
          signalsTotal: 0,
          signalsInRange: 0,
          trendQualifiedBars: 0,
          breakoutQualifiedBars: 0,
          momentumQualifiedBars: 0,
          nonConsolidationBars: 0,
          monotonicTime: true,
          missingTimeCount: 0
        }
      };
    }

    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);

    const close = cChron.map((c) => Number(c.c));
    const high = cChron.map((c) => Number(c.h));
    const low = cChron.map((c) => Number(c.l));
    const timeMs = cChron.map((c) => candleTimeMs(c));

    const eFast = ema(close, fastEma);
    const eSlow = ema(close, slowEma);
    const tr = trueRangeSeries(high, low, close);
    const atrShort = ema(tr, atrShortLen);
    const atrLong = ema(tr, atrLongLen);

    const allSignals = [];
    let trendQualifiedBars = 0;
    let breakoutQualifiedBars = 0;
    let momentumQualifiedBars = 0;
    let nonConsolidationBars = 0;
    let cooldownUntil = -1;

    for (let i = minBars; i < cChron.length; i++) {
      const ef = Number(eFast[i]);
      const es = Number(eSlow[i]);
      const efPrev = Number(eFast[i - slopeLen]);
      const as = Number(atrShort[i]);
      const al = Number(atrLong[i]);
      if (!Number.isFinite(ef) || !Number.isFinite(es) || !Number.isFinite(efPrev)) continue;
      if (!Number.isFinite(as) || !Number.isFinite(al) || al <= 0) continue;

      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - breakoutLen; j < i; j++) {
        hh = Math.max(hh, high[j]);
        ll = Math.min(ll, low[j]);
      }
      if (!Number.isFinite(hh) || !Number.isFinite(ll)) continue;

      let rangeH = -Infinity;
      let rangeL = Infinity;
      for (let j = i - rangeLen; j <= i; j++) {
        rangeH = Math.max(rangeH, high[j]);
        rangeL = Math.min(rangeL, low[j]);
      }
      const rangeTicks = (rangeH - rangeL) / tickSize;

      const slopeTicks = (ef - efPrev) / tickSize;
      const trendUp = ef > es && slopeTicks >= minSlopeTicks;
      const trendDown = ef < es && slopeTicks <= -minSlopeTicks;
      if (trendUp || trendDown) trendQualifiedBars += 1;

      const breakoutUp = close[i] > hh + breakoutBufferTicks * tickSize;
      const breakoutDown = close[i] < ll - breakoutBufferTicks * tickSize;
      if (breakoutUp || breakoutDown) breakoutQualifiedBars += 1;

      const atrRatio = as / al;
      const momentumOk = atrRatio >= minAtrRatio;
      if (momentumOk) momentumQualifiedBars += 1;

      const nonConsolidating = Number.isFinite(rangeTicks) && rangeTicks >= minRangeTicks;
      if (nonConsolidating) nonConsolidationBars += 1;

      if (i <= cooldownUntil) continue;

      if (trendUp && breakoutUp && momentumOk && nonConsolidating) {
        allSignals.push({
          type: "BUY",
          time: timeMs[i],
          price: close[i],
          idx: i,
          info: { atrRatio: Number(atrRatio.toFixed(3)), slopeTicks: Number(slopeTicks.toFixed(1)), rangeTicks: Number(rangeTicks.toFixed(1)) }
        });
        cooldownUntil = i + cooldownBars;
      } else if (trendDown && breakoutDown && momentumOk && nonConsolidating) {
        allSignals.push({
          type: "SELL",
          time: timeMs[i],
          price: close[i],
          idx: i,
          info: { atrRatio: Number(atrRatio.toFixed(3)), slopeTicks: Number(slopeTicks.toFixed(1)), rangeTicks: Number(rangeTicks.toFixed(1)) }
        });
        cooldownUntil = i + cooldownBars;
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
        strategy: "nas100_momentum_scalper",
        rangePreset,
        rangeFrom: windowRange.fromMs,
        rangeTo: windowRange.toMs,
        candlesReceived: candles.length,
        candlesClosed: closed.length,
        candlesInRange,
        signalsTotal: allSignals.length,
        signalsInRange: inRangeSignals.length,
        trendQualifiedBars,
        breakoutQualifiedBars,
        momentumQualifiedBars,
        nonConsolidationBars,
        monotonicTime,
        missingTimeCount
      }
    };
  }

  async function buildNas100MomentumSignalSet(input) {
    const msg = await MarketData.requestCandles(input.instrumentId, Number(input.timeframeSec), Number(input.lookback));
    const candles = msg && msg.candles ? msg.candles : null;
    return buildNas100MomentumSignalSetFromCandles(candles, {
      fastEma: Number(input.fastEma || 18),
      slowEma: Number(input.slowEma || 55),
      breakoutLen: Number(input.breakoutLen || 8),
      breakoutBufferTicks: Number(input.breakoutBufferTicks || 3),
      atrShortLen: Number(input.atrShortLen || 8),
      atrLongLen: Number(input.atrLongLen || 34),
      minAtrRatio: Number(input.minAtrRatio || 1.12),
      slopeLen: Number(input.slopeLen || 5),
      minSlopeTicks: Number(input.minSlopeTicks || 20),
      rangeLen: Number(input.rangeLen || 14),
      minRangeTicks: Number(input.minRangeTicks || 55),
      cooldownBars: Number(input.cooldownBars || 3),
      tickSize: Number(input.tickSize || 1),
      keepN: Number(input.keepN || 25),
      rangePreset: input.rangePreset || "week"
    });
  }

  LCPro.Backtest = {
    sma,
    lastCrossSignals,
    candleTimeMs,
    getRangeWindowMs,
    buildSmaSignalSet,
    buildSmaSignalSetFromCandles,
    buildNas100MomentumSignalSet,
    buildNas100MomentumSignalSetFromCandles
  };
})();
