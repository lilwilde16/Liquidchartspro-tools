(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function closeSeries(candles) {
    const out = [];
    for (let i = 0; i < candles.length; i++) {
      out.push(toNum(candles[i].c));
    }
    return out;
  }

  function ema(values, len) {
    if (!Array.isArray(values) || !values.length || len < 1) return null;
    const alpha = 2 / (len + 1);
    let prev = toNum(values[0]);
    if (!Number.isFinite(prev)) return null;
    for (let i = 1; i < values.length; i++) {
      const v = toNum(values[i]);
      if (!Number.isFinite(v)) continue;
      prev = alpha * v + (1 - alpha) * prev;
    }
    return prev;
  }

  function sma(values, len) {
    if (!Array.isArray(values) || values.length < len || len < 1) return null;
    let sum = 0;
    let n = 0;
    for (let i = values.length - len; i < values.length; i++) {
      const v = toNum(values[i]);
      if (!Number.isFinite(v)) return null;
      sum += v;
      n += 1;
    }
    return n ? sum / n : null;
  }

  function stdev(values, len) {
    const mean = sma(values, len);
    if (!Number.isFinite(mean)) return null;
    let sumSq = 0;
    for (let i = values.length - len; i < values.length; i++) {
      const v = toNum(values[i]);
      if (!Number.isFinite(v)) return null;
      const d = v - mean;
      sumSq += d * d;
    }
    return Math.sqrt(sumSq / len);
  }

  function bollinger(values, period, stdMult) {
    const mid = sma(values, period);
    const sd = stdev(values, period);
    if (!Number.isFinite(mid) || !Number.isFinite(sd)) return null;
    return {
      middle: mid,
      upper: mid + sd * stdMult,
      lower: mid - sd * stdMult
    };
  }

  function atr(candles, period) {
    if (!Array.isArray(candles) || candles.length < period + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = toNum(candles[i].h);
      const l = toNum(candles[i].l);
      const pc = toNum(candles[i - 1].c);
      if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) continue;
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      trs.push(tr);
    }
    if (trs.length < period) return null;
    let sum = 0;
    for (let i = trs.length - period; i < trs.length; i++) sum += trs[i];
    return sum / period;
  }

  function rsi(values, period) {
    if (!Array.isArray(values) || values.length < period + 1 || period < 2) return null;

    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const prev = toNum(values[i - 1]);
      const curr = toNum(values[i]);
      if (![prev, curr].every(Number.isFinite)) return null;
      const delta = curr - prev;
      if (delta >= 0) gains += delta;
      else losses += Math.abs(delta);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function adxComponents(candles, period) {
    if (!Array.isArray(candles) || candles.length < period * 2 + 3) return null;

    const plusDM = [];
    const minusDM = [];
    const trs = [];

    for (let i = 1; i < candles.length; i++) {
      const h = toNum(candles[i].h);
      const l = toNum(candles[i].l);
      const ph = toNum(candles[i - 1].h);
      const pl = toNum(candles[i - 1].l);
      const pc = toNum(candles[i - 1].c);
      if (![h, l, ph, pl, pc].every(Number.isFinite)) continue;

      const upMove = h - ph;
      const downMove = pl - l;

      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    if (trs.length < period + 2) return null;

    function sumWindow(arr, start, len) {
      let s = 0;
      for (let i = start; i < start + len; i++) s += arr[i] || 0;
      return s;
    }

    const endNow = trs.length;
    const startNow = endNow - period;
    const endPrev = endNow - 1;
    const startPrev = endPrev - period;
    if (startNow < 0 || startPrev < 0) return null;

    const trNow = sumWindow(trs, startNow, period);
    const pdmNow = sumWindow(plusDM, startNow, period);
    const mdmNow = sumWindow(minusDM, startNow, period);
    const trPrev = sumWindow(trs, startPrev, period);
    const pdmPrev = sumWindow(plusDM, startPrev, period);
    const mdmPrev = sumWindow(minusDM, startPrev, period);
    if (trNow <= 0 || trPrev <= 0) return null;

    const plusDI = (100 * pdmNow) / trNow;
    const minusDI = (100 * mdmNow) / trNow;
    const prevPlusDI = (100 * pdmPrev) / trPrev;
    const prevMinusDI = (100 * mdmPrev) / trPrev;

    const dxs = [];
    for (let end = period; end <= trs.length; end++) {
      const start = end - period;
      const trN = sumWindow(trs, start, period);
      const pdmN = sumWindow(plusDM, start, period);
      const mdmN = sumWindow(minusDM, start, period);
      if (trN <= 0) continue;
      const pdi = (100 * pdmN) / trN;
      const mdi = (100 * mdmN) / trN;
      const den = pdi + mdi;
      dxs.push(den > 0 ? (100 * Math.abs(pdi - mdi)) / den : 0);
    }
    if (!dxs.length) return null;

    let dxSum = 0;
    for (let i = dxs.length - Math.min(period, dxs.length); i < dxs.length; i++) {
      dxSum += dxs[i];
    }

    return {
      adx: dxSum / Math.min(period, dxs.length),
      plusDI,
      minusDI,
      prevPlusDI,
      prevMinusDI
    };
  }

  function adx(candles, period) {
    if (!Array.isArray(candles) || candles.length < period * 2 + 2) return null;

    const plusDM = [];
    const minusDM = [];
    const trs = [];

    for (let i = 1; i < candles.length; i++) {
      const h = toNum(candles[i].h);
      const l = toNum(candles[i].l);
      const ph = toNum(candles[i - 1].h);
      const pl = toNum(candles[i - 1].l);
      const pc = toNum(candles[i - 1].c);
      if (![h, l, ph, pl, pc].every(Number.isFinite)) continue;

      const upMove = h - ph;
      const downMove = pl - l;

      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }

    if (trs.length < period * 2) return null;

    function sumTail(arr, len, offset) {
      let s = 0;
      const start = arr.length - offset - len;
      const end = arr.length - offset;
      for (let i = start; i < end; i++) s += arr[i];
      return s;
    }

    const dxs = [];
    for (let off = period; off >= 1; off--) {
      const trN = sumTail(trs, period, off - 1);
      const pdmN = sumTail(plusDM, period, off - 1);
      const mdmN = sumTail(minusDM, period, off - 1);
      if (!trN) continue;
      const pdi = (100 * pdmN) / trN;
      const mdi = (100 * mdmN) / trN;
      const den = pdi + mdi;
      const dx = den ? (100 * Math.abs(pdi - mdi)) / den : 0;
      dxs.push(dx);
    }

    if (!dxs.length) return null;
    let sum = 0;
    for (let i = 0; i < dxs.length; i++) sum += dxs[i];
    return sum / dxs.length;
  }

  function emaSlopeRatio(candles, emaPeriod, lookbackBars, atrPeriod) {
    if (!Array.isArray(candles) || candles.length < Math.max(emaPeriod + lookbackBars + 2, atrPeriod + 2)) return 0;
    const closes = closeSeries(candles);
    const eNow = ema(closes, emaPeriod);
    const olderCloses = closes.slice(0, closes.length - lookbackBars);
    const eOld = ema(olderCloses, emaPeriod);
    const atrNow = atr(candles, atrPeriod);
    if (![eNow, eOld, atrNow].every(Number.isFinite) || atrNow <= 0) return 0;
    return Math.abs(eNow - eOld) / atrNow;
  }

  LCPro.CSVRG.Indicators = {
    toNum,
    closeSeries,
    ema,
    sma,
    stdev,
    bollinger,
    atr,
    rsi,
    adx,
    adxComponents,
    emaSlopeRatio
  };
})();
