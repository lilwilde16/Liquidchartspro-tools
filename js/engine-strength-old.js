(function(){
  const $ = (id)=>document.getElementById(id);
  const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];

  let autoTimer = null;
  let autoIntervalSec = null;
  let isRunning = false;
  let lastRanked = [];
  let lastPairs = [];

  function parsePairs(){
    const raw = ($("pairs")?.value || "").split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
    return raw.filter((p)=>/^[A-Z]{3}\/[A-Z]{3}$/.test(p.toUpperCase())).map((p)=>p.toUpperCase());
  }

  function parsePair(pair){
    const m = String(pair || "").toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if(!m) return null;
    return { base: m[1], quote: m[2] };
  }

  function normalizeCloses(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);
    if(Array.isArray(src)) return src.map((c)=>Number(c?.close ?? c?.Close ?? c?.c ?? c?.C ?? c)).filter(Number.isFinite);

    const close = raw.close || raw.Close || raw.c || raw.C || raw.closes;
    if(Array.isArray(close)) return close.map(Number).filter(Number.isFinite);
    return [];
  }

  async function fetchPairReturn(pair, timeframe, count){
    const candles = await window.LC.requestCandles(pair, timeframe, count);
    const closes = normalizeCloses(candles);
    if(closes.length < 5) throw new Error("not enough candles");

    const first = closes[0];
    const last = closes[closes.length - 1];
    if(!Number.isFinite(first) || !Number.isFinite(last) || first === 0) throw new Error("invalid close series");

    const changePct = ((last - first) / first) * 100;
    return { pair, changePct, candles: closes.length };
  }

  function scoreCurrencies(pairReturns){
    const scores = {};
    CCYS.forEach((c)=>{ scores[c] = { ccy: c, score: 0, samples: 0, absMove: 0 }; });

    for(const r of pairReturns){
      const parsed = parsePair(r.pair);
      if(!parsed) continue;

      scores[parsed.base].score += r.changePct;
      scores[parsed.base].samples += 1;
      scores[parsed.base].absMove += Math.abs(r.changePct);

      scores[parsed.quote].score -= r.changePct;
      scores[parsed.quote].samples += 1;
      scores[parsed.quote].absMove += Math.abs(r.changePct);
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
        <td class="${cls}">${r.avgScore.toFixed(3)}%</td>
        <td>${r.avgAbsMove.toFixed(3)}%</td>
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
      ideas.push({ pair: `${base}/${quote}`, bias: "Buy bias", spread: strongest[i].avgScore - weakest[i].avgScore });
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

    const timeframe = Number($("strengthTf")?.value || 900);
    const count = Number($("strengthCount")?.value || 500);
    const pairs = parsePairs();

    try{
      if(!window.LC?.requestCandles){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: Candles API unavailable.");
        $("strengthStatus").textContent = "Candles API unavailable.";
        return;
      }

      if(pairs.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no valid pairs in settings.");
        $("strengthStatus").textContent = "No valid pairs configured.";
        return;
      }

      window.LC.setStatus("Scanning strength…", "warn");
      window.LC.log(`▶ Strength scan started (${pairs.length} pairs, tf=${timeframe}, candles=${count}).`);

      const settled = await Promise.allSettled(pairs.map((p)=>fetchPairReturn(p, timeframe, count)));
      const ok = settled.filter((r)=>r.status === "fulfilled").map((r)=>r.value);
      const bad = settled.filter((r)=>r.status === "rejected");

      if(ok.length === 0){
        window.LC.setStatus("Strength error", "bad");
        window.LC.log("❌ Strength scan failed: no pair data returned.");
        $("strengthStatus").textContent = "No data returned for selected pairs/timeframe.";
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
      $("strengthStatus").textContent = `Updated: ${new Date().toLocaleString()} · strongest ${strongest}, weakest ${weakest} · pairs ok ${ok.length}/${pairs.length}${autoTag}`;
      if(bad.length > 0) window.LC.log(`⚠ Strength scan partial data: ${bad.length} pair(s) failed.`);
      window.LC.log(`✅ Strength scan done. Strongest: ${strongest}, weakest: ${weakest}.`);
      window.LC.setStatus(bad.length ? "Strength done (partial)" : "Strength done", bad.length ? "warn" : "ok");
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
