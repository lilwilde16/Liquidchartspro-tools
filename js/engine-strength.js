(function(){
  const $ = (id)=>document.getElementById(id);
  const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];
  
  // Configuration constants
  const ATR_PCT_FLOOR = 0.0006;
  const MIN_TREND_RATIO = 0.25;
  const TF_WEIGHTS = {300: 0.2, 900: 0.5, 3600: 0.3};
  const TF_CONFIG = {
    300: {count: 300, name: "M5"},
    900: {count: 300, name: "M15"},
    3600: {count: 200, name: "H1"}
  };
  const SLOPE_LOOKBACK = 60;

  let autoTimer = null;
  let autoIntervalSec = null;
  let isRunning = false;
  let lastRanked = [];
  let lastPairs = [];
  let lastUpdatedAt = null;

  // Parse pairs from textarea, normalize to XXX/YYY format
  function parsePairs(){
    const raw = ($("pairs")?.value || "").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
    return raw.map((p)=>{
      const upper = p.toUpperCase();
      // Accept both "EUR/USD" and "EURUSD" formats
      if(/^[A-Z]{3}\/[A-Z]{3}$/.test(upper)) return upper;
      if(/^[A-Z]{6}$/.test(upper)) return `${upper.slice(0,3)}/${upper.slice(3)}`;
      return null;
    })
    .filter(Boolean)
    .filter((p)=>{
      const parts = parsePair(p);
      if(!parts) return false;
      return CCYS.includes(parts.base) && CCYS.includes(parts.quote);
    });
  }

  function parsePair(pair){
    const m = String(pair || "").toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if(!m) return null;
    return { base: m[1], quote: m[2] };
  }

  // Normalize candle payload to array of closes
  function normalizeCandles(raw){
    if(!raw) return null;
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);
    if(!Array.isArray(src)) return null;
    
    const closes = src.map((c)=>{
      const close = Number(c?.close ?? c?.Close ?? c?.c ?? c?.C ?? NaN);
      const high = Number(c?.high ?? c?.High ?? c?.h ?? c?.H ?? NaN);
      const low = Number(c?.low ?? c?.Low ?? c?.l ?? c?.L ?? NaN);
      return {
        close: Number.isFinite(close) ? close : NaN,
        high: Number.isFinite(high) ? high : NaN,
        low: Number.isFinite(low) ? low : NaN
      };
    });
    
    return closes;
  }

  // Calculate linear regression slope of ln(prices)
  function calcSlope(prices, lookback){
    if(prices.length < lookback) return NaN;
    const startIdx = prices.length - lookback;
    const slice = prices.slice(startIdx);
    const lnPrices = slice.map((p)=>Math.log(p));
    
    const n = lnPrices.length;
    const xMean = (n - 1) / 2;
    const yMean = lnPrices.reduce((a,b)=>a+b,0) / n;
    
    let num = 0, denom = 0;
    for(let i = 0; i < n; i++){
      const xDiff = i - xMean;
      const yDiff = lnPrices[i] - yMean;
      num += xDiff * yDiff;
      denom += xDiff * xDiff;
    }
    
    return denom === 0 ? 0 : num / denom;
  }

  // Calculate z-score normalization
  function zNormalize(values){
    if(!Array.isArray(values) || values.length === 0) return values.map(()=>0);
    
    const mean = values.reduce((a,b)=>a+b,0) / values.length;
    const variance = values.reduce((a,b)=>a+(b-mean)*(b-mean),0) / values.length;
    const std = Math.sqrt(variance);
    
    if(std < 0.0001) return values.map(()=>0);
    return values.map((v)=>(v - mean) / std);
  }

  // Fetch and compute metrics for a single pair+timeframe
  async function fetchPairTfMetrics(pair, tf, count, cache){
    const cacheKey = `${pair}_${tf}`;
    
    // Check cache
    if(cache[cacheKey]) return cache[cacheKey];
    
    try{
      const candles = await window.LC.requestCandles(pair, tf, count);
      const normalized = normalizeCandles(candles);
      
      if(!normalized || normalized.length < 150) {
        throw new Error("not enough candles");
      }
      
      const close = normalized.map((c)=>c.close);
      const high = normalized.map((c)=>c.high);
      const low = normalized.map((c)=>c.low);
      
      // Check for NaN values
      if(close.some((c)=>!Number.isFinite(c)) || high.some((h)=>!Number.isFinite(h)) || low.some((l)=>!Number.isFinite(l))){
        throw new Error("invalid candle data");
      }
      
      // Calculate indicators using window.UTIL if available
      let smaFast, smaSlow, atr;
      if(window.UTIL?.sma && window.UTIL?.atr){
        smaFast = window.UTIL.sma(close, 20);
        smaSlow = window.UTIL.sma(close, 100);
        atr = window.UTIL.atr(high, low, close, 14);
      } else {
        // Inline fallbacks
        smaFast = inlineSMA(close, 20);
        smaSlow = inlineSMA(close, 100);
        atr = inlineATR(high, low, close, 14);
      }
      
      const i = close.length - 1;
      const px = close[i];
      const atrNow = atr[i];
      const fastVal = smaFast[i];
      const slowVal = smaSlow[i];
      
      if(!Number.isFinite(px) || !Number.isFinite(atrNow) || !Number.isFinite(fastVal) || !Number.isFinite(slowVal)){
        throw new Error("indicator calculation failed");
      }
      
      if(atrNow <= 0 || px <= 0){
        throw new Error("invalid atr or price");
      }
      
      const atrPct = atrNow / px;
      const trendRatio = Math.abs(fastVal - slowVal) / atrNow;
      const returnPct = ((px / close[0]) - 1) * 100;
      const slope = calcSlope(close, Math.min(SLOPE_LOOKBACK, close.length));
      const slopeNorm = slope / Math.max(atrPct, ATR_PCT_FLOOR);
      const weightedReturn = returnPct / Math.max(atrPct, ATR_PCT_FLOOR);
      
      const result = {
        pair,
        tf,
        px,
        atrNow,
        atrPct,
        trendRatio,
        returnPct,
        slopeNorm,
        weightedReturn,
        valid: atrPct >= ATR_PCT_FLOOR && trendRatio >= MIN_TREND_RATIO
      };
      
      cache[cacheKey] = result;
      return result;
    } catch(e) {
      return { pair, tf, valid: false, error: e.message };
    }
  }

  // Inline SMA fallback
  function inlineSMA(values, len){
    const n = values.length;
    const out = new Array(n).fill(null);
    let sum = 0;
    for(let i = 0; i < n; i++){
      sum += values[i];
      if(i >= len) sum -= values[i - len];
      if(i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  // Inline ATR fallback
  function inlineATR(high, low, close, len){
    const n = close.length;
    const tr = new Array(n).fill(null);
    for(let i = 1; i < n; i++){
      const a = high[i] - low[i];
      const b = Math.abs(high[i] - close[i - 1]);
      const c = Math.abs(low[i] - close[i - 1]);
      tr[i] = Math.max(a, b, c);
    }
    const out = new Array(n).fill(null);
    let sum = 0;
    for(let i = 1; i <= len; i++) sum += (tr[i] ?? 0);
    let prev = sum / len;
    out[len] = prev;
    for(let i = len + 1; i < n; i++){
      prev = ((prev * (len - 1)) + (tr[i] ?? 0)) / len;
      out[i] = prev;
    }
    return out;
  }

  // Main run function
  async function run(){
    if(isRunning) return;
    isRunning = true;

    const pairs = parsePairs();
    
    try{
      if(!window.LC?.requestCandles){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: Candles API unavailable.");
        if($("strengthStatus")) $("strengthStatus").textContent = "Candles API unavailable.";
        return;
      }

      if(pairs.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid pairs in settings.");
        if($("strengthStatus")) $("strengthStatus").textContent = "No valid pairs configured.";
        return;
      }

      window.LC.setStatus("Scanning strength…", "warn");
      window.LC.log(`▶ Strength scan started (${pairs.length} pairs, multi-TF M5/M15/H1).`);

      const cache = {};
      const timeframes = [300, 900, 3600];
      
      // Fetch all pair+tf combinations
      const tasks = [];
      for(const pair of pairs){
        for(const tf of timeframes){
          const cfg = TF_CONFIG[tf];
          tasks.push(fetchPairTfMetrics(pair, tf, cfg.count, cache));
        }
      }
      
      const allResults = await Promise.allSettled(tasks);
      const metrics = allResults
        .filter((r)=>r.status === "fulfilled")
        .map((r)=>r.value)
        .filter((m)=>m.valid);
      
      if(metrics.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid metrics computed.");
        if($("strengthStatus")) $("strengthStatus").textContent = "No valid data for any pair/timeframe.";
        if($("strengthTable")) $("strengthTable").innerHTML = "";
        if($("strengthBestPairs")) $("strengthBestPairs").textContent = "No ideas available.";
        return;
      }
      
      // Group by timeframe for z-normalization
      const byTf = {};
      for(const m of metrics){
        if(!byTf[m.tf]) byTf[m.tf] = [];
        byTf[m.tf].push(m);
      }
      
      // Z-normalize per timeframe
      for(const tf of Object.keys(byTf)){
        const tfMetrics = byTf[tf];
        const slopeNorms = tfMetrics.map((m)=>m.slopeNorm);
        const weightedReturns = tfMetrics.map((m)=>m.weightedReturn);
        
        const slopeNormZ = zNormalize(slopeNorms);
        const weightedReturnZ = zNormalize(weightedReturns);
        
        for(let i = 0; i < tfMetrics.length; i++){
          tfMetrics[i].slopeNormZ = slopeNormZ[i];
          tfMetrics[i].weightedReturnZ = weightedReturnZ[i];
          tfMetrics[i].compositeTF = (0.4 * slopeNormZ[i]) + (0.3 * tfMetrics[i].trendRatio) + (0.3 * weightedReturnZ[i]);
        }
      }
      
      // Blend across timeframes per pair
      const pairComposites = {};
      for(const pair of pairs){
        const pairMetrics = metrics.filter((m)=>m.pair === pair);
        if(pairMetrics.length === 0) continue;
        
        let totalWeight = 0;
        let weightedSum = 0;
        let avgWeightedReturn = 0;
        let tfCount = 0;
        
        for(const m of pairMetrics){
          const w = TF_WEIGHTS[m.tf] || 0;
          totalWeight += w;
          weightedSum += m.compositeTF * w;
          avgWeightedReturn += Math.abs(m.weightedReturn);
          tfCount++;
        }
        
        if(totalWeight > 0){
          pairComposites[pair] = {
            pair,
            compositeBlend: weightedSum / totalWeight,
            avgAbsWeightedReturn: avgWeightedReturn / tfCount,
            tfCount
          };
        }
      }
      
      // Aggregate to currencies
      const scores = {};
      CCYS.forEach((c)=>{ scores[c] = { ccy: c, score: 0, samples: 0, absMove: 0 }; });
      
      for(const pair of Object.keys(pairComposites)){
        const pc = pairComposites[pair];
        const parsed = parsePair(pair);
        if(!parsed) continue;
        
        scores[parsed.base].score += pc.compositeBlend;
        scores[parsed.base].samples += 1;
        scores[parsed.base].absMove += pc.avgAbsWeightedReturn;
        
        scores[parsed.quote].score -= pc.compositeBlend;
        scores[parsed.quote].samples += 1;
        scores[parsed.quote].absMove += pc.avgAbsWeightedReturn;
      }
      
      const ranked = Object.values(scores)
        .filter((r)=>r.samples > 0)
        .map((r)=>({ ...r, avgScore: r.score / r.samples, avgAbsMove: r.absMove / r.samples }))
        .sort((a, b)=>b.avgScore - a.avgScore);
      
      lastRanked = ranked;
      lastPairs = pairs;
      lastUpdatedAt = Date.now();
      
      renderTable(ranked);
      renderBestPairs(ranked);
      
      const strongest = ranked[0]?.ccy || "n/a";
      const weakest = ranked[ranked.length - 1]?.ccy || "n/a";
      
      const autoTag = autoIntervalSec ? ` · auto ${autoIntervalSec}s` : "";
      const validPairs = Object.keys(pairComposites).length;
      if($("strengthStatus")){
        $("strengthStatus").textContent = `Updated: ${new Date().toLocaleString()} · strongest ${strongest}, weakest ${weakest} · pairs ok ${validPairs}/${pairs.length}${autoTag}`;
      }
      
      window.LC.log(`✅ Strength scan done. Strongest: ${strongest}, weakest: ${weakest}. Valid pairs: ${validPairs}/${pairs.length}`);
      window.LC.setStatus("Strength done", "ok");
      
    } catch(e) {
      window.LC.setStatus("Strength error", "bad");
      window.LC.log(`❌ Strength scan failed: ${e?.message || e}`);
      if($("strengthStatus")) $("strengthStatus").textContent = `Error: ${e?.message || "unknown"}`;
    } finally {
      isRunning = false;
    }
  }

  function renderTable(rows){
    const body = rows.map((r, i)=>{
      const cls = r.avgScore >= 0 ? "str-up" : "str-down";
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${r.ccy}</strong></td>
        <td class="${cls}">${r.avgScore.toFixed(3)}</td>
        <td>${r.avgAbsMove.toFixed(3)}</td>
        <td>${r.samples}</td>
      </tr>`;
    }).join("");

    if($("strengthTable")){
      $("strengthTable").innerHTML = `
        <table border="1" cellpadding="5" cellspacing="0">
          <thead>
            <tr>
              <th>#</th>
              <th>Currency</th>
              <th>Strength Score</th>
              <th>Avg Pair Move</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>`;
    }
  }

  function renderBestPairs(ranked){
    const host = $("strengthBestPairs");
    if(!host) return;
    if(!ranked || ranked.length < 2){
      host.textContent = "Not enough data to rank pairs.";
      return;
    }

    const strongest = ranked.slice(0, 3);
    const weakest = ranked.slice(-3).reverse();
    const ideas = [];
    for(let i = 0; i < Math.min(strongest.length, weakest.length); i++){
      const base = strongest[i].ccy;
      const quote = weakest[i].ccy;
      ideas.push({ pair: `${base}/${quote}`, bias: "Buy bias", spread: strongest[i].avgScore - weakest[i].avgScore });
    }

    host.innerHTML = `<h3>Best Pair Ideas</h3>` + ideas.map((x)=>`<div style="padding:5px;"><strong>${x.pair}</strong> · <span style="color:green;">${x.bias}</span> · spread ${x.spread.toFixed(3)}</div>`).join("");
  }

  function startAuto(){
    const requested = Number($("strengthAutoSec")?.value || 60);
    const sec = Math.max(10, Math.min(900, Number.isFinite(requested) ? requested : 60));
    if(autoTimer) clearInterval(autoTimer);
    autoIntervalSec = sec;
    autoTimer = setInterval(()=>{ run(); }, sec * 1000);
    window.LC.log(`🔄 Strength auto refresh ON (${sec}s).`);
    if($("strengthStatus")) $("strengthStatus").textContent = `Auto refresh enabled (${sec}s).`;
    run();
  }

  function stopAuto(){
    if(autoTimer){
      clearInterval(autoTimer);
      autoTimer = null;
      autoIntervalSec = null;
      window.LC.log("⏹ Strength auto refresh OFF.");
      if($("strengthStatus")) $("strengthStatus").textContent = "Auto refresh stopped.";
    }
  }

  function init(){
    if($("btnStrengthRun")) $("btnStrengthRun").onclick = run;
    if($("btnStrengthAuto")) $("btnStrengthAuto").onclick = startAuto;
    if($("btnStrengthStop")) $("btnStrengthStop").onclick = stopAuto;
  }

  function getSnapshot(){
    return {
      ranked: Array.isArray(lastRanked) ? [...lastRanked] : [],
      pairs: Array.isArray(lastPairs) ? [...lastPairs] : [],
      updatedAt: lastUpdatedAt || Date.now()
    };
  }

  window.ENG = window.ENG || {};
  window.ENG.Strength = { run, init, startAuto, stopAuto, getSnapshot };
})();
