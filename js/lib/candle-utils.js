// Shared candle normalization helpers — used by all engine modules.
(function(){
  "use strict";

  function candleTimeMs(t){
    const n = Number(t);
    if(!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  function ensureChron(rows){
    if(!Array.isArray(rows)) return [];
    if(rows.length > 1 && rows[0].t && rows[rows.length-1].t && rows[0].t > rows[rows.length-1].t){
      return rows.reverse();
    }
    return rows;
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || raw || null);

    // Array-of-arrays ([[time, open, high, low, close], ...])
    if(Array.isArray(src) && src.length && Array.isArray(src[0])){
      const rows = src.map((r)=>({
        t: candleTimeMs(r[0] ?? 0),
        o: Number(r[1] ?? NaN),
        h: Number(r[2] ?? NaN),
        l: Number(r[3] ?? NaN),
        c: Number(r[4] ?? NaN)
      })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
      return ensureChron(rows);
    }

    // Array-of-objects
    if(Array.isArray(src)){
      const rows = src.map((c)=>({
        t: candleTimeMs(c?.time ?? c?.Time ?? c?.timestamp ?? c?.Timestamp ?? c?.t ?? 0),
        o: Number(c?.open ?? c?.Open ?? c?.o ?? NaN),
        h: Number(c?.high ?? c?.High ?? c?.h ?? NaN),
        l: Number(c?.low ?? c?.Low ?? c?.l ?? NaN),
        c: Number(c?.close ?? c?.Close ?? c?.c ?? NaN)
      })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
      return ensureChron(rows);
    }

    // Object-with-arrays ({ open: [...], high: [...], low: [...], close: [...], time: [...] })
    const o = raw.open || raw.Open || raw.o;
    const h = raw.high || raw.High || raw.h;
    const l = raw.low || raw.Low || raw.l;
    const c = raw.close || raw.Close || raw.c;
    const t = raw.time || raw.Time || raw.timestamp || raw.Timestamp || raw.t || [];
    if(Array.isArray(o) && Array.isArray(h) && Array.isArray(l) && Array.isArray(c)){
      const tLen = Array.isArray(t) ? t.length : 0;
      const n = Math.min(o.length, h.length, l.length, c.length, tLen > 0 ? tLen : Infinity);
      const rows = [];
      for(let i = 0; i < n; i++){
        const row = { t: candleTimeMs(t[i] ?? 0), o: Number(o[i]), h: Number(h[i]), l: Number(l[i]), c: Number(c[i]) };
        if(Number.isFinite(row.o) && Number.isFinite(row.h) && Number.isFinite(row.l) && Number.isFinite(row.c)) rows.push(row);
      }
      return ensureChron(rows);
    }

    return [];
  }

  if(typeof window !== "undefined"){
    window.CandleUtils = window.CandleUtils || {};
    window.CandleUtils.candleTimeMs = candleTimeMs;
    window.CandleUtils.normalizeCandles = normalizeCandles;
  }
  if(typeof module !== "undefined" && module.exports) module.exports = { candleTimeMs, normalizeCandles };
})();
