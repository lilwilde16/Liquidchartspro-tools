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

  function rsiSeries(close, len) {
    const out = new Array(close.length).fill(null);
    if (!close.length || len < 2 || close.length <= len) return out;

    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= len; i++) {
      const diff = Number(close[i]) - Number(close[i - 1]);
      if (!Number.isFinite(diff)) continue;
      if (diff >= 0) gainSum += diff;
      else lossSum += -diff;
    }

    let avgGain = gainSum / len;
    let avgLoss = lossSum / len;
    out[len] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = len + 1; i < close.length; i++) {
      const diff = Number(close[i]) - Number(close[i - 1]);
      const gain = Number.isFinite(diff) && diff > 0 ? diff : 0;
      const loss = Number.isFinite(diff) && diff < 0 ? -diff : 0;
      avgGain = (avgGain * (len - 1) + gain) / len;
      avgLoss = (avgLoss * (len - 1) + loss) / len;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return out;
  }

  function smaNullable(series, len) {
    const out = new Array(series.length).fill(null);
    if (!series.length || len < 1) return out;
    for (let i = len - 1; i < series.length; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - len + 1; j <= i; j++) {
        const v = Number(series[j]);
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        sum += v;
      }
      out[i] = ok ? sum / len : null;
    }
    return out;
  }

  function stochasticSeries(high, low, close, kLen, smoothK, smoothD) {
    const rawK = new Array(close.length).fill(null);
    for (let i = kLen - 1; i < close.length; i++) {
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - kLen + 1; j <= i; j++) {
        hh = Math.max(hh, Number(high[j]));
        ll = Math.min(ll, Number(low[j]));
      }
      const c = Number(close[i]);
      const den = hh - ll;
      rawK[i] = Number.isFinite(c) && Number.isFinite(den) && den > 0 ? ((c - ll) / den) * 100 : null;
    }
    const k = smaNullable(rawK, Math.max(1, smoothK));
    const d = smaNullable(k, Math.max(1, smoothD));
    return { k, d };
  }

  function bollingerSeries(close, period, stdMult) {
    const mid = new Array(close.length).fill(null);
    const upper = new Array(close.length).fill(null);
    const lower = new Array(close.length).fill(null);
    if (!Array.isArray(close) || !close.length || !Number.isFinite(period) || period < 2) {
      return { mid, upper, lower };
    }
    for (let i = period - 1; i < close.length; i++) {
      let sum = 0;
      let ok = true;
      for (let j = i - period + 1; j <= i; j++) {
        const v = Number(close[j]);
        if (!Number.isFinite(v)) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (!ok) continue;
      const mean = sum / period;
      let varianceSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = Number(close[j]) - mean;
        varianceSum += diff * diff;
      }
      const std = Math.sqrt(varianceSum / period);
      mid[i] = mean;
      upper[i] = mean + std * stdMult;
      lower[i] = mean - std * stdMult;
    }
    return { mid, upper, lower };
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

  function buildNas100RsiSrStochSignalSetFromCandles(candles, options) {
    const rsiLen = Number(options.rsiLen || 14);
    const trendEmaLen = Number(options.trendEmaLen || 50);
    const fastEmaLen = Number(options.fastEmaLen || 9);
    const slowEmaLen = Number(options.slowEmaLen || 21);
    const stochLen = Number(options.stochLen || 14);
    const stochSmoothK = Number(options.stochSmoothK || 3);
    const stochSmoothD = Number(options.stochSmoothD || 3);
    const stochLower = Number(options.stochLower || 40);
    const stochUpper = Number(options.stochUpper || 65);
    const rsiBuyMax = Number(options.rsiBuyMax || 50);
    const rsiSellMin = Number(options.rsiSellMin || 50);
    const srLookback = Number(options.srLookback || 20);
    const srBufferTicks = Number(options.srBufferTicks || 4);
    const trendSlopeBars = Number(options.trendSlopeBars || 3);
    const cooldownBars = Number(options.cooldownBars || 1);
    const bbEntryEnabled = options.bbEntryEnabled !== false;
    const bbConfluenceMode = String(options.bbConfluenceMode || "either");
    const bbPeriod = Number(options.bbPeriod || 15);
    const bbStdDev = Number(options.bbStdDev || 1);
    const bbTouchBufferTicks = Number(options.bbTouchBufferTicks || 1);
    const bbReclaimRequired = options.bbReclaimRequired === true;
    const bbUseRsiExtreme = options.bbUseRsiExtreme === true;
    const bbRsiBuyMax = Number(options.bbRsiBuyMax || 45);
    const bbRsiSellMin = Number(options.bbRsiSellMin || 55);
    const tickSize = Number(options.tickSize || 1);
    const keepN = Number(options.keepN || 50);
    const rangePreset = options.rangePreset || "week";

    const minBars = Math.max(
      trendEmaLen + trendSlopeBars + 2,
      slowEmaLen + 2,
      rsiLen + 2,
      stochLen + stochSmoothK + stochSmoothD + 2,
      srLookback + 2,
      bbPeriod + 2
    );

    if (!candles || candles.length < minBars + 10) {
      return {
        ok: true,
        signals: [],
        allSignals: [],
        candlesChron: [],
        verification: {
          strategy: "nas100_rsi_sr_stoch_scalper",
          candlesReceived: candles ? candles.length : 0,
          candlesClosed: candles && candles.length ? Math.max(0, candles.length - 1) : 0,
          candlesInRange: 0,
          signalsTotal: 0,
          signalsInRange: 0,
          trendQualifiedBars: 0,
          stochCrossQualifiedBars: 0,
          srTouchQualifiedBars: 0,
          bbTouchQualifiedBars: 0,
          monotonicTime: true,
          missingTimeCount: 0
        }
      };
    }

    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);
    const open = cChron.map((c) => Number(c.o));
    const high = cChron.map((c) => Number(c.h));
    const low = cChron.map((c) => Number(c.l));
    const close = cChron.map((c) => Number(c.c));
    const timeMs = cChron.map((c) => candleTimeMs(c));

    const emaTrend = ema(close, trendEmaLen);
    const emaFast = ema(close, fastEmaLen);
    const emaSlow = ema(close, slowEmaLen);
    const rsi = rsiSeries(close, rsiLen);
    const stoch = stochasticSeries(high, low, close, stochLen, stochSmoothK, stochSmoothD);
    const bb = bollingerSeries(close, bbPeriod, bbStdDev);

    const allSignals = [];
    let trendQualifiedBars = 0;
    let stochCrossQualifiedBars = 0;
    let srTouchQualifiedBars = 0;
    let bbTouchQualifiedBars = 0;
    let cooldownUntil = -1;

    for (let i = minBars; i < cChron.length; i++) {
      if (i <= cooldownUntil) continue;

      let srHigh = -Infinity;
      let srLow = Infinity;
      for (let j = i - srLookback; j < i; j++) {
        srHigh = Math.max(srHigh, high[j]);
        srLow = Math.min(srLow, low[j]);
      }

      const c = close[i];
      const o = open[i];
      const et = Number(emaTrend[i]);
      const etPrev = Number(emaTrend[i - trendSlopeBars]);
      const ef = Number(emaFast[i]);
      const es = Number(emaSlow[i]);
      const r = Number(rsi[i]);
      const rPrev = Number(rsi[i - 1]);
      const k = Number(stoch.k[i]);
      const d = Number(stoch.d[i]);
      const kPrev = Number(stoch.k[i - 1]);
      const dPrev = Number(stoch.d[i - 1]);
      const bbUpper = Number(bb.upper[i]);
      const bbLower = Number(bb.lower[i]);
      const bbUpperPrev = Number(bb.upper[i - 1]);
      const bbLowerPrev = Number(bb.lower[i - 1]);
      if (!Number.isFinite(c) || !Number.isFinite(o) || !Number.isFinite(et) || !Number.isFinite(etPrev)) continue;
      if (!Number.isFinite(ef) || !Number.isFinite(es) || !Number.isFinite(r) || !Number.isFinite(rPrev)) continue;
      if (!Number.isFinite(k) || !Number.isFinite(d) || !Number.isFinite(kPrev) || !Number.isFinite(dPrev)) continue;
      if (bbEntryEnabled && (!Number.isFinite(bbUpper) || !Number.isFinite(bbLower))) continue;
      if (bbEntryEnabled && bbReclaimRequired && (!Number.isFinite(bbUpperPrev) || !Number.isFinite(bbLowerPrev))) continue;

      const trendUp = c > et && ef > es && et > etPrev;
      const trendDown = c < et && ef < es && et < etPrev;
      if (trendUp || trendDown) trendQualifiedBars += 1;

      const nearSupport = low[i] <= srLow + srBufferTicks * tickSize;
      const nearResistance = high[i] >= srHigh - srBufferTicks * tickSize;
      if (nearSupport || nearResistance) srTouchQualifiedBars += 1;

      const touchedBbLower = low[i] <= bbLower + bbTouchBufferTicks * tickSize;
      const touchedBbUpper = high[i] >= bbUpper - bbTouchBufferTicks * tickSize;
      const reclaimedFromLower = bbReclaimRequired
        ? low[i - 1] <= bbLowerPrev - bbTouchBufferTicks * tickSize && c > bbLower
        : touchedBbLower;
      const reclaimedFromUpper = bbReclaimRequired
        ? high[i - 1] >= bbUpperPrev + bbTouchBufferTicks * tickSize && c < bbUpper
        : touchedBbUpper;
      const bbRsiLongOk = !bbUseRsiExtreme || r <= bbRsiBuyMax;
      const bbRsiShortOk = !bbUseRsiExtreme || r >= bbRsiSellMin;
      const bbLongOk = !bbEntryEnabled || (reclaimedFromLower && bbRsiLongOk);
      const bbShortOk = !bbEntryEnabled || (reclaimedFromUpper && bbRsiShortOk);
      if (bbLongOk || bbShortOk) bbTouchQualifiedBars += 1;

      const stochCrossUp = kPrev <= dPrev && k > d && k <= stochLower;
      const stochCrossDown = kPrev >= dPrev && k < d && k >= stochUpper;
      const stochRecoverUp = k < stochLower && k > kPrev;
      const stochRecoverDown = k > stochUpper && k < kPrev;
      if (stochCrossUp || stochCrossDown) stochCrossQualifiedBars += 1;

      const rsiRecoverBuy = rPrev <= rsiBuyMax && r > rPrev;
      const rsiRecoverSell = rPrev >= rsiSellMin && r < rPrev;
      const bullishCandle = c > o || c > close[i - 1];
      const bearishCandle = c < o || c < close[i - 1];
      const pullbackToFastBuy = low[i] <= ef;
      const pullbackToFastSell = high[i] >= ef;
      const longEntryBaseOk = nearSupport || pullbackToFastBuy;
      const shortEntryBaseOk = nearResistance || pullbackToFastSell;
      const momentumBuyOk = stochCrossUp || stochRecoverUp;
      const momentumSellOk = stochCrossDown || stochRecoverDown;

      let longEntryOk = longEntryBaseOk;
      let shortEntryOk = shortEntryBaseOk;
      if (bbConfluenceMode === "both") {
        longEntryOk = longEntryBaseOk && bbLongOk;
        shortEntryOk = shortEntryBaseOk && bbShortOk;
      } else if (bbConfluenceMode === "bb_only") {
        longEntryOk = bbLongOk;
        shortEntryOk = bbShortOk;
      } else {
        longEntryOk = longEntryBaseOk || bbLongOk;
        shortEntryOk = shortEntryBaseOk || bbShortOk;
      }

      if (trendUp && longEntryOk && momentumBuyOk && rsiRecoverBuy && bullishCandle) {
        allSignals.push({
          type: "BUY",
          time: timeMs[i],
          price: c,
          idx: i,
          info: {
            rsi: Number(r.toFixed(2)),
            stochK: Number(k.toFixed(2)),
            stochD: Number(d.toFixed(2)),
            support: Number(srLow.toFixed(2)),
            bbLower: Number(bbLower.toFixed(2))
          }
        });
        cooldownUntil = i + cooldownBars;
      } else if (trendDown && shortEntryOk && momentumSellOk && rsiRecoverSell && bearishCandle) {
        allSignals.push({
          type: "SELL",
          time: timeMs[i],
          price: c,
          idx: i,
          info: {
            rsi: Number(r.toFixed(2)),
            stochK: Number(k.toFixed(2)),
            stochD: Number(d.toFixed(2)),
            resistance: Number(srHigh.toFixed(2)),
            bbUpper: Number(bbUpper.toFixed(2))
          }
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
        strategy: "nas100_rsi_sr_stoch_scalper",
        rangePreset,
        rangeFrom: windowRange.fromMs,
        rangeTo: windowRange.toMs,
        candlesReceived: candles.length,
        candlesClosed: closed.length,
        candlesInRange,
        signalsTotal: allSignals.length,
        signalsInRange: inRangeSignals.length,
        trendQualifiedBars,
        stochCrossQualifiedBars,
        srTouchQualifiedBars,
        bbTouchQualifiedBars,
        monotonicTime,
        missingTimeCount
      }
    };
  }

  async function buildNas100RsiSrStochSignalSet(input) {
    const msg = await MarketData.requestCandles(input.instrumentId, Number(input.timeframeSec), Number(input.lookback));
    const candles = msg && msg.candles ? msg.candles : null;
    return buildNas100RsiSrStochSignalSetFromCandles(candles, {
      rsiLen: Number(input.rsiLen || 14),
      trendEmaLen: Number(input.trendEmaLen || 50),
      fastEmaLen: Number(input.fastEmaLen || 9),
      slowEmaLen: Number(input.slowEmaLen || 21),
      stochLen: Number(input.stochLen || 14),
      stochSmoothK: Number(input.stochSmoothK || 3),
      stochSmoothD: Number(input.stochSmoothD || 3),
      stochLower: Number(input.stochLower || 40),
      stochUpper: Number(input.stochUpper || 65),
      rsiBuyMax: Number(input.rsiBuyMax || 50),
      rsiSellMin: Number(input.rsiSellMin || 50),
      srLookback: Number(input.srLookback || 20),
      srBufferTicks: Number(input.srBufferTicks || 4),
      trendSlopeBars: Number(input.trendSlopeBars || 3),
      cooldownBars: Number(input.cooldownBars || 1),
      bbEntryEnabled: input.bbEntryEnabled !== false,
      bbConfluenceMode: String(input.bbConfluenceMode || "either"),
      bbPeriod: Number(input.bbPeriod || 15),
      bbStdDev: Number(input.bbStdDev || 1),
      bbTouchBufferTicks: Number(input.bbTouchBufferTicks || 1),
      bbReclaimRequired: input.bbReclaimRequired === true,
      bbUseRsiExtreme: input.bbUseRsiExtreme === true,
      bbRsiBuyMax: Number(input.bbRsiBuyMax || 45),
      bbRsiSellMin: Number(input.bbRsiSellMin || 55),
      tickSize: Number(input.tickSize || 1),
      keepN: Number(input.keepN || 50),
      rangePreset: input.rangePreset || "week"
    });
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function getChicagoParts(ms, timeZone) {
    const tz = timeZone || "America/Chicago";
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const parts = dtf.formatToParts(new Date(ms));
    const map = {};
    for (let i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
    const year = Number(map.year || 0);
    const month = Number(map.month || 0);
    const day = Number(map.day || 0);
    const hour = Number(map.hour || 0);
    const minute = Number(map.minute || 0);
    const second = Number(map.second || 0);
    const dayKey = String(map.year || "0000") + "-" + String(map.month || "00") + "-" + String(map.day || "00");
    return { year, month, day, hour, minute, second, dayKey, minutesOfDay: hour * 60 + minute };
  }

  function parseSessionMinutes(text, fallback) {
    const s = String(text || fallback || "08:30").trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (!m) return parseSessionMinutes(fallback || "08:30", "08:30");
    const h = clampNum(m[1], 0, 23, 8);
    const min = clampNum(m[2], 0, 59, 30);
    return h * 60 + min;
  }

  function inSessionMinutes(minutesOfDay, startMin, endMin) {
    return minutesOfDay >= startMin && minutesOfDay <= endMin;
  }

  function candleVolume(c) {
    const v = Number(c && (c.v != null ? c.v : c.volume != null ? c.volume : c.tickVolume));
    return Number.isFinite(v) && v > 0 ? v : 1;
  }

  function computeSessionVwap(cChron, timeMs, timeZone) {
    const out = new Array(cChron.length).fill(null);
    let dayKey = "";
    let cumPv = 0;
    let cumVol = 0;
    for (let i = 0; i < cChron.length; i++) {
      const t = Number(timeMs[i]);
      const p = getChicagoParts(t || 0, timeZone);
      if (p.dayKey !== dayKey) {
        dayKey = p.dayKey;
        cumPv = 0;
        cumVol = 0;
      }
      const h = Number(cChron[i].h);
      const l = Number(cChron[i].l);
      const c = Number(cChron[i].c);
      const typical = Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c) ? (h + l + c) / 3 : c;
      const vol = candleVolume(cChron[i]);
      cumPv += typical * vol;
      cumVol += vol;
      out[i] = cumVol > 0 ? cumPv / cumVol : null;
    }
    return out;
  }

  function averageBody(cChron, endIdx, lookback) {
    const start = Math.max(0, endIdx - lookback + 1);
    let sum = 0;
    let n = 0;
    for (let i = start; i <= endIdx; i++) {
      const o = Number(cChron[i].o);
      const c = Number(cChron[i].c);
      if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
      sum += Math.abs(c - o);
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function averageVolume(cChron, endIdx, lookback) {
    const start = Math.max(0, endIdx - lookback + 1);
    let sum = 0;
    let n = 0;
    for (let i = start; i <= endIdx; i++) {
      sum += candleVolume(cChron[i]);
      n += 1;
    }
    return n ? sum / n : 0;
  }

  function isPivotHigh(cChron, idx, leftRight) {
    const h0 = Number(cChron[idx] && cChron[idx].h);
    if (!Number.isFinite(h0)) return false;
    for (let j = idx - leftRight; j <= idx + leftRight; j++) {
      if (j < 0 || j >= cChron.length || j === idx) continue;
      const h = Number(cChron[j].h);
      if (!Number.isFinite(h) || h >= h0) return false;
    }
    return true;
  }

  function isPivotLow(cChron, idx, leftRight) {
    const l0 = Number(cChron[idx] && cChron[idx].l);
    if (!Number.isFinite(l0)) return false;
    for (let j = idx - leftRight; j <= idx + leftRight; j++) {
      if (j < 0 || j >= cChron.length || j === idx) continue;
      const l = Number(cChron[j].l);
      if (!Number.isFinite(l) || l <= l0) return false;
    }
    return true;
  }

  function findRecentPivot(cChron, idx, dir, minAgo, maxAgo, leftRight) {
    const start = Math.max(leftRight, idx - maxAgo);
    const end = Math.min(idx - minAgo, cChron.length - leftRight - 1);
    for (let j = end; j >= start; j--) {
      if (dir === "high" && isPivotHigh(cChron, j, leftRight)) {
        return { idx: j, price: Number(cChron[j].h) };
      }
      if (dir === "low" && isPivotLow(cChron, j, leftRight)) {
        return { idx: j, price: Number(cChron[j].l) };
      }
    }
    return null;
  }

  function detectFvgAfterDisplacement(cChron, dispIdx, side) {
    const sequences = [
      [dispIdx - 1, dispIdx, dispIdx + 1],
      [dispIdx, dispIdx + 1, dispIdx + 2]
    ];
    for (let i = 0; i < sequences.length; i++) {
      const s = sequences[i];
      if (s[0] < 0 || s[2] >= cChron.length) continue;
      const a = cChron[s[0]];
      const c = cChron[s[2]];
      const aHigh = Number(a.h);
      const aLow = Number(a.l);
      const cHigh = Number(c.h);
      const cLow = Number(c.l);
      if (side === "BUY" && Number.isFinite(aHigh) && Number.isFinite(cLow) && aHigh < cLow) {
        return { exists: true, side: "BUY", startIdx: s[0], endIdx: s[2], low: aHigh, high: cLow };
      }
      if (side === "SELL" && Number.isFinite(aLow) && Number.isFinite(cHigh) && aLow > cHigh) {
        return { exists: true, side: "SELL", startIdx: s[0], endIdx: s[2], low: cHigh, high: aLow };
      }
    }
    return { exists: false };
  }

  function buildNas100VwapLiquiditySweepSignalSetFromCandles(candles, options) {
    const keepN = Number(options.keepN || 25);
    const rangePreset = options.rangePreset || "week";
    const timeZone = options.timeZone || "America/Chicago";
    const sessionStartMin = parseSessionMinutes(options.sessionStart || "08:30", "08:30");
    const sessionEndMin = parseSessionMinutes(options.sessionEnd || "11:30", "11:30");

    const minSwingAgo = clampNum(options.minSwingLookbackCandles, 2, 30, 5);
    const maxSwingAgo = clampNum(options.maxSwingLookbackCandles, minSwingAgo, 80, 15);
    const pivotLeftRight = clampNum(options.pivotLeftRight, 1, 4, 2);
    const minSweepPoints = Math.max(0, Number(options.minSweepPoints || 3));
    const displacementBodyMultiplier = Math.max(0.5, Number(options.displacementBodyMultiplier || 1.3));
    const displacementLookback = clampNum(options.displacementLookback, 3, 50, 10);
    const displacementCloseBand = clampNum(options.displacementCloseBand, 0.05, 0.49, 0.3);
    const minVolumeRatio = Math.max(0, Number(options.minVolumeRatio || 0));
    const tickSize = Math.max(0.00001, Number(options.tickSize || 1));
    const allowLong = options.allowLong !== false;
    const allowShort = options.allowShort !== false;
    const fvgEnabled = options.fvgEnabled !== false;
    const debug = !!options.debug;

    const minBars = Math.max(80, maxSwingAgo + pivotLeftRight + displacementLookback + 5);
    if (!candles || candles.length < minBars + 5) {
      return {
        ok: true,
        signals: [],
        allSignals: [],
        setups: [],
        candlesChron: [],
        verification: {
          strategy: "nas100_vwap_liquidity_sweep_fvg_scalper",
          candlesReceived: candles ? candles.length : 0,
          candlesClosed: candles && candles.length ? Math.max(0, candles.length - 1) : 0,
          candlesInRange: 0,
          signalsTotal: 0,
          signalsInRange: 0,
          sweepsDetected: 0,
          displacementsPassed: 0,
          fvgsFound: 0,
          monotonicTime: true,
          missingTimeCount: 0,
          debugRows: 0
        }
      };
    }

    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);
    const close = cChron.map((c) => Number(c.c));
    const open = cChron.map((c) => Number(c.o));
    const high = cChron.map((c) => Number(c.h));
    const low = cChron.map((c) => Number(c.l));
    const timeMs = cChron.map((c) => candleTimeMs(c));
    const vwap = computeSessionVwap(cChron, timeMs, timeZone);

    const allSignals = [];
    const setups = [];
    const debugRows = [];
    let sweepsDetected = 0;
    let displacementsPassed = 0;
    let fvgsFound = 0;

    for (let i = minBars; i < cChron.length - 2; i++) {
      const t = Number(timeMs[i]);
      if (!Number.isFinite(t) || t <= 0) continue;

      const chicago = getChicagoParts(t, timeZone);
      const inSession = inSessionMinutes(chicago.minutesOfDay, sessionStartMin, sessionEndMin);
      const px = Number(close[i]);
      const v = Number(vwap[i]);
      if (!Number.isFinite(px) || !Number.isFinite(v)) continue;

      const bias = px > v ? "LONG" : px < v ? "SHORT" : "FLAT";
      const swingHigh = findRecentPivot(cChron, i, "high", minSwingAgo, maxSwingAgo, pivotLeftRight);
      const swingLow = findRecentPivot(cChron, i, "low", minSwingAgo, maxSwingAgo, pivotLeftRight);

      const liqAbove = swingHigh ? swingHigh.price : null;
      const liqBelow = swingLow ? swingLow.price : null;
      const minSweepPx = minSweepPoints * tickSize;

      let setupSide = "";
      let sweptLevel = null;
      let sweepWick = null;
      let rejectionIdx = -1;
      let sweepType = "none";

      if (allowLong && inSession && bias === "LONG" && swingLow) {
        const broke = low[i] <= swingLow.price - minSweepPx;
        const sameCloseBack = close[i] > swingLow.price;
        const nextCloseBack = close[i + 1] > swingLow.price;
        if (broke && (sameCloseBack || nextCloseBack)) {
          setupSide = "BUY";
          sweptLevel = swingLow.price;
          sweepWick = Math.min(low[i], low[i + 1]);
          rejectionIdx = sameCloseBack ? i : i + 1;
          sweepType = "long_sweep";
          sweepsDetected += 1;
        }
      }

      if (!setupSide && allowShort && inSession && bias === "SHORT" && swingHigh) {
        const broke = high[i] >= swingHigh.price + minSweepPx;
        const sameCloseBack = close[i] < swingHigh.price;
        const nextCloseBack = close[i + 1] < swingHigh.price;
        if (broke && (sameCloseBack || nextCloseBack)) {
          setupSide = "SELL";
          sweptLevel = swingHigh.price;
          sweepWick = Math.max(high[i], high[i + 1]);
          rejectionIdx = sameCloseBack ? i : i + 1;
          sweepType = "short_sweep";
          sweepsDetected += 1;
        }
      }

      let displacementOk = false;
      let displacementIdx = -1;
      let displacementHigh = null;
      let displacementLow = null;
      let displacementReason = "not_checked";

      if (setupSide) {
        for (let d = rejectionIdx; d <= Math.min(rejectionIdx + 1, cChron.length - 2); d++) {
          const body = Math.abs(close[d] - open[d]);
          const avgBody = averageBody(cChron, d - 1, displacementLookback);
          const range = Math.max(0, high[d] - low[d]);
          const volNow = candleVolume(cChron[d]);
          const volAvg = averageVolume(cChron, d - 1, 10);
          const volRatio = volAvg > 0 ? volNow / volAvg : 1;

          const bodyOk = avgBody > 0 && body > displacementBodyMultiplier * avgBody;
          const closePos = range > 0 ? (close[d] - low[d]) / range : 0.5;
          const closeOk =
            setupSide === "BUY" ? closePos >= 1 - displacementCloseBand : closePos <= displacementCloseBand;
          const dirOk = setupSide === "BUY" ? close[d] > open[d] : close[d] < open[d];
          const volOk = minVolumeRatio <= 0 ? true : volRatio >= minVolumeRatio;

          if (bodyOk && closeOk && dirOk && volOk) {
            displacementOk = true;
            displacementIdx = d;
            displacementHigh = high[d];
            displacementLow = low[d];
            displacementReason = "passed";
            displacementsPassed += 1;
            break;
          }
          displacementReason = "failed_body_close_or_volume";
        }
      }

      const fvg = setupSide && displacementOk && fvgEnabled ? detectFvgAfterDisplacement(cChron, displacementIdx, setupSide) : { exists: false };
      if (fvg.exists) fvgsFound += 1;

      if (setupSide && displacementOk) {
        const signal = {
          type: setupSide,
          time: timeMs[displacementIdx],
          price: close[displacementIdx],
          idx: displacementIdx,
          setup: {
            side: setupSide,
            sweepType,
            sweepCandleIdx: i,
            rejectionIdx,
            sweptLevel,
            sweepWick,
            swingHigh: swingHigh ? swingHigh.price : null,
            swingLow: swingLow ? swingLow.price : null,
            displacementIdx,
            displacementHigh,
            displacementLow,
            fvg: fvg.exists ? { low: fvg.low, high: fvg.high, startIdx: fvg.startIdx, endIdx: fvg.endIdx } : null,
            vwap: v,
            timeZone,
            chicagoTime: chicago.hour + ":" + String(chicago.minute).padStart(2, "0")
          }
        };
        allSignals.push(signal);
        setups.push(signal.setup);
      }

      if (debug) {
        const row = {
          idx: i,
          time: t,
          inSession,
          bias,
          vwap: Number(v.toFixed(4)),
          price: Number(px.toFixed(4)),
          swingHigh: liqAbove,
          swingLow: liqBelow,
          sweepDetected: setupSide ? true : false,
          sweepType,
          displacementPassed: displacementOk,
          displacementReason,
          fvgFound: !!fvg.exists,
          entryState: setupSide && displacementOk ? "eligible" : "blocked"
        };
        debugRows.push(row);
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
      setups,
      candlesChron: cChron,
      vwap,
      debugRows: debug ? debugRows : [],
      verification: {
        strategy: "nas100_vwap_liquidity_sweep_fvg_scalper",
        rangePreset,
        rangeFrom: windowRange.fromMs,
        rangeTo: windowRange.toMs,
        candlesReceived: candles.length,
        candlesClosed: closed.length,
        candlesInRange,
        signalsTotal: allSignals.length,
        signalsInRange: inRangeSignals.length,
        sweepsDetected,
        displacementsPassed,
        fvgsFound,
        monotonicTime,
        missingTimeCount,
        debugRows: debug ? debugRows.length : 0
      }
    };
  }

  async function buildNas100VwapLiquiditySweepSignalSet(input) {
    const msg = await MarketData.requestCandles(input.instrumentId, Number(input.timeframeSec), Number(input.lookback));
    const candles = msg && msg.candles ? msg.candles : null;
    return buildNas100VwapLiquiditySweepSignalSetFromCandles(candles, {
      keepN: Number(input.keepN || 25),
      rangePreset: input.rangePreset || "week",
      timeZone: input.timeZone || "America/Chicago",
      sessionStart: input.sessionStart || "08:30",
      sessionEnd: input.sessionEnd || "11:30",
      minSwingLookbackCandles: Number(input.minSwingLookbackCandles || 5),
      maxSwingLookbackCandles: Number(input.maxSwingLookbackCandles || 15),
      pivotLeftRight: Number(input.pivotLeftRight || 2),
      minSweepPoints: Number(input.minSweepPoints || 3),
      displacementBodyMultiplier: Number(input.displacementBodyMultiplier || 1.3),
      displacementLookback: Number(input.displacementLookback || 10),
      displacementCloseBand: Number(input.displacementCloseBand || 0.3),
      minVolumeRatio: Number(input.minVolumeRatio || 0),
      tickSize: Number(input.tickSize || 1),
      allowLong: input.allowLong !== false,
      allowShort: input.allowShort !== false,
      fvgEnabled: input.fvgEnabled !== false,
      debug: !!input.debug
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
    buildNas100MomentumSignalSetFromCandles,
    buildNas100RsiSrStochSignalSet,
    buildNas100RsiSrStochSignalSetFromCandles,
    buildNas100VwapLiquiditySweepSignalSet,
    buildNas100VwapLiquiditySweepSignalSetFromCandles
  };
})();
