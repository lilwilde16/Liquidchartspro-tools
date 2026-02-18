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
    memory: loadMemory(),
    pairLastTrade: {},
    consecutiveLosses: 0,
    minConfBoost: 0,
    strengthHistory: []
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

  function getSessionConfidence(){
    const h = new Date().getUTCHours();
    // London: 7-16 UTC, NY: 12-21 UTC, Overlap: 12-16 UTC
    if(h >= 12 && h <= 16) return 0.60; // NY overlap
    if(h >= 7 && h < 12) return 0.62; // London only
    if(h > 16 && h <= 21) return 0.62; // NY only
    return 0.66; // Other times
  }

  function refreshDayCounter(){
    const now = new Date();
    const key = `${now.getUTCFullYear()}-${now.getUTCMonth()+1}-${now.getUTCDate()}`;
    if(state.dayKey !== key){
      state.dayKey = key;
      state.tradesToday = 0;
      state.consecutiveLosses = 0;
      state.minConfBoost = 0;
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
    if(!state.memory.byPair[pair]) state.memory.byPair[pair] = { wins: 0, losses: 0, skips: 0, lastTradeAt: 0 };
    return state.memory.byPair[pair];
  }

  function pairLearningScore(pair, c){
    if(!c.learning) return 0.5;
    const s = pairStats(pair);
    const alpha = 0.3; // EWMA decay
    const n = s.wins + s.losses;
    if(n === 0) return 0.5;
    const hitRate = s.wins / n;
    return hitRate * (1 - alpha) + 0.5 * alpha;
  }

  function strengthBias(pair){
    const snap = window.ENG?.Strength?.getSnapshot?.();
    const ranked = snap?.ranked || [];
    const parts = parsePair(pair);
    if(!parts || ranked.length < 2) return { score: 0, side: 0, spread: 0 };

    const scores = ranked.map((x)=>x.avgScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const scale = Math.max(0.001, maxScore - minScore);

    const map = Object.fromEntries(ranked.map((x)=>[x.ccy, x.avgScore]));
    const b = Number(map[parts.base] || 0);
    const q = Number(map[parts.quote] || 0);
    const spread = b - q;
    const normalized = Math.max(-1, Math.min(1, spread / scale));

    return {
      score: normalized,
      side: spread >= 0 ? 1 : -1,
      spread
    };
  }

  function checkStrengthStability(pair, minStability = 0.40){
    // Check if strength has been consistent over last N snapshots
    const history = state.strengthHistory.slice(-2); // Last 2 snapshots
    if(history.length < 2) return false;

    const parts = parsePair(pair);
    if(!parts) return false;

    const spreads = history.map((snap)=>{
      const ranked = snap.ranked || [];
      const map = Object.fromEntries(ranked.map((x)=>[x.ccy, x.avgScore]));
      const b = Number(map[parts.base] || 0);
      const q = Number(map[parts.quote] || 0);
      return b - q;
    });

    // Check if all spreads have same sign and magnitude > minStability
    const allPositive = spreads.every((s)=>s >= minStability);
    const allNegative = spreads.every((s)=>s <= -minStability);
    return allPositive || allNegative;
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

    // M5 RSI for entry timing
    let rsiM5 = null;
    if(window.UTIL?.rsi){
      const rsiM5Raw = await window.LC.requestCandles(pair, 300, 100);
      const candlesM5 = normalizeCandles(rsiM5Raw);
      if(candlesM5.length >= 20){
        const closeM5 = candlesM5.map((x)=>x.c);
        const rsi7M5 = window.UTIL.rsi(closeM5, 7);
        rsiM5 = rsi7M5[rsi7M5.length - 1];
      }
    }

    // H1 trend confirmation
    let h1TrendRatio = null, rsiH1 = null;
    try{
      const rawH1 = await window.LC.requestCandles(pair, 3600, 150);
      const candlesH1 = normalizeCandles(rawH1);
      if(candlesH1.length >= 120){
        const closeH1 = candlesH1.map((x)=>x.c);
        const highH1 = candlesH1.map((x)=>x.h);
        const lowH1 = candlesH1.map((x)=>x.l);
        const fastH1 = window.UTIL.sma(closeH1, 20);
        const slowH1 = window.UTIL.sma(closeH1, 100);
        const atrH1 = window.UTIL.atr(highH1, lowH1, closeH1, 14);
        const iH1 = closeH1.length - 1;
        const atrH1Now = Number(atrH1[iH1]);
        if(Number.isFinite(atrH1Now) && atrH1Now > 0){
          h1TrendRatio = Math.abs(fastH1[iH1] - slowH1[iH1]) / atrH1Now;
        }
        if(window.UTIL?.rsi){
          const rsi7H1 = window.UTIL.rsi(closeH1, 7);
          rsiH1 = rsi7H1[rsi7H1.length - 1];
        }
      }
    }catch(e){
      // H1 data unavailable
    }

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
      h1TrendRatio,
      momentum,
      volScore,
      sharpScore,
      close: close[i],
      rsiM5,
      rsiH1,
      trendUp,
      trendDown
    };
  }

  // Spread thresholds
  const JPY_FALLBACK_SPREAD = 0.03;       // Fallback spread for JPY pairs when market data unavailable
  const STANDARD_FALLBACK_SPREAD = 0.0003; // Fallback spread for standard pairs
  const JPY_SPREAD_THRESHOLD = 0.04;       // Max acceptable spread for JPY pairs
  const STANDARD_SPREAD_THRESHOLD = 0.0004; // Max acceptable spread for standard pairs

  function getSpread(pair){
    try{
      const market = window.LC?.Framework?.Instruments?.getOrBlank?.(pair);
      if(market && Number.isFinite(market.bid) && Number.isFinite(market.ask)){
        return market.ask - market.bid;
      }
    }catch(_){}
    // Fallback pip caps by pair type
    if(pair.includes("JPY")) return JPY_FALLBACK_SPREAD;
    return STANDARD_FALLBACK_SPREAD;
  }

  // Confidence formula weights
  const CONF_WEIGHT_VOL = 0.25;       // Volatility score weight
  const CONF_WEIGHT_SHARP = 0.25;     // Sharpness/trend ratio weight
  const CONF_WEIGHT_STRENGTH = 0.25;  // Currency strength weight
  const CONF_WEIGHT_REGIME = 0.12;    // H1 trend confirmation weight
  const CONF_WEIGHT_SPREAD_PEN = 0.10; // Spread penalty weight
  const CONF_WEIGHT_LEARNING = 0.23;  // Learning/hit rate weight

  function scoreCandidate(m, c){
    if(m.dir === 0) return { confidence: 0, reason: "no zone rejection" };
    
    // ATR% entry floor
    if(m.atrPct < 0.0008) return { confidence: 0, reason: "ATR too low" };
    
    // Trend ratio M15 filter
    if(m.trendRatio < 0.40) return { confidence: 0, reason: "consolidation filter" };

    const sb = strengthBias(m.pair);
    
    // Strength spread gating
    const absSpread = Math.abs(sb.spread);
    if(absSpread < 0.40) return { confidence: 0, reason: "strength spread too low" };
    
    // Strength stability check
    if(!checkStrengthStability(m.pair, 0.40)){
      return { confidence: 0, reason: "strength unstable" };
    }

    // Direction match with strength
    if((m.dir === 1 && sb.side < 0) || (m.dir === -1 && sb.side > 0)){
      return { confidence: 0, reason: "strength mismatch" };
    }

    // H1 trend confirmation
    if(m.h1TrendRatio !== null){
      if(m.h1TrendRatio < 0.30) return { confidence: 0, reason: "H1 consolidation" };
      
      // Forbid entries against H1 trend unless strength spread very strong
      if(m.dir === 1 && !m.trendUp && absSpread < 0.65){
        return { confidence: 0, reason: "against H1 trend (weak strength)" };
      }
      if(m.dir === -1 && !m.trendDown && absSpread < 0.65){
        return { confidence: 0, reason: "against H1 trend (weak strength)" };
      }
    }

    // RSI filters
    if(Number.isFinite(m.rsiM5)){
      if(m.dir === 1 && m.rsiM5 <= 55) return { confidence: 0, reason: "M5 RSI too low for long" };
      if(m.dir === -1 && m.rsiM5 >= 45) return { confidence: 0, reason: "M5 RSI too high for short" };
    }
    if(Number.isFinite(m.rsiH1)){
      if(m.dir === 1 && m.rsiH1 <= 50) return { confidence: 0, reason: "H1 RSI too low for long" };
      if(m.dir === -1 && m.rsiH1 >= 50) return { confidence: 0, reason: "H1 RSI too high for short" };
    }

    // Spread filtering
    const spreadNow = getSpread(m.pair);
    const spreadThreshold = m.pair.includes("JPY") ? JPY_SPREAD_THRESHOLD : STANDARD_SPREAD_THRESHOLD;
    if(spreadNow > spreadThreshold) return { confidence: 0, reason: "spread too high" };

    const learn = pairLearningScore(m.pair, c);
    
    // Regime confirm bonus
    const regimeConfirm = (m.h1TrendRatio !== null && m.h1TrendRatio >= 0.30) ? 0.15 : 0;
    
    // Spread penalty (normalized spread cost)
    const spreadPenalty = Math.min(0.2, spreadNow / 0.001);

    // Confidence formula with documented weights
    const confidence =
      (CONF_WEIGHT_VOL * m.volScore) +
      (CONF_WEIGHT_SHARP * m.sharpScore) +
      (CONF_WEIGHT_STRENGTH * Math.min(1, Math.max(0, Math.abs(sb.score)))) +
      (CONF_WEIGHT_REGIME * regimeConfirm) -
      (CONF_WEIGHT_SPREAD_PEN * spreadPenalty) +
      (CONF_WEIGHT_LEARNING * learn);

    return {
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: `vol=${m.volScore.toFixed(2)} sharp=${m.sharpScore.toFixed(2)} strength=${Math.abs(sb.score).toFixed(2)} regime=${regimeConfirm.toFixed(2)} learn=${learn.toFixed(2)}`,
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
    const pStats = pairStats(candidate.pair);
    pStats.lastTradeAt = Date.now();
    state.pairLastTrade[candidate.pair] = Date.now();
    state.memory.totalSignals += 1;
    saveMemory();

    window.LC.log(`🤖 AutoTrader ${side} ${candidate.pair} | conf=${candidate.confidence.toFixed(2)} | TP=${tpDistance.toFixed(5)} SL=${slDistance.toFixed(5)}`);
    
    // TODO: Implement partial TP and trailing stops via order monitoring
    // This requires tracking open orders and modifying them based on price movement:
    // - Close 50% at 1R profit
    // - Trail remaining 50% with ATR 0.9×
    // - Move SL to breakeven at 0.8R using LC.api.changeOrderTPSL if available
    // Issue: https://github.com/lilwilde16/Liquidchartspro-tools/issues/XXX
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
          if(pnl > 0){
            st.wins += 1;
            state.memory.totalWins += 1;
            state.consecutiveLosses = 0;
          }
          if(pnl < 0){
            st.losses += 1;
            state.memory.totalLosses += 1;
            state.consecutiveLosses += 1;
            if(state.consecutiveLosses >= 2){
              state.minConfBoost = 0.05;
            }
          }
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

      // Global cooldown
      if(Date.now() - state.lastTradeAt < (c.cooldownMin * 60000)){
        if($("atStatus")) $("atStatus").textContent = "Idle: global cooldown active.";
        return;
      }

      const pairs = parsePairs();
      if(pairs.length === 0){
        if($("atStatus")) $("atStatus").textContent = "No valid pairs in Settings.";
        return;
      }

      // Refresh strength and store snapshot for stability checking
      if(window.ENG?.Strength?.run) await window.ENG.Strength.run();
      const strengthSnap = window.ENG?.Strength?.getSnapshot?.();
      if(strengthSnap){
        state.strengthHistory.push(strengthSnap);
        if(state.strengthHistory.length > 5) state.strengthHistory.shift();
      }

      updateLearningFromOpenTrades();

      const scored = await scanAllPairs(pairs, c);
      if(scored.length === 0){
        if($("atStatus")) $("atStatus").textContent = "No valid pair metrics available.";
        return;
      }

      // Filter out pairs that traded recently (per-pair cooldown 60 min)
      const pairCooldownMs = 60 * 60000;
      const eligible = scored.filter((cand)=>{
        const lastTrade = state.pairLastTrade[cand.pair] || 0;
        return (Date.now() - lastTrade) >= pairCooldownMs;
      });

      // Filter pairs that have hit max 2 trades today
      const pairTradeCount = {};
      const eligibleFinal = eligible.filter((cand)=>{
        const count = pairTradeCount[cand.pair] || 0;
        if(count >= 2) return false;
        pairTradeCount[cand.pair] = count + 1;
        return true;
      });

      if(eligibleFinal.length === 0){
        if($("atStatus")) $("atStatus").textContent = "All pairs in cooldown or max trades reached.";
        return;
      }

      const best = eligibleFinal[0];
      const sessionMinConf = getSessionConfidence();
      const effectiveMinConf = Math.min(0.9, c.minConfidence + state.minConfBoost);
      const minConfToUse = Math.max(sessionMinConf, effectiveMinConf);

      if(best.confidence < minConfToUse){
        if($("atStatus")) $("atStatus").textContent = `Watching ${best.pair}: confidence ${best.confidence.toFixed(2)} below ${minConfToUse.toFixed(2)}.`;
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
