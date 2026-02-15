(function(){
  const $ = (id)=>document.getElementById(id);

  const state = {
    timer: null,
    running: false,
    lastTradeAt: 0,
    dayKey: "",
    tradesToday: 0
  };

  function toNum(v, fallback){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function parsePairs(){
    return ($("pairs")?.value || "")
      .split(/\r?\n/)
      .map((s)=>s.trim().toUpperCase())
      .filter((p)=>/^[A-Z]{3}\/[A-Z]{3}$/.test(p));
  }

  function parsePair(pair){
    const m = String(pair || "").toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
    if(!m) return null;
    return { base: m[1], quote: m[2] };
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || []);
    return src.map((c)=>(
      {
        o: Number(c?.open ?? c?.Open ?? c?.o),
        h: Number(c?.high ?? c?.High ?? c?.h),
        l: Number(c?.low ?? c?.Low ?? c?.l),
        c: Number(c?.close ?? c?.Close ?? c?.c)
      }
    )).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
  }

  function cfg(){
    return {
      tf: $("atTf")?.value || "M15",
      candles: Math.max(200, Math.min(3000, Math.floor(toNum($("atCandles")?.value, 500)))),
      intervalSec: Math.max(30, Math.min(3600, Math.floor(toNum($("atPollSec")?.value, 120)))),
      riskMode: $("atRiskMode")?.value || "conservative",
      lots: toNum($("atLots")?.value, 0.01),
      rr: toNum($("atRr")?.value, 1.5),
      slAtr: toNum($("atSlAtr")?.value, 1.1),
      useSchedule: ($("atUseSchedule")?.value || "yes") === "yes",
      startHour: Math.floor(toNum($("atStartHour")?.value, 6)),
      endHour: Math.floor(toNum($("atEndHour")?.value, 20)),
      maxTradesPerDay: Math.max(1, Math.min(20, Math.floor(toNum($("atMaxTradesDay")?.value, 4)))),
      cooldownMin: Math.max(1, Math.min(240, Math.floor(toNum($("atCooldownMin")?.value, 45))))
    };
  }

  function withinSchedule(c){
    if(!c.useSchedule) return true;
    const now = new Date();
    const day = now.getUTCDay();
    if(day === 0 || day === 6) return false;
    const h = now.getUTCHours();
    if(c.startHour <= c.endHour) return h >= c.startHour && h <= c.endHour;
    return h >= c.startHour || h <= c.endHour;
  }

  function refreshDayCounter(){
    const now = new Date();
    const key = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}`;
    if(state.dayKey !== key){
      state.dayKey = key;
      state.tradesToday = 0;
    }
  }

  function pickPairByStrength(pairs){
    const snap = window.ENG?.Strength?.getSnapshot?.();
    const ranked = snap?.ranked || [];
    if(ranked.length < 2 || pairs.length === 0) return pairs[0] || null;

    const top = new Set(ranked.slice(0, 3).map((x)=>x.ccy));
    const bottom = new Set(ranked.slice(-3).map((x)=>x.ccy));

    let best = null;
    let bestScore = -1;

    for(const p of pairs){
      const parts = parsePair(p);
      if(!parts) continue;
      let score = 0;
      if(top.has(parts.base) && bottom.has(parts.quote)) score = 3;
      if(top.has(parts.quote) && bottom.has(parts.base)) score = 2;
      if(top.has(parts.base) || bottom.has(parts.quote)) score = Math.max(score, 1);
      if(score > bestScore){
        best = p;
        bestScore = score;
      }
    }
    return best || pairs[0] || null;
  }

  function detectSignal(candles){
    if(candles.length < 220 || !window.UTIL?.sma || !window.UTIL?.atr) return { dir: 0, why: "insufficient data" };

    const close = candles.map((x)=>x.c);
    const high = candles.map((x)=>x.h);
    const low = candles.map((x)=>x.l);
    const open = candles.map((x)=>x.o);
    const fast = window.UTIL.sma(close, 20);
    const slow = window.UTIL.sma(close, 100);
    const atr = window.UTIL.atr(high, low, close, 14);

    const i = close.length - 1;
    if(!Number.isFinite(fast[i]) || !Number.isFinite(slow[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0){
      return { dir: 0, why: "indicators unavailable" };
    }

    const lookback = 30;
    const swingHigh = Math.max(...high.slice(i - lookback, i));
    const swingLow = Math.min(...low.slice(i - lookback, i));
    const px = close[i];
    const atrNow = atr[i];

    const trendUp = fast[i] > slow[i];
    const trendDown = fast[i] < slow[i];
    const zoneBuf = atrNow * 0.25;

    const nearDemand = px <= (swingLow + zoneBuf);
    const nearSupply = px >= (swingHigh - zoneBuf);

    const bullishRejection = close[i] > open[i] && low[i] <= swingLow + zoneBuf;
    const bearishRejection = close[i] < open[i] && high[i] >= swingHigh - zoneBuf;

    const trendRatio = Math.abs(fast[i] - slow[i]) / atrNow;
    if(trendRatio < 0.35) return { dir: 0, why: "consolidation filter" };

    if(trendUp && nearDemand && bullishRejection) return { dir: 1, why: "demand-zone trend continuation", atr: atrNow };
    if(trendDown && nearSupply && bearishRejection) return { dir: -1, why: "supply-zone trend continuation", atr: atrNow };
    return { dir: 0, why: "no zone confirmation", atr: atrNow };
  }

  function strengthAllows(pair, dir){
    const parts = parsePair(pair);
    const snap = window.ENG?.Strength?.getSnapshot?.();
    const ranked = snap?.ranked || [];
    if(!parts || ranked.length < 4) return true;

    const top = new Set(ranked.slice(0, 3).map((x)=>x.ccy));
    const bottom = new Set(ranked.slice(-3).map((x)=>x.ccy));
    if(dir === 1) return top.has(parts.base) && bottom.has(parts.quote);
    if(dir === -1) return top.has(parts.quote) && bottom.has(parts.base);
    return false;
  }

  async function placeTrade(pair, dir, c, atrNow){
    const side = dir === 1 ? "BUY" : "SELL";
    const slDistance = atrNow * c.slAtr;
    const tpDistance = slDistance * c.rr;

    if(!(window.LC?.api?.sendMarketOrderWithTPSL)) throw new Error("LC.api.sendMarketOrderWithTPSL missing");

    await window.LC.api.sendMarketOrderWithTPSL(pair, dir === 1, c.lots, tpDistance, slDistance);
    state.lastTradeAt = Date.now();
    state.tradesToday += 1;
    window.LC.log(`🤖 AutoTrader ${side} ${pair} sent | TP=${tpDistance.toFixed(5)} SL=${slDistance.toFixed(5)}`);
  }

  async function runCycle(){
    if(!state.running) return;
    const c = cfg();
    refreshDayCounter();

    if(!withinSchedule(c)){
      if($("atStatus")) $("atStatus").textContent = "Idle: outside Mon-Fri schedule window.";
      return;
    }

    if(state.tradesToday >= c.maxTradesPerDay){
      if($("atStatus")) $("atStatus").textContent = `Idle: max trades/day reached (${state.tradesToday}/${c.maxTradesPerDay}).`;
      return;
    }

    if(Date.now() - state.lastTradeAt < (c.cooldownMin * 60000)){
      if($("atStatus")) $("atStatus").textContent = "Idle: cooldown active.";
      return;
    }

    const pairs = parsePairs();
    if(pairs.length === 0){
      if($("atStatus")) $("atStatus").textContent = "No valid pairs in Settings.";
      return;
    }

    if(window.ENG?.Strength?.run) await window.ENG.Strength.run();

    const pair = pickPairByStrength(pairs);
    if(!pair){
      if($("atStatus")) $("atStatus").textContent = "No pair selected.";
      return;
    }

    const raw = await window.LC.requestCandles(pair, c.tf, c.candles);
    const candles = normalizeCandles(raw);
    const sig = detectSignal(candles);

    if(sig.dir === 0){
      if($("atStatus")) $("atStatus").textContent = `Watching ${pair}: ${sig.why}.`;
      return;
    }

    if(!strengthAllows(pair, sig.dir)){
      if($("atStatus")) $("atStatus").textContent = `Filtered ${pair}: strength mismatch.`;
      return;
    }

    await placeTrade(pair, sig.dir, c, sig.atr || 0);
    if($("atStatus")) $("atStatus").textContent = `Trade sent on ${pair}. Trades today ${state.tradesToday}/${c.maxTradesPerDay}.`;
  }

  function start(){
    if(state.running) return;
    if(!window.LC?.requestCandles){
      window.LC.log("❌ AutoTrader cannot start: candles API unavailable.");
      return;
    }
    state.running = true;
    refreshDayCounter();
    const c = cfg();
    state.timer = setInterval(()=>{
      runCycle().catch((e)=>window.LC.log(`❌ AutoTrader cycle failed: ${e?.message || e}`));
    }, c.intervalSec * 1000);
    window.LC.log(`🤖 AutoTrader started (${c.intervalSec}s cycle).`);
    runCycle().catch((e)=>window.LC.log(`❌ AutoTrader cycle failed: ${e?.message || e}`));
  }

  function stop(){
    if(state.timer) clearInterval(state.timer);
    state.timer = null;
    state.running = false;
    if($("atStatus")) $("atStatus").textContent = "Stopped.";
    window.LC.log("🛑 AutoTrader stopped.");
  }

  function init(){
    if($("btnAutoStart")) $("btnAutoStart").onclick = start;
    if($("btnAutoStop")) $("btnAutoStop").onclick = stop;
  }

  window.ENG = window.ENG || {};
  window.ENG.AutoTrader = { start, stop, init, runCycle };
})();
