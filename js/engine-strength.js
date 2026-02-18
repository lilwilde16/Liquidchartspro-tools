(function(){
  const $ = (id)=>document.getElementById(id);
  const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];

  let autoTimer = null;
  let autoIntervalSec = null;
  let isRunning = false;
  let lastRanked = [];
  let lastPairs = [];

  // Parse pairs from textarea, supporting both "EUR/USD" and "EURUSD" formats
  function parsePairs(){
    const raw = ($("pairs")?.value || "").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
    return raw.map((p)=>{
      const upper = p.toUpperCase();
      // Support "EURUSD" format by converting to "EUR/USD"
      if(/^[A-Z]{6}$/.test(upper)){
        return `${upper.slice(0,3)}/${upper.slice(3,6)}`;
      }
      return upper;
    }).filter((p)=>/^[A-Z]{3}\/[A-Z]{3}$/.test(p));
  }

  // Parse a single pair, supporting both formats, validate against majors
  function parsePair(pair){
    let normalized = String(pair || "").toUpperCase().trim();
    
    // Convert "EURUSD" to "EUR/USD"
    if(/^[A-Z]{6}$/.test(normalized)){
      normalized = `${normalized.slice(0,3)}/${normalized.slice(3,6)}`;
    }
    
    const m = normalized.match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if(!m) return null;
    
    const base = m[1];
    const quote = m[2];
    
    // Validate both currencies are in majors set
    if(!CCYS.includes(base) || !CCYS.includes(quote)) return null;
    
    return { base, quote, pair: normalized };
  }

  // Enhanced normalizeCandles to accept framework payloads
  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);
    if(!src || !Array.isArray(src)) return [];
    
    return src.map((c)=>{
      return {
        o: Number(c?.open ?? c?.Open ?? c?.o ?? c?.O ?? 0),
        h: Number(c?.high ?? c?.High ?? c?.h ?? c?.H ?? 0),
        l: Number(c?.low ?? c?.Low ?? c?.l ?? c?.L ?? 0),
        c: Number(c?.close ?? c?.Close ?? c?.c ?? c?.C ?? 0)
      };
    }).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c) && x.c > 0);
  }

  // Helper: compute mean
  function mean(arr){
    if(!arr || arr.length === 0) return 0;
    const valid = arr.filter(Number.isFinite);
    if(valid.length === 0) return 0;
    return valid.reduce((a,b)=>a+b, 0) / valid.length;
  }

  // Helper: compute standard deviation
  function stdDev(arr){
    if(!arr || arr.length < 2) return 0;
    const valid = arr.filter(Number.isFinite);
    if(valid.length < 2) return 0;
    const m = mean(valid);
    const variance = valid.reduce((sum, x)=>sum + Math.pow(x - m, 2), 0) / valid.length;
    return Math.sqrt(variance);
  }

  // Helper: z-score normalization
  function zScore(value, arr){
    const m = mean(arr);
    const sd = stdDev(arr);
    if(sd < 0.0001) return 0; // avoid division by zero
    return (value - m) / sd;
  }

  // Compute metrics for a single pair at a single timeframe
  async function computePairTFMetrics(pair, tf, count){
    const candles = await window.LC.requestCandles(pair, tf, count);
    const normalized = normalizeCandles(candles);
    
    if(normalized.length < 120){
      throw new Error("insufficient candles");
    }

    const close = normalized.map((x)=>x.c);
    const high = normalized.map((x)=>x.h);
    const low = normalized.map((x)=>x.l);

    // Check if UTIL is available, else fallback
    if(!window.UTIL?.sma || !window.UTIL?.atr){
      throw new Error("indicator utils missing");
    }

    const fastSMA = window.UTIL.sma(close, 20);
    const slowSMA = window.UTIL.sma(close, 100);
    const atr = window.UTIL.atr(high, low, close, 14);

    const i = close.length - 1;
    const px = close[i];
    const atrNow = atr[i];
    
    if(!Number.isFinite(atrNow) || atrNow <= 0 || !Number.isFinite(px) || px <= 0){
      throw new Error("invalid ATR or price");
    }

    const atrPct = atrNow / px;
    const trendRatio = Math.abs(fastSMA[i] - slowSMA[i]) / atrNow;
    const returnPct = ((px / close[0]) - 1) * 100;

    // Compute slopeNorm: linear regression slope of ln(close) over last 60 bars
    const K = 60;
    const startIdx = Math.max(0, i - K + 1);
    const recentCloses = close.slice(startIdx, i + 1);
    const lnCloses = recentCloses.map(Math.log);
    
    let slope = 0;
    if(window.UTIL?.linregSlope){
      const slopes = window.UTIL.linregSlope(lnCloses, Math.min(K, lnCloses.length));
      slope = slopes[slopes.length - 1] || 0;
    } else {
      // Inline fallback for linear regression slope
      const n = lnCloses.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for(let j = 0; j < n; j++){
        const x = j;
        const y = lnCloses[j];
        if(!Number.isFinite(y)) continue;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
      }
      slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      if(!Number.isFinite(slope)) slope = 0;
    }
    
    const atrPctFloor = Math.max(atrPct, 0.0006);
    const slopeNorm = slope / atrPctFloor;

    // Quality filter
    const isWeak = (atrPct < 0.0006) || (trendRatio < 0.25);

    return {
      pair,
      tf,
      px,
      atrNow,
      atrPct,
      trendRatio,
      returnPct,
      slopeNorm,
      isWeak,
      atrPctFloor
    };
  }

  // Multi-timeframe strength computation
  async function computeMultiTFStrength(){
    const pairs = parsePairs();
    if(pairs.length === 0) throw new Error("no valid pairs");

    // Define timeframes: M5=300s, M15=900s, H1=3600s
    const TFs = [
      { name: "M5", seconds: 300, count: 300, weight: 0.2 },
      { name: "M15", seconds: 900, count: 300, weight: 0.5 },
      { name: "H1", seconds: 3600, count: 200, weight: 0.3 }
    ];

    const results = {};
    
    // Fetch and compute metrics for all pairs x all TFs
    for(const tfConfig of TFs){
      const tfResults = [];
      
      const settled = await Promise.allSettled(
        pairs.map((p)=>computePairTFMetrics(p, tfConfig.seconds, tfConfig.count))
      );
      
      const ok = settled.filter((r)=>r.status === "fulfilled").map((r)=>r.value);
      const validMetrics = ok.filter((m)=>!m.isWeak);
      
      if(validMetrics.length === 0){
        window.LC.log(`⚠ ${tfConfig.name}: all pairs weak/filtered`);
        continue;
      }

      // Z-normalize slopeNorm and returnPct across pairs for this TF
      const slopeNorms = validMetrics.map((m)=>m.slopeNorm);
      const wReturns = validMetrics.map((m)=>m.returnPct / m.atrPctFloor);
      
      for(const m of validMetrics){
        const slopeNormZ = zScore(m.slopeNorm, slopeNorms);
        const wReturnZ = zScore(m.returnPct / m.atrPctFloor, wReturns);
        
        // Composite score for this TF
        const compositeTF = (0.4 * slopeNormZ) + (0.3 * m.trendRatio) + (0.3 * wReturnZ);
        
        tfResults.push({
          pair: m.pair,
          compositeTF,
          returnPct: m.returnPct,
          atrPctFloor: m.atrPctFloor
        });
      }
      
      results[tfConfig.name] = { data: tfResults, weight: tfConfig.weight };
    }

    // Blend across timeframes
    const pairComposites = {};
    
    for(const tfName of Object.keys(results)){
      const tfData = results[tfName].data;
      const weight = results[tfName].weight;
      
      for(const item of tfData){
        if(!pairComposites[item.pair]){
          pairComposites[item.pair] = { 
            totalWeight: 0, 
            weightedSum: 0,
            absMove: 0,
            absSamples: 0
          };
        }
        
        pairComposites[item.pair].weightedSum += item.compositeTF * weight;
        pairComposites[item.pair].totalWeight += weight;
        pairComposites[item.pair].absMove += Math.abs(item.returnPct / item.atrPctFloor);
        pairComposites[item.pair].absSamples += 1;
      }
    }

    // Compute final composite blend for each pair
    const pairScores = [];
    for(const pair of Object.keys(pairComposites)){
      const pc = pairComposites[pair];
      if(pc.totalWeight === 0) continue;
      
      const compositeBlend = pc.weightedSum / pc.totalWeight;
      const avgAbsMove = pc.absSamples > 0 ? pc.absMove / pc.absSamples : 0;
      
      pairScores.push({ pair, compositeBlend, avgAbsMove });
    }

    return pairScores;
  }

  // Currency scoring from pair composites
  function scoreCurrencies(pairScores){
    const scores = {};
    CCYS.forEach((c)=>{ 
      scores[c] = { ccy: c, score: 0, samples: 0, absMove: 0 }; 
    });

    for(const ps of pairScores){
      const parsed = parsePair(ps.pair);
      if(!parsed) continue;

      scores[parsed.base].score += ps.compositeBlend;
      scores[parsed.base].samples += 1;
      scores[parsed.base].absMove += ps.avgAbsMove;

      scores[parsed.quote].score -= ps.compositeBlend;
      scores[parsed.quote].samples += 1;
      scores[parsed.quote].absMove += ps.avgAbsMove;
    }

    return Object.values(scores)
      .filter((r)=>r.samples > 0)
      .map((r)=>({ 
        ...r, 
        avgScore: r.score / r.samples, 
        avgAbsMove: r.absMove / r.samples 
      }))
      .sort((a, b)=>b.avgScore - a.avgScore);
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

    $("strengthTable").innerHTML = `
      <table>
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
      ideas.push({ pair: `${base}/${quote}`, bias: "Buy bias", spread });
    }

    host.innerHTML = ideas.map((x)=>`<div class="pairIdea"><strong>${x.pair}</strong> · <span class="str-up">${x.bias}</span> · spread ${x.spread.toFixed(3)}</div>`).join("");
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

  async function run(){
    if(isRunning) return;
    isRunning = true;

    try{
      if(!window.LC?.requestCandles){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: Candles API unavailable.");
        $("strengthStatus").textContent = "Candles API unavailable.";
        return;
      }

      const pairs = parsePairs();
      if(pairs.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid pairs in settings.");
        $("strengthStatus").textContent = "No valid pairs configured.";
        return;
      }

      window.LC.setStatus("Scanning strength…", "warn");
      window.LC.log(`▶ Strength scan started (${pairs.length} pairs, multi-TF: M5/M15/H1).`);

      const pairScores = await computeMultiTFStrength();
      
      if(pairScores.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid pair data.");
        $("strengthStatus").textContent = "No valid pair data after filtering.";
        $("strengthTable").innerHTML = "";
        $("strengthBestPairs").textContent = "No ideas available.";
        return;
      }

      const ranked = scoreCurrencies(pairScores);
      lastRanked = ranked;
      lastPairs = pairScores.map((x)=>x.pair);
      
      renderTable(ranked);
      renderBestPairs(ranked);

      const strongest = ranked[0]?.ccy || "n/a";
      const weakest = ranked[ranked.length - 1]?.ccy || "n/a";

      const autoTag = autoIntervalSec ? ` · auto ${autoIntervalSec}s` : "";
      $("strengthStatus").textContent = `Updated: ${new Date().toLocaleString()} · strongest ${strongest}, weakest ${weakest} · pairs ${pairScores.length}${autoTag}`;
      window.LC.log(`✅ Strength scan done. Strongest: ${strongest}, weakest: ${weakest}.`);
      window.LC.setStatus("Strength done", "ok");
    } catch(e) {
      window.LC.setStatus("Strength error", "bad");
      window.LC.log(`❌ Strength scan failed: ${e?.message || e}`);
      $("strengthStatus").textContent = `Error: ${e?.message || "unknown"}`;
    } finally {
      isRunning = false;
    }
  }

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

  window.ENG = window.ENG || {};
  window.ENG.Strength = { run, init, startAuto, stopAuto, getSnapshot };
})();
