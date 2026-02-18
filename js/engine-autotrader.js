(function(){
  const $ = (id)=>document.getElementById(id);
  const MEM_KEY = "lc.autoTrader.memory.v2";

  const state = {
    timer: null,
    running: false,
    cycling: false,
    lastTradeAt: 0,
    dayKey: "",
    tradesToday: 0,
    memory: loadMemory()
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
      volStart: Math.floor(toNum($("atVolStart")?.value, 12)),
      volEnd: Math.floor(toNum($("atVolEnd")?.value, 16)),
      maxTradesPerDay: Math.max(1, Math.min(20, Math.floor(toNum($("atMaxTradesDay")?.value, 4)))),
      cooldownMin: Math.max(1, Math.min(240, Math.floor(toNum($("atCooldownMin")?.value, 45)))),
      learning: ($("atLearning")?.value || "on") === "on",
      minConfidence: Math.max(0.4, Math.min(0.9, toNum($("atMinConfidence")?.value, 0.58)))
    };
  }

  function inHourRange(h, startH, endH){
    if(startH <= endH) return h >= startH && h <= endH;
    return h >= startH || h <= endH;
  }

  function withinSchedule(c){
    if(!c.useSchedule) return true;
    const now = new Date();
    const day = now.getUTCDay();
    if(day === 0 || day === 6) return false;
    return inHourRange(now.getUTCHours(), c.startHour, c.endHour);
  }

  function inVolatileWindow(c){
    const h = new Date().getUTCHours();
    return inHourRange(h, c.volStart, c.volEnd);
  }

  function refreshDayCounter(){
    const now = new Date();
    const key = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}`;
    if(state.dayKey !== key){
      state.dayKey = key;
      state.tradesToday = 0;
    }
  }

  function loadMemory(){
    try{
      const raw = window.localStorage.getItem(MEM_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if(parsed && typeof parsed === "object") return parsed;
    }catch(_){ }
    return { byPair: {}, totalSignals: 0, totalWins: 0, totalLosses: 0 };
  }

  function saveMemory(){
    try{ window.localStorage.setItem(MEM_KEY, JSON.stringify(state.memory)); }catch(_){ }
  }

  function pairStats(pair){
    if(!state.memory.byPair[pair]) state.memory.byPair[pair] = { wins: 0, losses: 0, skips: 0 };
    return state.memory.byPair[pair];
  }

  function pairLearningScore(pair){
    const s = pairStats(pair);
    const n = s.wins + s.losses;
    if(n === 0) return 0.5;
    return (s.wins + 1) / (n + 2);
  }

  function strengthBias(pair){
    const snap = window.ENG?.Strength?.getSnapshot?.();
    const ranked = snap?.ranked || [];
    const parts = parsePair(pair);
    if(!parts || ranked.length < 2) return { score: 0, side: 0 };

    const map = Object.fromEntries(ranked.map((x)=>[x.ccy, x.avgScore]));
    const baseScore = Number(map[parts.base] || 0);
    const quoteScore = Number(map[parts.quote] || 0);
    const spread = baseScore - quoteScore;

    // Dynamic scaling based on actual score range
    const scores = ranked.map((x)=>x.avgScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scale = Math.max(0.001, maxScore - minScore);
    
    const normalized = spread / scale;
    const score = Math.max(-1, Math.min(1, normalized));
    const side = spread >= 0 ? 1 : -1;

    return { score, side, spread };
  }

  async function pairMetrics(pair, c){
    const raw = await window.LC.requestCandles(pair, c.tf, c.candles);
    const candles = normalizeCandles(raw);
    if(candles.length < 220) throw new Error("not enough candles");

    const close = candles.map((x)=>x.c);
    const high = candles.map((x)=>x.h);
    const low = candles.map((x)=>x.l);
    const open = candles.map((x)=>x.o);
    if(!window.UTIL?.sma || !window.UTIL?.atr) throw new Error("indicator utils missing");

    const fast = window.UTIL.sma(close, 20);
    const slow = window.UTIL.sma(close, 100);
    const atr = window.UTIL.atr(high, low, close, 14);
    const i = close.length - 1;

    const atrNow = Number(atr[i]);
    if(!Number.isFinite(atrNow) || atrNow <= 0) throw new Error("atr unavailable");

    const trendRatio = Math.abs(fast[i] - slow[i]) / atrNow;
    const atrPct = atrNow / close[i];

    const lookback = 30;
    const swingHigh = Math.max(...high.slice(i - lookback, i));
    const swingLow = Math.min(...low.slice(i - lookback, i));
    const zoneBuf = atrNow * 0.25;

    const nearDemand = close[i] <= (swingLow + zoneBuf);
    const nearSupply = close[i] >= (swingHigh - zoneBuf);
    const bullishRejection = close[i] > open[i] && low[i] <= swingLow + zoneBuf;
    const bearishRejection = close[i] < open[i] && high[i] >= swingHigh - zoneBuf;

    const trendUp = fast[i] > slow[i];
    const trendDown = fast[i] < slow[i];

    let dir = 0;
    if(trendUp && nearDemand && bullishRejection) dir = 1;
    else if(trendDown && nearSupply && bearishRejection) dir = -1;

    const momentum = Math.abs(close[i] - close[i - 8]) / atrNow;
    const volScore = Math.min(1, Math.max(0, (atrPct - 0.0005) / 0.004));
    const sharpScore = Math.min(1, Math.max(0, (trendRatio - 0.25) / 1.5));

    return {
      pair,
      dir,
      atrNow,
      atrPct,
      trendRatio,
      momentum,
      volScore,
      sharpScore,
      close: close[i]
    };
  }

  function scoreCandidate(m, c){
    if(m.dir === 0) return { confidence: 0, reason: "no zone rejection" };
    if(m.trendRatio < 0.35) return { confidence: 0, reason: "consolidation filter" };

    const sb = strengthBias(m.pair);
    if((m.dir === 1 && sb.side < 0) || (m.dir === -1 && sb.side > 0)) return { confidence: 0, reason: "strength mismatch" };

    const learn = c.learning ? pairLearningScore(m.pair) : 0.5;
    const volaBoost = inVolatileWindow(c) ? 0.08 : -0.04;

    const confidence =
      (0.30 * m.volScore) +
      (0.30 * m.sharpScore) +
      (0.20 * Math.min(1, Math.max(0, Math.abs(sb.score)))) +
      (0.20 * learn) +
      volaBoost;

    return {
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: `vol=${m.volScore.toFixed(2)} sharp=${m.sharpScore.toFixed(2)} strength=${Math.abs(sb.score).toFixed(2)} learn=${learn.toFixed(2)}`,
      strengthSpread: sb.spread || 0
    };
  }

  async function scanAllPairs(pairs, c){
    const settled = await Promise.allSettled(pairs.map(async (pair)=>{
      const m = await pairMetrics(pair, c);
      const s = scoreCandidate(m, c);
      return { ...m, ...s };
    }));

    return settled
      .filter((x)=>x.status === "fulfilled")
      .map((x)=>x.value)
      .sort((a, b)=>b.confidence - a.confidence);
  }

  async function placeTrade(candidate, c){
    const side = candidate.dir === 1 ? "BUY" : "SELL";
    const riskMult = c.riskMode === "conservative" ? 0.9 : 1.05;
    const slDistance = candidate.atrNow * c.slAtr * riskMult;
    const tpDistance = slDistance * c.rr;

    await window.LC.api.sendMarketOrderWithTPSL(candidate.pair, candidate.dir === 1, c.lots, tpDistance, slDistance);

    state.lastTradeAt = Date.now();
    state.tradesToday += 1;
    state.memory.totalSignals += 1;
    saveMemory();

    window.LC.log(`🤖 AutoTrader ${side} ${candidate.pair} | conf=${candidate.confidence.toFixed(2)} | TP=${tpDistance.toFixed(5)} SL=${slDistance.toFixed(5)}`);
  }

  function updateLearningFromOpenTrades(){
    try{
      const orders = window.LC?.Framework?.Orders?._dict || {};
      for(const k of Object.keys(orders)){
        const o = orders[k];
        const pair = String(o.instrumentId || "").toUpperCase();
        if(!pair || !/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) continue;
        const st = pairStats(pair);
        const pnl = Number(o.pnl ?? o.profitLoss ?? NaN);
        if(Number.isFinite(pnl)){
          if(pnl > 0) st.wins += 1;
          if(pnl < 0) st.losses += 1;
        }
      }
      saveMemory();
    }catch(_){ }
  }

  async function runCycle(){
    if(!state.running || state.cycling) return;
    state.cycling = true;
    const c = cfg();

    try{
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
      updateLearningFromOpenTrades();

      const scored = await scanAllPairs(pairs, c);
      if(scored.length === 0){
        if($("atStatus")) $("atStatus").textContent = "No valid pair metrics available.";
        return;
      }

      const best = scored[0];
      if(best.confidence < c.minConfidence){
        if($("atStatus")) $("atStatus").textContent = `Watching ${best.pair}: confidence ${best.confidence.toFixed(2)} below ${c.minConfidence.toFixed(2)}.`;
        return;
      }

      await placeTrade(best, c);
      if($("atStatus")) $("atStatus").textContent = `Trade sent ${best.pair} | confidence ${best.confidence.toFixed(2)} | today ${state.tradesToday}/${c.maxTradesPerDay}`;
    }catch(e){
      window.LC.log(`❌ AutoTrader cycle failed: ${e?.message || e}`);
      if($("atStatus")) $("atStatus").textContent = "Cycle failed. Check log.";
    } finally {
      state.cycling = false;
    }
  }

  function start(){
    if(state.running) return;
    if(!window.LC?.requestCandles || !window.LC?.api?.sendMarketOrderWithTPSL){
      window.LC.log("❌ AutoTrader cannot start: required APIs unavailable.");
      return;
    }
    state.running = true;
    refreshDayCounter();
    const c = cfg();
    state.timer = setInterval(runCycle, c.intervalSec * 1000);
    window.LC.log(`🤖 AutoTrader started (${c.intervalSec}s cycle, learning=${c.learning?"on":"off"}).`);
    runCycle();
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
