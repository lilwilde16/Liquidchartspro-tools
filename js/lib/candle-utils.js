// Shared candle normalization helpers — used by all engine modules.
(function(){
  "use strict";

  function candleTimeMs(t){
    if(!Number.isFinite(t) || t <= 0) return 0;
    return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || raw);
    if(!Array.isArray(src)) return [];
    const rows = src.map((c)=>({
      t: candleTimeMs(Number(c?.time ?? c?.Time ?? c?.timestamp ?? c?.Timestamp ?? c?.t ?? 0)),
      o: Number(c?.open ?? c?.Open ?? c?.o ?? NaN),
      h: Number(c?.high ?? c?.High ?? c?.h ?? NaN),
      l: Number(c?.low ?? c?.Low ?? c?.l ?? NaN),
      c: Number(c?.close ?? c?.Close ?? c?.c ?? NaN)
    })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
    if(rows.length > 1 && rows[0].t && rows[rows.length-1].t && rows[0].t > rows[rows.length-1].t) rows.reverse();
    return rows;
  }

  window.CandleUtils = { candleTimeMs, normalizeCandles };
})();
