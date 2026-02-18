(function(){
  "use strict";

  // === CONFIGURATION CONSTANTS ===
  const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];
  
  // Multi-timeframe weights
  const TF_WEIGHTS = {
    300: 0.3,   // M5
    900: 0.5,   // M15
    3600: 0.2   // H1
  };
  
  // ATR normalization floor
  const ATR_PCT_FLOOR = 0.0008;
  
  // Minimum trend ratio for valid signals
  const MIN_TREND_RATIO = 0.40;
  
  // Regression window for slope calculation
  const REG_WINDOW = 60;
  
  // RSI parameters
  const RSI_PERIOD = 7;
  const USE_RSI = true; // Toggle for RSI spread calculation
  
  // Composite weights
  const WEIGHTS_WITH_RSI = {
    rsiSpread: 0.35,
    trendRatio: 0.35,
    weightedReturn: 0.30
  };
  
  const WEIGHTS_WITHOUT_RSI = {
    slopeZ: 0.4,
    trendRatio: 0.3,
    weightedReturn: 0.3
  };

  // === MODULE STATE ===
  const $ = (id)=>document.getElementById(id);
  let autoTimer = null;
  let autoIntervalSec = null;
  let isRunning = false;
  let lastRanked = [];
  let lastPairs = [];
  let runCache = {}; // In-run cache for candle data

  // === UTILITY FUNCTIONS ===
  function parsePairs(){
    const raw = ($("pairs")?.value || "").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
    return raw.map(normalizePairFormat).filter(Boolean).map((p)=>p.toUpperCase());
  }

  function normalizePairFormat(pair){
    // Accept both EUR/USD and EURUSD formats, normalize to XXX/YYY
    const clean = String(pair || "").trim().toUpperCase();
    
    // Already in XXX/YYY format
    if(/^[A-Z]{3}\/[A-Z]{3}$/.test(clean)) return clean;
    
    // XXXYYY format - convert to XXX/YYY
    if(/^[A-Z]{6}$/.test(clean)){
      return clean.slice(0,3) + "/" + clean.slice(3);
    }
    
    return null;
  }

  function parsePair(pair){
    const normalized = normalizePairFormat(pair);
    if(!normalized) return null;
    const parts = normalized.split("/");
    return { base: parts[0], quote: parts[1], pair: normalized };
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);
    if(!src || !Array.isArray(src)) return [];
    
    return src.map((c)=>({
      o: Number(c?.open ?? c?.Open ?? c?.o ?? NaN),
      h: Number(c?.high ?? c?.High ?? c?.h ?? NaN),
      l: Number(c?.low ?? c?.Low ?? c?.l ?? NaN),
      c: Number(c?.close ?? c?.Close ?? c?.c ?? NaN)
    })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
  }

  function zScore(arr){
    const n = arr.filter(Number.isFinite);
    if(n.length === 0) return arr.map(()=>0);
    
    const mean = n.reduce((a,b)=>a+b,0) / n.length;
    const variance = n.reduce((a,b)=>a+Math.pow(b-mean,2),0) / n.length;
    const std = Math.sqrt(variance);
    
    if(std === 0) return arr.map(()=>0);
    return arr.map((v)=>Number.isFinite(v) ? (v - mean) / std : 0);
  }

  function guardNaN(val, fallback=0){
    return Number.isFinite(val) ? val : fallback;
  }

  // === DATA FETCHING ===
  async function fetchPairCandles(pair, timeframe, count){
    const cacheKey = `${pair}_${timeframe}_${count}`;
    if(runCache[cacheKey]) return runCache[cacheKey];
    
    try{
      const raw = await window.LC.requestCandles(pair, timeframe, count);
      const candles = normalizeCandles(raw);
      runCache[cacheKey] = candles;
      return candles;
    }catch(e){
      throw new Error(`Failed to fetch ${pair} ${timeframe}: ${e.message}`);
    }
  }

  async function fetchMultiTFData(pair, count){
    const timeframes = Object.keys(TF_WEIGHTS).map(Number);
    const results = await Promise.allSettled(
      timeframes.map(async (tf)=>{
        const candles = await fetchPairCandles(pair, tf, count);
        return { tf, candles };
      })
    );
    
    const data = {};
    for(const r of results){
      if(r.status === "fulfilled"){
        data[r.value.tf] = r.value.candles;
      }
    }
    
    return data;
  }

  // === INDICATOR CALCULATIONS ===
  function calculatePairStrength(pair, tfData, count){
    if(!tfData || Object.keys(tfData).length === 0){
      throw new Error("No timeframe data available");
    }

    const scores = [];
    const weights = [];

    for(const [tfStr, candles] of Object.entries(tfData)){
      const tf = Number(tfStr);
      const weight = TF_WEIGHTS[tf] || 0;
      if(weight === 0 || !candles || candles.length < Math.max(REG_WINDOW, RSI_PERIOD + 1)) continue;

      const close = candles.map(c=>c.c);
      const high = candles.map(c=>c.h);
      const low = candles.map(c=>c.l);
      
      // Calculate indicators
      const atr = window.UTIL.atr(high, low, close, 14);
      const sma20 = window.UTIL.sma(close, 20);
      const sma100 = window.UTIL.sma(close, 100);
      const slope = window.UTIL.linregSlope ? window.UTIL.linregSlope(close, REG_WINDOW) : null;
      const rsi = USE_RSI && window.UTIL.rsi ? window.UTIL.rsi(close, RSI_PERIOD) : null;

      const i = close.length - 1;
      const currentClose = close[i];
      const currentATR = guardNaN(atr[i]);
      
      if(currentATR === 0 || currentClose === 0) continue;

      // ATR normalization
      const atrPct = currentATR / currentClose;
      const normalizedATR = Math.max(atrPct, ATR_PCT_FLOOR);

      // Trend ratio
      const ma20 = guardNaN(sma20[i]);
      const ma100 = guardNaN(sma100[i]);
      const trendRatio = currentATR > 0 ? Math.abs(ma20 - ma100) / currentATR : 0;

      // Weighted return
      const lookback = Math.min(20, close.length - 1);
      const weightedReturn = (currentClose - close[i - lookback]) / close[i - lookback];

      // Slope z-score
      const slopeValue = slope ? guardNaN(slope[i], 0) : 0;

      // RSI spread (strong currencies have diverging RSI from neutrals)
      let rsiSpread = 0;
      if(rsi && USE_RSI){
        const currentRSI = guardNaN(rsi[i], 50);
        rsiSpread = (currentRSI - 50) / 50; // Normalize to [-1, 1]
      }

      // Calculate composite score
      let compositeScore;
      if(USE_RSI && rsi){
        compositeScore = 
          WEIGHTS_WITH_RSI.rsiSpread * rsiSpread +
          WEIGHTS_WITH_RSI.trendRatio * (trendRatio / MIN_TREND_RATIO) +
          WEIGHTS_WITH_RSI.weightedReturn * weightedReturn * 100;
      }else{
        compositeScore = 
          WEIGHTS_WITHOUT_RSI.slopeZ * slopeValue +
          WEIGHTS_WITHOUT_RSI.trendRatio * (trendRatio / MIN_TREND_RATIO) +
          WEIGHTS_WITHOUT_RSI.weightedReturn * weightedReturn * 100;
      }

      scores.push(compositeScore);
      weights.push(weight);
    }

    if(scores.length === 0) throw new Error("No valid timeframe scores");

    // Weighted average across timeframes
    const totalWeight = weights.reduce((a,b)=>a+b, 0);
    const finalScore = scores.reduce((sum, score, i)=>sum + score * weights[i], 0) / totalWeight;

    return {
      pair,
      score: guardNaN(finalScore, 0),
      tfCount: scores.length
    };
  }

  function scoreCurrencies(pairStrengths){
    const scores = {};
    CCYS.forEach((c)=>{ scores[c] = { ccy: c, score: 0, samples: 0, absScore: 0 }; });

    for(const ps of pairStrengths){
      const parsed = parsePair(ps.pair);
      if(!parsed) continue;

      scores[parsed.base].score += ps.score;
      scores[parsed.base].samples += 1;
      scores[parsed.base].absScore += Math.abs(ps.score);

      scores[parsed.quote].score -= ps.score;
      scores[parsed.quote].samples += 1;
      scores[parsed.quote].absScore += Math.abs(ps.score);
    }

    return Object.values(scores)
      .filter((r)=>r.samples > 0)
      .map((r)=>({
        ...r,
        avgScore: r.score / r.samples,
        avgAbsScore: r.absScore / r.samples
      }))
      .sort((a, b)=>b.avgScore - a.avgScore);
  }

  // === RENDERING ===
  function renderTable(rows){
    const body = rows.map((r, i)=>{
      const cls = r.avgScore >= 0 ? "str-up" : "str-down";
      return `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${r.ccy}</strong></td>
        <td class="${cls}">${r.avgScore.toFixed(3)}</td>
        <td>${r.avgAbsScore.toFixed(3)}</td>
        <td>${r.samples}</td>
      </tr>`;
    }).join("");

    $("strengthTable").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Currency</th>
            <th>Strength Score</th>
            <th>Avg Abs Score</th>
            <th>Samples</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
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
      const spread = strongest[i].avgScore - weakest[i].avgScore;
      ideas.push({ 
        pair: `${base}/${quote}`, 
        bias: "Buy bias", 
        spread
      });
    }

    host.innerHTML = ideas.map((x)=>
      `<div class="pairIdea">
        <strong>${x.pair}</strong> · 
        <span class="str-up">${x.bias}</span> · 
        spread ${x.spread.toFixed(3)}
      </div>`
    ).join("");
  }

  // === AUTO REFRESH ===
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

  // === MAIN SCAN ===
  async function run(){
    if(isRunning) return;
    isRunning = true;
    runCache = {}; // Clear cache for fresh run

    const timeframe = Number($("strengthTf")?.value || 900);
    const count = Number($("strengthCount")?.value || 500);
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
      window.LC.log(`▶ Strength scan started (${pairs.length} pairs, multi-TF: ${Object.keys(TF_WEIGHTS).join(",")}, candles=${count}).`);

      // Fetch multi-timeframe data for all pairs
      const settled = await Promise.allSettled(
        pairs.map(async (pair)=>{
          const tfData = await fetchMultiTFData(pair, count);
          return calculatePairStrength(pair, tfData, count);
        })
      );

      const ok = settled.filter((r)=>r.status === "fulfilled").map((r)=>r.value);
      const bad = settled.filter((r)=>r.status === "rejected");

      if(ok.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no pair data returned.");
        if($("strengthStatus")) $("strengthStatus").textContent = "No data returned for selected pairs/timeframe.";
        $("strengthTable").innerHTML = "";
        $("strengthBestPairs").textContent = "No ideas available.";
        return;
      }

      const ranked = scoreCurrencies(ok);
      lastRanked = ranked;
      lastPairs = ok.map((x)=>x.pair);
      
      renderTable(ranked);
      renderBestPairs(ranked);

      const strongest = ranked[0]?.ccy || "n/a";
      const weakest = ranked[ranked.length - 1]?.ccy || "n/a";

      const autoTag = autoIntervalSec ? ` · auto ${autoIntervalSec}s` : "";
      if($("strengthStatus")){
        $("strengthStatus").textContent = `Updated: ${new Date().toLocaleString()} · strongest ${strongest}, weakest ${weakest} · pairs ok ${ok.length}/${pairs.length}${autoTag}`;
      }
      
      if(bad.length > 0){
        window.LC.log(`⚠ Strength scan partial data: ${bad.length} pair(s) failed.`);
      }
      
      window.LC.log(`✅ Strength scan done. Strongest: ${strongest}, weakest: ${weakest}.`);
      window.LC.setStatus(bad.length ? "Strength done (partial)" : "Strength done", bad.length ? "warn" : "ok");
      
    }catch(e){
      window.LC.setStatus("Strength error", "bad");
      window.LC.log(`❌ Strength scan failed: ${e?.message || e}`);
      if($("strengthStatus")) $("strengthStatus").textContent = `Error: ${e?.message || "Unknown error"}`;
    }finally{
      isRunning = false;
    }
  }

  // === INITIALIZATION ===
  function init(){
    if($("btnStrengthAuto")) $("btnStrengthAuto").onclick = startAuto;
    if($("btnStrengthStop")) $("btnStrengthStop").onclick = stopAuto;
  }

  function getSnapshot(){
    return {
      ranked: Array.isArray(lastRanked) ? [...lastRanked] : [],
      pairs: Array.isArray(lastPairs) ? [...lastPairs] : [],
      updatedAt: Date.now()
    };
  }

  // === PUBLIC API ===
  window.ENG = window.ENG || {};
  window.ENG.Strength = { run, init, startAuto, stopAuto, getSnapshot };
})();
