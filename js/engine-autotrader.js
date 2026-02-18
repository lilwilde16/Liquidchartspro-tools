(function(){
  "use strict";

  // === CONFIGURATION CONSTANTS ===
  const $ = (id)=>document.getElementById(id);
  const MEM_KEY = "lc.autoTrader.memory.v2";

  // Strength thresholds
  const MIN_STRENGTH_SPREAD = 0.40;
  const MIN_STRENGTH_AGAINST_TREND = 0.65;

  // Trend confirmation
  const H1_MIN_TREND_RATIO = 0.30;

  // RSI filters
  const RSI_M5_LONG_MIN = 55;
  const RSI_M5_SHORT_MAX = 45;
  const RSI_H1_LONG_MIN = 50;
  const RSI_H1_SHORT_MAX = 50;

  // Spread filtering
  const SPREAD_MEDIAN_MULTIPLIER = 1.2;
  const JPY_SPREAD_THRESHOLD = 0.03; // 3 pips for JPY pairs

  // Confidence weights
  const CONF_WEIGHTS = {
    vol: 0.25,
    sharp: 0.25,
    strength: 0.25,
    regime: 0.12,
    spread: -0.10,
    learning: 0.23
  };

  // Session-based minimum confidence
  const SESSION_MIN_CONFIDENCE = {
    london: 0.62,      // London session (7-16 UTC)
    nyOverlap: 0.60,   // NY overlap (12-16 UTC)
    other: 0.66        // All other times
  };

  // Risk management
  const DEFAULT_SL_ATR_MULT = 1.1;
  const DEFAULT_RR = 1.5;
  const AGGRESSIVE_RR = 2.0;
  const PARTIAL_TP_PERCENT = 0.5;  // Take 50% at 1R
  const BE_MOVE_AT_R = 0.8;        // Move SL to BE at 0.8R
  const ATR_TRAIL_MULT = 0.9;      // Trail SL at 0.9× ATR

  // Cooldowns and limits
  const PER_PAIR_COOLDOWN_MIN = 60;
  const MAX_TRADES_PER_PAIR_PER_DAY = 2;
  const GLOBAL_COOLDOWN_MIN = 45;
  const LOSS_CONFIDENCE_PENALTY = 0.05;

  // === MODULE STATE ===
  const state = {
    timer: null,
    running: false,
    cycling: false,
    inFlight: false,
    lastTradeAt: 0,
    dayKey: "",
    tradesToday: 0,
    pairCooldowns: {},  // pair -> lastTradeTimestamp
    pairTradeCounts: {}, // pair -> count today
    memory: loadMemory(),
    recentSpreads: {},  // pair -> [spreads]
    lastSnapshots: []   // Last 2 strength snapshots for stability check
  };

  // === UTILITY FUNCTIONS ===
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

  function isJPYPair(pair){
    return pair.includes("JPY");
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || []);
    return src.map((c)=>({
      o: Number(c?.open ?? c?.Open ?? c?.o ?? NaN),
      h: Number(c?.high ?? c?.High ?? c?.h ?? NaN),
      l: Number(c?.low ?? c?.Low ?? c?.l ?? NaN),
      c: Number(c?.close ?? c?.Close ?? c?.c ?? NaN)
    })).filter((x)=>Number.isFinite(x.o) && Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
  }

  function getCurrentSession(){
    const h = new Date().getUTCHours();
    // London: 7-16, NY: 12-21, Overlap: 12-16
    if(h >= 12 && h <= 16) return "nyOverlap";
    if(h >= 7 && h <= 16) return "london";
    return "other";
  }

  function getSessionMinConfidence(){
    const session = getCurrentSession();
    return SESSION_MIN_CONFIDENCE[session] || SESSION_MIN_CONFIDENCE.other;
  }

  // === CONFIGURATION ===
  function cfg(){
    return {
      tf: $("atTf")?.value || "M15",
      candles: Math.max(200, Math.min(3000, Math.floor(toNum($("atCandles")?.value, 500)))),
      intervalSec: Math.max(1, Math.min(3600, Math.floor(toNum($("atPollSec")?.value, 1)))),
      riskMode: $("atRiskMode")?.value || "conservative",
      lots: toNum($("atLots")?.value, 0.01),
      rr: toNum($("atRr")?.value, DEFAULT_RR),
      slAtr: toNum($("atSlAtr")?.value, DEFAULT_SL_ATR_MULT),
      useSchedule: ($("atUseSchedule")?.value || "yes") === "yes",
      startHour: Math.floor(toNum($("atStartHour")?.value, 6)),
      endHour: Math.floor(toNum($("atEndHour")?.value, 20)),
      volStart: Math.floor(toNum($("atVolStart")?.value, 12)),
      volEnd: Math.floor(toNum($("atVolEnd")?.value, 16)),
      maxTradesPerDay: Math.max(1, Math.min(20, Math.floor(toNum($("atMaxTradesDay")?.value, 4)))),
      cooldownMin: Math.max(1, Math.min(240, Math.floor(toNum($("atCooldownMin")?.value, GLOBAL_COOLDOWN_MIN)))),
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
      state.pairTradeCounts = {};
    }
  }

  // === MEMORY & LEARNING ===
  function loadMemory(){
    try{
      const raw = window.localStorage.getItem(MEM_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if(parsed && typeof parsed === "object") return parsed;
    }catch(_){ }
    return { byPair: {}, totalSignals: 0, totalWins: 0, totalLosses: 0, consecutiveLosses: 0 };
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
    // Bayesian estimate with prior
    return (s.wins + 1) / (n + 2);
  }

  function recordLoss(){
    state.memory.consecutiveLosses = (state.memory.consecutiveLosses || 0) + 1;
    state.memory.totalLosses = (state.memory.totalLosses || 0) + 1;
    saveMemory();
  }

  function recordWin(){
    state.memory.consecutiveLosses = 0;
    state.memory.totalWins = (state.memory.totalWins || 0) + 1;
    saveMemory();
  }

  function getAdaptiveConfidenceAdjustment(){
    // After 2+ consecutive losses, increase the minimum confidence threshold
    const losses = state.memory.consecutiveLosses || 0;
    if(losses >= 2) return LOSS_CONFIDENCE_PENALTY;
    return 0;
  }

  // === STRENGTH ANALYSIS ===
  function strengthBias(pair){
    const snap = window.ENG?.Strength?.getSnapshot?.();
    const ranked = snap?.ranked || [];
    const parts = parsePair(pair);
    if(!parts || ranked.length < 2) return { score: 0, side: 0, spread: 0 };

    // Get min/max range for dynamic scaling
    const scores = ranked.map(r=>r.avgScore);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    const map = Object.fromEntries(ranked.map((x)=>[x.ccy, x.avgScore]));
    const b = Number(map[parts.base] || 0);
    const q = Number(map[parts.quote] || 0);
    const spread = b - q;

    // Scale spread by current range
    const scaledScore = range > 0 ? spread / range : 0;

    return {
      score: Math.max(-1, Math.min(1, scaledScore)),
      side: spread >= 0 ? 1 : -1,
      spread,
      rawSpread: Math.abs(spread)
    };
  }

  function checkStrengthStability(){
    // Check if strength rankings are stable over last 2 snapshots
    if(state.lastSnapshots.length < 2) return true;
    
    const [prev, curr] = state.lastSnapshots.slice(-2);
    if(!prev || !curr) return true;
    
    // Simple check: top 3 currencies should be similar
    const prevTop = prev.slice(0, 3).map(r=>r.ccy).sort().join(",");
    const currTop = curr.slice(0, 3).map(r=>r.ccy).sort().join(",");
    
    return prevTop === currTop;
  }

  // === PAIR ANALYSIS ===
  async function pairMetrics(pair, c){
    // Fetch M5, H1 data for multi-timeframe analysis
    const [m5Raw, h1Raw] = await Promise.all([
      window.LC.requestCandles(pair, "M5", 300),
      window.LC.requestCandles(pair, "H1", 200)
    ]);

    const m5Candles = normalizeCandles(m5Raw);
    const h1Candles = normalizeCandles(h1Raw);

    if(m5Candles.length < 50 || h1Candles.length < 50){
      throw new Error("not enough candles");
    }

    // Extract price arrays
    const m5Close = m5Candles.map(x=>x.c);
    const m5High = m5Candles.map(x=>x.h);
    const m5Low = m5Candles.map(x=>x.l);
    const m5Open = m5Candles.map(x=>x.o);

    const h1Close = h1Candles.map(x=>x.c);
    const h1High = h1Candles.map(x=>x.h);
    const h1Low = h1Candles.map(x=>x.l);

    if(!window.UTIL?.sma || !window.UTIL?.atr || !window.UTIL?.rsi){
      throw new Error("indicator utils missing");
    }

    // M5 indicators
    const m5Fast = window.UTIL.sma(m5Close, 20);
    const m5Slow = window.UTIL.sma(m5Close, 100);
    const m5ATR = window.UTIL.atr(m5High, m5Low, m5Close, 14);
    const m5RSI = window.UTIL.rsi(m5Close, 7);

    // H1 indicators
    const h1Fast = window.UTIL.sma(h1Close, 20);
    const h1Slow = window.UTIL.sma(h1Close, 100);
    const h1ATR = window.UTIL.atr(h1High, h1Low, h1Close, 14);
    const h1RSI = window.UTIL.rsi(h1Close, 7);

    const m5i = m5Close.length - 1;
    const h1i = h1Close.length - 1;

    const atrNow = Number(m5ATR[m5i]);
    const h1AtrNow = Number(h1ATR[h1i]);
    
    if(!Number.isFinite(atrNow) || atrNow <= 0) throw new Error("atr unavailable");

    // Trend ratios
    const m5TrendRatio = Math.abs(m5Fast[m5i] - m5Slow[m5i]) / atrNow;
    const h1TrendRatio = Math.abs(h1Fast[h1i] - h1Slow[h1i]) / (h1AtrNow || atrNow);

    // H1 trend direction
    const h1TrendUp = h1Fast[h1i] > h1Slow[h1i];
    const h1TrendDown = h1Fast[h1i] < h1Slow[h1i];

    // ATR percentage
    const atrPct = atrNow / m5Close[m5i];

    // Supply/Demand zones (simplified)
    const lookback = 30;
    const swingHigh = Math.max(...m5High.slice(m5i - lookback, m5i));
    const swingLow = Math.min(...m5Low.slice(m5i - lookback, m5i));
    const zoneBuf = atrNow * 0.25;

    const nearDemand = m5Close[m5i] <= (swingLow + zoneBuf);
    const nearSupply = m5Close[m5i] >= (swingHigh - zoneBuf);
    const bullishRejection = m5Close[m5i] > m5Open[m5i] && m5Low[m5i] <= swingLow + zoneBuf;
    const bearishRejection = m5Close[m5i] < m5Open[m5i] && m5High[m5i] >= swingHigh - zoneBuf;

    // Determine direction
    let dir = 0;
    if(nearDemand && bullishRejection) dir = 1;
    else if(nearSupply && bearishRejection) dir = -1;

    // Momentum & scores
    const momentum = Math.abs(m5Close[m5i] - m5Close[m5i - 8]) / atrNow;
    const volScore = Math.min(1, Math.max(0, (atrPct - 0.0005) / 0.004));
    const sharpScore = Math.min(1, Math.max(0, (m5TrendRatio - 0.25) / 1.5));

    // Spread calculation
    const market = window.LC?.api?.market(pair);
    const bid = Number(market?.bid || 0);
    const ask = Number(market?.ask || 0);
    const currentSpread = ask > bid ? ask - bid : 0;

    // Track spreads for median calculation
    if(!state.recentSpreads[pair]) state.recentSpreads[pair] = [];
    state.recentSpreads[pair].push(currentSpread);
    if(state.recentSpreads[pair].length > 50) state.recentSpreads[pair].shift();

    return {
      pair,
      dir,
      atrNow,
      atrPct,
      m5TrendRatio,
      h1TrendRatio,
      h1TrendUp,
      h1TrendDown,
      momentum,
      volScore,
      sharpScore,
      close: m5Close[m5i],
      m5RSI: m5RSI[m5i],
      h1RSI: h1RSI[h1i],
      currentSpread
    };
  }

  function calculateSpreadMedian(pair){
    const spreads = state.recentSpreads[pair] || [];
    if(spreads.length === 0) return 0;
    const sorted = [...spreads].sort((a,b)=>a-b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid-1] + sorted[mid]) / 2 : sorted[mid];
  }

  // === CANDIDATE SCORING ===
  function scoreCandidate(m, c){
    if(m.dir === 0) return { confidence: 0, reason: "no zone rejection" };

    // H1 trend confirmation
    if(m.h1TrendRatio < H1_MIN_TREND_RATIO){
      return { confidence: 0, reason: `H1 trend weak (${m.h1TrendRatio.toFixed(2)} < ${H1_MIN_TREND_RATIO})` };
    }

    const sb = strengthBias(m.pair);

    // Check strength spread threshold
    if(sb.rawSpread < MIN_STRENGTH_SPREAD){
      return { confidence: 0, reason: `strength spread too low (${sb.rawSpread.toFixed(2)} < ${MIN_STRENGTH_SPREAD})` };
    }

    // Check strength stability
    if(!checkStrengthStability()){
      return { confidence: 0, reason: "strength rankings unstable" };
    }

    // Direction vs strength alignment
    const alignedWithStrength = (m.dir === 1 && sb.side > 0) || (m.dir === -1 && sb.side < 0);
    
    if(!alignedWithStrength){
      // Allow against-trend only if strength is very strong
      if(Math.abs(sb.score) < MIN_STRENGTH_AGAINST_TREND){
        return { confidence: 0, reason: "strength mismatch" };
      }
    }

    // H1 trend vs direction (only allow against H1 trend if strength ≥ 0.65)
    const alignedWithH1 = (m.dir === 1 && m.h1TrendUp) || (m.dir === -1 && m.h1TrendDown);
    if(!alignedWithH1 && Math.abs(sb.score) < MIN_STRENGTH_AGAINST_TREND){
      return { confidence: 0, reason: "H1 trend mismatch" };
    }

    // RSI filters
    if(m.dir === 1){
      if(m.m5RSI < RSI_M5_LONG_MIN){
        return { confidence: 0, reason: `M5 RSI too low for long (${m.m5RSI.toFixed(0)} < ${RSI_M5_LONG_MIN})` };
      }
      if(m.h1RSI < RSI_H1_LONG_MIN){
        return { confidence: 0, reason: `H1 RSI too low for long (${m.h1RSI.toFixed(0)} < ${RSI_H1_LONG_MIN})` };
      }
    }else if(m.dir === -1){
      if(m.m5RSI > RSI_M5_SHORT_MAX){
        return { confidence: 0, reason: `M5 RSI too high for short (${m.m5RSI.toFixed(0)} > ${RSI_M5_SHORT_MAX})` };
      }
      if(m.h1RSI > RSI_H1_SHORT_MAX){
        return { confidence: 0, reason: `H1 RSI too high for short (${m.h1RSI.toFixed(0)} > ${RSI_H1_SHORT_MAX})` };
      }
    }

    // Spread cap check
    const medianSpread = calculateSpreadMedian(m.pair);
    const spreadCap = isJPYPair(m.pair) ? JPY_SPREAD_THRESHOLD : medianSpread * SPREAD_MEDIAN_MULTIPLIER;
    
    if(m.currentSpread > spreadCap && medianSpread > 0){
      return { confidence: 0, reason: `spread too high (${m.currentSpread.toFixed(5)} > ${spreadCap.toFixed(5)})` };
    }

    // Calculate confidence score
    const learn = c.learning ? pairLearningScore(m.pair) : 0.5;
    const spreadScore = medianSpread > 0 ? Math.max(0, 1 - (m.currentSpread / medianSpread)) : 0.5;
    const regimeScore = alignedWithH1 ? 1 : 0.5;

    const confidence = 
      CONF_WEIGHTS.vol * m.volScore +
      CONF_WEIGHTS.sharp * m.sharpScore +
      CONF_WEIGHTS.strength * Math.min(1, Math.abs(sb.score)) +
      CONF_WEIGHTS.regime * regimeScore +
      CONF_WEIGHTS.spread * (1 - spreadScore) +
      CONF_WEIGHTS.learning * learn;

    return {
      confidence: Math.max(0, Math.min(1, confidence)),
      reason: `vol=${m.volScore.toFixed(2)} sharp=${m.sharpScore.toFixed(2)} str=${Math.abs(sb.score).toFixed(2)} regime=${regimeScore.toFixed(2)} spread=${spreadScore.toFixed(2)} learn=${learn.toFixed(2)}`,
      strengthSpread: sb.spread || 0,
      alignedWithH1
    };
  }

  // === PAIR SCANNING ===
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

  // === TRADING EXECUTION ===
  async function placeTrade(candidate, c){
    const side = candidate.dir === 1 ? "BUY" : "SELL";
    const riskMult = c.riskMode === "conservative" ? 0.9 : 1.05;
    const slDistance = candidate.atrNow * c.slAtr * riskMult;
    const tpDistance = slDistance * c.rr;

    try{
      await window.LC.api.sendMarketOrderWithTPSL(
        candidate.pair,
        candidate.dir === 1,
        c.lots,
        tpDistance,
        slDistance
      );

      state.lastTradeAt = Date.now();
      state.tradesToday += 1;
      state.pairCooldowns[candidate.pair] = Date.now();
      state.pairTradeCounts[candidate.pair] = (state.pairTradeCounts[candidate.pair] || 0) + 1;
      state.memory.totalSignals += 1;
      saveMemory();

      window.LC.log(`🤖 AutoTrader ${side} ${candidate.pair} | conf=${candidate.confidence.toFixed(2)} | TP=${tpDistance.toFixed(5)} SL=${slDistance.toFixed(5)} | session=${getCurrentSession()}`);
      
      // TODO: Implement partial TP, BE move, ATR trail when API supports order modification
      // For now, just log the intent
      window.LC.log(`   → Plan: 50% TP at ${(slDistance * 1.0).toFixed(5)}, BE at ${(slDistance * BE_MOVE_AT_R).toFixed(5)}, Trail ${ATR_TRAIL_MULT}×ATR`);
      
    }catch(e){
      window.LC.log(`❌ AutoTrader order failed: ${e?.message || e}`);
      throw e;
    }
  }

  // === LEARNING FROM TRADES ===
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
            recordWin();
          }else if(pnl < 0){
            st.losses += 1;
            recordLoss();
          }
        }
      }
      saveMemory();
    }catch(_){ }
  }

  // === MAIN CYCLE ===
  async function runCycle(){
    // Concurrency guard: skip if already running
    if(state.inFlight) {
      return;
    }
    
    if(!state.running || state.cycling) return;
    state.cycling = true;
    state.inFlight = true;
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
        const remaining = Math.ceil((c.cooldownMin * 60000 - (Date.now() - state.lastTradeAt)) / 60000);
        if($("atStatus")) $("atStatus").textContent = `Idle: global cooldown active (${remaining}m remaining).`;
        return;
      }

      const pairs = parsePairs();
      if(pairs.length === 0){
        if($("atStatus")) $("atStatus").textContent = "No valid pairs in Settings.";
        return;
      }

      // Run strength scan and capture snapshot
      if(window.ENG?.Strength?.run){
        await window.ENG.Strength.run();
        const snap = window.ENG.Strength.getSnapshot();
        if(snap?.ranked){
          state.lastSnapshots.push(snap.ranked);
          if(state.lastSnapshots.length > 2) state.lastSnapshots.shift();
        }
      }

      updateLearningFromOpenTrades();

      // Filter pairs by cooldown and daily limits
      const now = Date.now();
      const availablePairs = pairs.filter(pair=>{
        const lastTrade = state.pairCooldowns[pair] || 0;
        const pairCount = state.pairTradeCounts[pair] || 0;
        const cooldownOk = (now - lastTrade) >= (PER_PAIR_COOLDOWN_MIN * 60000);
        const limitOk = pairCount < MAX_TRADES_PER_PAIR_PER_DAY;
        return cooldownOk && limitOk;
      });

      if(availablePairs.length === 0){
        if($("atStatus")) $("atStatus").textContent = "All pairs on cooldown or at daily limit.";
        return;
      }

      const scored = await scanAllPairs(availablePairs, c);
      if(scored.length === 0){
        if($("atStatus")) $("atStatus").textContent = "No valid pair metrics available.";
        return;
      }

      const best = scored[0];
      
      // Apply adaptive confidence adjustment after consecutive losses
      const sessionMinConf = getSessionMinConfidence();
      const adaptiveAdjustment = getAdaptiveConfidenceAdjustment();
      const finalMinConf = Math.min(0.9, sessionMinConf + adaptiveAdjustment);

      if(best.confidence < finalMinConf){
        if($("atStatus")){
          $("atStatus").textContent = `Watching ${best.pair}: conf ${best.confidence.toFixed(2)} < ${finalMinConf.toFixed(2)} (session=${getCurrentSession()}, adj=${adaptiveAdjustment.toFixed(2)})`;
        }
        return;
      }

      await placeTrade(best, c);
      
      if($("atStatus")){
        $("atStatus").textContent = `Trade sent ${best.pair} | conf ${best.confidence.toFixed(2)} | today ${state.tradesToday}/${c.maxTradesPerDay} | session ${getCurrentSession()}`;
      }
      
    }catch(e){
      window.LC.log(`❌ AutoTrader cycle failed: ${e?.message || e}`);
      if($("atStatus")) $("atStatus").textContent = "Cycle failed. Check log.";
    } finally {
      state.cycling = false;
      state.inFlight = false;
    }
  }

  // === LIFECYCLE ===
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
    
    window.LC.log(`🤖 AutoTrader started (${c.intervalSec}s cycle, learning=${c.learning?"on":"off"}, session=${getCurrentSession()}).`);
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

  // === PUBLIC API ===
  window.ENG = window.ENG || {};
  window.ENG.AutoTrader = { start, stop, init, runCycle };
})();
