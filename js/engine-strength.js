(function(){
  const $ = (id)=>document.getElementById(id);
  const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];
  
  // Configuration constants
  const ATR_PCT_FLOOR = 0.0008;
  const MIN_TREND_RATIO = 0.40;
  const REG_WINDOW = 60;
  const TF_WEIGHTS = {300: 0.3, 900: 0.5, 3600: 0.2};
  const TF_COUNTS = {300: 300, 900: 300, 3600: 200};
  const USE_RSI = true;
  const COMPOSITE_MODE = "blended";

  let autoTimer = null;
  let autoIntervalSec = null;
  let isRunning = false;
  let lastRanked = [];
  let lastPairs = [];
  let candleCache = {};

  function parsePairs(){
    const raw = ($("pairs")?.value || "").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
    return raw.map((p)=>{
      const cleaned = p.replace(/[^A-Z\/]/gi, '').toUpperCase();
      if(/^[A-Z]{6}$/.test(cleaned)) return `${cleaned.slice(0,3)}/${cleaned.slice(3)}`;
      if(/^[A-Z]{3}\/[A-Z]{3}$/.test(cleaned)) return cleaned;
      return null;
    }).filter(Boolean);
  }

  function parsePair(pair){
    const m = String(pair || "").toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if(!m) return null;
    return { base: m[1], quote: m[2] };
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);
    if(Array.isArray(src)){
      return src.map((c)=>({
        o: Number(c?.open ?? c?.Open ?? c?.o ?? c?.O ?? NaN),
        h: Number(c?.high ?? c?.High ?? c?.h ?? c?.H ?? NaN),
        l: Number(c?.low ?? c?.Low ?? c?.l ?? c?.L ?? NaN),
        c: Number(c?.close ?? c?.Close ?? c?.c ?? c?.C ?? NaN)
      })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
    }
    const close = raw.close || raw.Close || raw.c || raw.C || raw.closes;
    if(Array.isArray(close)){
      return close.map((c)=>({o:Number(c),h:Number(c),l:Number(c),c:Number(c)})).filter((x)=>Number.isFinite(x.c));
    }
    return [];
  }

  function linReg(arr, window){
    const n = arr.length;
    if(n < window) return NaN;
    const slice = arr.slice(n - window, n);
    const xMean = (window - 1) / 2;
    const yMean = slice.reduce((s,v)=>s+v,0) / window;
    let num = 0, denom = 0;
    for(let i=0; i<window; i++){
      const dx = i - xMean;
      num += dx * (slice[i] - yMean);
      denom += dx * dx;
    }
    return denom === 0 ? 0 : num / denom;
  }

  function zNormalize(arr){
    if(!Array.isArray(arr) || arr.length === 0) return arr.map(()=>0);
    const vals = arr.filter(Number.isFinite);
    if(vals.length === 0) return arr.map(()=>0);
    const mean = vals.reduce((s,v)=>s+v,0) / vals.length;
    const variance = vals.reduce((s,v)=>s+(v-mean)*(v-mean),0) / vals.length;
    const std = Math.sqrt(variance);
    if(std < 1e-9) return arr.map(()=>0);
    return arr.map((v)=>Number.isFinite(v) ? (v - mean) / std : 0);
  }

  async function fetchCandles(pair, tf, count){
    const key = `${pair}_${tf}_${count}`;
    if(candleCache[key]) return candleCache[key];
    const raw = await window.LC.requestCandles(pair, tf, count);
    const candles = normalizeCandles(raw);
    candleCache[key] = candles;
    return candles;
  }

  async function computeTFMetrics(pair, tf, count){
    const candles = await fetchCandles(pair, tf, count);
    if(candles.length < 120) throw new Error("not enough candles");

    const close = candles.map((x)=>x.c);
    const high = candles.map((x)=>x.h);
    const low = candles.map((x)=>x.l);

    if(!window.UTIL?.sma || !window.UTIL?.atr) throw new Error("indicator utils missing");

    const sma20 = window.UTIL.sma(close, 20);
    const sma100 = window.UTIL.sma(close, 100);
    const atr = window.UTIL.atr(high, low, close, 14);

    const i = close.length - 1;
    const px = close[i];
    const atrNow = Number(atr[i]);
    if(!Number.isFinite(atrNow) || atrNow <= 0) throw new Error("atr unavailable");

    const atrPct = atrNow / px;
    const trendRatio = Math.abs(sma20[i] - sma100[i]) / atrNow;
    const returnPct = ((px / close[0]) - 1) * 100;

    // Quality filter
    if(atrPct < ATR_PCT_FLOOR || trendRatio < MIN_TREND_RATIO){
      return null;
    }

    // Slope normalization
    const lnClose = close.map((c)=>Math.log(c));
    const slope = linReg(lnClose, Math.min(REG_WINDOW, lnClose.length));
    const slopeNorm = slope / Math.max(atrPct, ATR_PCT_FLOOR);

    // RSI spread (per pair as proxy)
    // TODO: Current implementation uses pair RSI as a simplified proxy for base-quote currency
    // strength difference. A more accurate approach would compute per-currency RSI across all
    // pairs and calculate the actual base-quote spread. This is a known limitation.
    let rsiSpread = 0;
    if(USE_RSI && window.UTIL?.rsi){
      const rsi7 = window.UTIL.rsi(close, 7);
      const rsiVal = rsi7[i];
      if(Number.isFinite(rsiVal)){
        rsiSpread = (rsiVal - 50) / 50; // normalize to [-1, 1]
      }
    }

    return {
      pair,
      tf,
      px,
      atrNow,
      atrPct,
      trendRatio,
      returnPct,
      slopeNorm,
      rsiSpread,
      weightedReturn: returnPct / Math.max(atrPct, ATR_PCT_FLOOR)
    };
  }

  function compositeTFScore(tfMetrics, pairMetrics){
    // Composite score weights for blended mode: RSI 35%, trend 35%, return 30%
    const WEIGHT_RSI = 0.35;
    const WEIGHT_TREND_BLENDED = 0.35;
    const WEIGHT_RETURN_BLENDED = 0.30;
    // Non-RSI mode weights: slope 40%, trend 30%, return 30%
    const WEIGHT_SLOPE = 0.40;
    const WEIGHT_TREND_SIMPLE = 0.30;
    const WEIGHT_RETURN_SIMPLE = 0.30;

    // Cross-pair z-normalization for this TF
    const slopeNorms = pairMetrics.map((m)=>m.slopeNorm);
    const weightedReturns = pairMetrics.map((m)=>m.weightedReturn);
    const rsiSpreads = pairMetrics.map((m)=>m.rsiSpread);

    const slopeZ = zNormalize(slopeNorms);
    const weightedReturnZ = zNormalize(weightedReturns);
    const rsiSpreadZ = zNormalize(rsiSpreads);

    return pairMetrics.map((m, idx)=>{
      let composite;
      if(USE_RSI && COMPOSITE_MODE === "blended"){
        composite = WEIGHT_RSI * rsiSpreadZ[idx] + WEIGHT_TREND_BLENDED * m.trendRatio + WEIGHT_RETURN_BLENDED * weightedReturnZ[idx];
      } else {
        composite = WEIGHT_SLOPE * slopeZ[idx] + WEIGHT_TREND_SIMPLE * m.trendRatio + WEIGHT_RETURN_SIMPLE * weightedReturnZ[idx];
      }
      return {
        ...m,
        slopeZ: slopeZ[idx],
        weightedReturnZ: weightedReturnZ[idx],
        rsiSpreadZ: rsiSpreadZ[idx],
        compositeTF: composite
      };
    });
  }

  function blendMultiTF(pairTFMap){
    const result = {};
    
    for(const [pair, tfData] of Object.entries(pairTFMap)){
      const availableTFs = Object.keys(tfData).map(Number);
      if(availableTFs.length === 0) continue;

      // Reweight available TFs
      let totalWeight = 0;
      const weights = {};
      for(const tf of availableTFs){
        weights[tf] = TF_WEIGHTS[tf] || 0;
        totalWeight += weights[tf];
      }
      if(totalWeight === 0) continue;

      for(const tf of availableTFs){
        weights[tf] /= totalWeight;
      }

      // Blend
      let compositeBlend = 0;
      let avgAbsMove = 0;
      for(const tf of availableTFs){
        const data = tfData[tf];
        compositeBlend += weights[tf] * data.compositeTF;
        avgAbsMove += weights[tf] * Math.abs(data.weightedReturn);
      }

      result[pair] = { compositeBlend, avgAbsMove };
    }

    return result;
  }

  function scoreCurrencies(pairBlends){
    const scores = {};
    CCYS.forEach((c)=>{ scores[c] = { ccy: c, score: 0, samples: 0, absMove: 0 }; });

    for(const [pair, data] of Object.entries(pairBlends)){
      const parsed = parsePair(pair);
      if(!parsed) continue;

      scores[parsed.base].score += data.compositeBlend;
      scores[parsed.base].samples += 1;
      scores[parsed.base].absMove += data.avgAbsMove;

      scores[parsed.quote].score -= data.compositeBlend;
      scores[parsed.quote].samples += 1;
      scores[parsed.quote].absMove += data.avgAbsMove;
    }

    return Object.values(scores)
      .filter((r)=>r.samples > 0)
      .map((r)=>({ ...r, avgScore: r.score / r.samples, avgAbsMove: r.absMove / r.samples }))
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

    host.innerHTML = `<h3>Best Pairs (Top 3 vs Bottom 3):</h3>` + 
      ideas.map((x)=>`<div class="pairIdea"><strong>${x.pair}</strong> · <span class="str-up">${x.bias}</span> · spread ${x.spread.toFixed(3)}</div>`).join("");
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
    candleCache = {}; // Clear cache on each run

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

      window.LC.setStatus("Scanning strength (multi-TF)…", "warn");
      window.LC.log(`▶ Strength scan started (${pairs.length} pairs, multi-TF).`);

      // Fetch all TF metrics for all pairs
      const TFs = [300, 900, 3600];
      const pairTFMap = {};

      for(const pair of pairs){
        pairTFMap[pair] = {};
        for(const tf of TFs){
          try{
            const metrics = await computeTFMetrics(pair, tf, TF_COUNTS[tf]);
            if(metrics){
              pairTFMap[pair][tf] = metrics;
            }
          }catch(e){
            // TF failed for this pair, skip
          }
        }
      }

      // Compute composite scores per TF
      for(const tf of TFs){
        const tfPairs = [];
        for(const pair of pairs){
          if(pairTFMap[pair][tf]){
            tfPairs.push(pairTFMap[pair][tf]);
          }
        }
        if(tfPairs.length > 0){
          const scored = compositeTFScore(null, tfPairs);
          scored.forEach((s)=>{
            if(pairTFMap[s.pair][s.tf]){
              pairTFMap[s.pair][s.tf] = s;
            }
          });
        }
      }

      // Blend multi-TF
      const pairBlends = blendMultiTF(pairTFMap);
      if(Object.keys(pairBlends).length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid data after quality filters.");
        $("strengthStatus").textContent = "No data after quality filters.";
        $("strengthTable").innerHTML = "";
        $("strengthBestPairs").textContent = "No ideas available.";
        return;
      }

      // Score currencies
      const ranked = scoreCurrencies(pairBlends);
      lastRanked = ranked;
      lastPairs = Object.keys(pairBlends);
      renderTable(ranked);
      renderBestPairs(ranked);

      const strongest = ranked[0]?.ccy || "n/a";
      const weakest = ranked[ranked.length - 1]?.ccy || "n/a";

      const autoTag = autoIntervalSec ? ` · auto ${autoIntervalSec}s` : "";
      $("strengthStatus").textContent = `Updated: ${new Date().toLocaleString()} · strongest ${strongest}, weakest ${weakest} · pairs ${lastPairs.length}${autoTag}`;
      window.LC.log(`✅ Strength scan done. Strongest: ${strongest}, weakest: ${weakest}.`);
      window.LC.setStatus("Strength done", "ok");
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
