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
    adx,
    emaSlopeRatio
  };
})();
