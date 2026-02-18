(function(){
  const $ = (id)=>document.getElementById(id);

  const Framework = new Sway.Framework();
  window.LC = window.LC || {};
  window.LC.Framework = Framework;
  
  // Constants
  const AUTOTRADER_RESUME_DELAY_MS = 1000;

  function ts(){
    const d=new Date(), pad=n=>(n<10?"0":"")+n;
    let h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
    const ampm=h>=12?"PM":"AM"; h=h%12; if(h===0) h=12;
    return `[${h}:${pad(m)}:${pad(s)} ${ampm}]`;
  }

  function log(msg){
    const box = $("log");
    box.textContent = `${ts()} ${msg}\n` + box.textContent;
  }

  function safeJson(x){
    try{ return JSON.stringify(x); }catch(_){ return "(unstringifiable)"; }
  }

  function setStatus(text, kind){
    const pill=$("statusPill");
    pill.textContent=text;
    pill.className="pill " + (kind||"");
  }

  function toolArmed(){
    return $("toolArm")?.value === "on";
  }

  function toNum(v, fallback=0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function selectedPair(){
    return ($("toolPair")?.value || "").trim();
  }

  function lots(){
    return toNum($("toolQty")?.value, 0.01);
  }

  function tpPts(){
    return toNum($("toolTpPips")?.value, 55);
  }

  function slPts(){
    return toNum($("toolSlPips")?.value, 55);
  }

  function requestPrices(list){
    try{ Framework.RequestPrices(list); }catch(_){ }
  }

  function getMarket(instrumentId){
    try{
      return Framework.Instruments.getOrBlank(instrumentId);
    }catch(_){
      return { bid:null, ask:null };
    }
  }

  function refreshPx(){
    const m = getMarket(selectedPair());
    const bid = Number.isFinite(Number(m.bid)) ? m.bid : "…";
    const ask = Number.isFinite(Number(m.ask)) ? m.ask : "…";
    if($("toolPx")) $("toolPx").textContent = `bid/ask: ${bid} / ${ask}`;
  }

  function openTicket(pair){
    Framework.CreateDialog({ type:"dealticket", settings:{ instrumentId: pair }});
    log(`✅ DealTicket opened for ${pair}`);
  }

  function sendOrderAsync(payload){
    return new Promise((resolve, reject)=>{
      try{
        Framework.SendOrder(payload, (res)=>resolve(res));
      }catch(e){
        reject(e);
      }
    });
  }

  function actionConst(name, fallback){
    return (window.Liquid && window.Liquid.OrderTypes && window.Liquid.OrderTypes[name]) || fallback;
  }

  async function sendMarket(pair, isBuy, lotSize){
    if(!toolArmed()){
      log("🛡️ ARM OFF → ticket only");
      openTicket(pair);
      return;
    }

    const action = isBuy ? actionConst("BUY", 1) : actionConst("SELL", 2);
    const payload = {
      instrumentId: pair,
      tradingAction: action,
      volume: { lots: lotSize }
    };

    log(`🟦 SendMarket ${isBuy?"BUY":"SELL"} payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ result=${safeJson(res)}`);
  }

  async function sendWithTPSL(pair, isBuy, lotSize, tpPrice, slPrice){
    if(!toolArmed()){
      log("🛡️ ARM OFF → ticket only");
      openTicket(pair);
      return;
    }

    const m = getMarket(pair);
    const bid = Number(m.bid), ask = Number(m.ask);
    if(!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("No live bid/ask yet for selected market.");

    const action = isBuy ? actionConst("BUY", 1) : actionConst("SELL", 2);
    
    // Accept absolute prices directly
    const finalTpPrice = Number(tpPrice);
    const finalSlPrice = Number(slPrice);

    const payload = {
      instrumentId: pair,
      tradingAction: action,
      volume: { lots: lotSize },
      takeProfit: { price: finalTpPrice },
      stopLoss: { price: finalSlPrice }
    };

    log(`🟦 ENTRY payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ ENTRY result=${safeJson(res)}`);
    return res;
  }

  async function changeOrderTPSL(orderId, tpAbsPrice, slAbsPrice){
    if(!toolArmed()) throw new Error("ARM OFF → cannot CHANGE.");
    if(!orderId) throw new Error("Missing orderId.");

    const payload = {
      tradingAction: actionConst("CHANGE", 101),
      orderId: String(orderId),
      tp: tpAbsPrice,
      sl: slAbsPrice
    };

    log(`🧪 CHANGE payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ CHANGE result=${safeJson(res)}`);
  }

  async function changeOrderTPSLFromDistance(orderId, pair, isBuy, tpDistancePts, slDistancePts){
    const m = getMarket(pair);
    const bid = Number(m.bid), ask = Number(m.ask);
    if(!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("No live bid/ask yet for selected market.");
    const base = isBuy ? ask : bid;
    const tpAbs = isBuy ? (base + tpDistancePts) : (base - tpDistancePts);
    const slAbs = isBuy ? (base - slDistancePts) : (base + slDistancePts);
    await changeOrderTPSL(orderId, tpAbs, slAbs);
  }

  function ordersDict(){
    return Framework.Orders && Framework.Orders._dict ? Framework.Orders._dict : {};
  }

  function positionsDict(){
    return Framework.Positions && Framework.Positions._dict ? Framework.Positions._dict : {};
  }

  function dumpOpenTrades(){
    try{
      log("=== DUMP OPEN TRADE SOURCES ===");
      const o = ordersDict();
      const p = positionsDict();
      const oIds = Object.keys(o);
      const pIds = Object.keys(p);

      log(`Orders ids (${oIds.length}): ${oIds.join(", ")}`);
      if(oIds.length){
        const id=oIds[0];
        log(`Sample order[${id}]=${safeJson(o[id])}`);
      }

      log(`Positions ids (${pIds.length}): ${pIds.join(", ")}`);
      if(pIds.length){
        const id=pIds[0];
        log(`Sample position[${id}]=${safeJson(p[id])}`);
      }
      log("=== DUMP END ===");
    }catch(e){
      log("Dump failed: " + (e.message||String(e)));
    }
  }

  async function closeAllForInstrument(instrumentId){
    if(!toolArmed()) throw new Error("ARM OFF → cannot close.");

    const pos = positionsDict()[instrumentId];
    if(!pos){
      log(`No position found for ${instrumentId}`);
      return;
    }

    const hasLong = (pos.longTradeCount || 0) > 0;
    const hasShort = (pos.shortTradeCount || 0) > 0;

    if(hasLong){
      const payload = { tradingAction: actionConst("CLOSEPOSLONG", 5), instrumentId };
      log(`🧨 Close long payload=${safeJson(payload)}`);
      const r = await sendOrderAsync(payload);
      log(`↩️ Close long result=${safeJson(r)}`);
    }

    if(hasShort){
      const payload = { tradingAction: actionConst("CLOSEPOSSHORT", 6), instrumentId };
      log(`🧨 Close short payload=${safeJson(payload)}`);
      const r = await sendOrderAsync(payload);
      log(`↩️ Close short result=${safeJson(r)}`);
    }
  }

  async function closeAllPositions(){
    if(!toolArmed()) throw new Error("ARM OFF → cannot close.");
    const dict = positionsDict();
    const ids = Object.keys(dict);
    for(const instrumentId of ids){
      const pos = dict[instrumentId];
      if(!pos) continue;
      if((pos.longTradeCount || 0) > 0){
        const payload = { instrumentId, tradingAction: actionConst("CLOSEPOSLONG", 5) };
        log(`🧨 CLOSEPOSLONG payload=${safeJson(payload)}`);
        const res = await sendOrderAsync(payload);
        log(`↩️ CLOSEPOSLONG result=${safeJson(res)}`);
      }
      if((pos.shortTradeCount || 0) > 0){
        const payload = { instrumentId, tradingAction: actionConst("CLOSEPOSSHORT", 6) };
        log(`🧨 CLOSEPOSSHORT payload=${safeJson(payload)}`);
        const res = await sendOrderAsync(payload);
        log(`↩️ CLOSEPOSSHORT result=${safeJson(res)}`);
      }
    }
  }

  function dumpOrderTypes(){
    try{
      const keys = Object.keys(window.Liquid?.OrderTypes || {});
      log("Liquid.OrderTypes keys: " + (keys.length ? keys.join(", ") : "(none)"));
    }catch(_){
      log("No Liquid.OrderTypes exposed");
    }
  }

  async function requestCandles(instrumentId, timeframe, count){
    if(Framework.pRequestCandles){
      return await Framework.pRequestCandles({ instrumentId, timeframe, count, streaming:false });
    }
    return await new Promise((resolve) => {
      Framework.RequestCandles({ instrumentId, timeframe, count, streaming:false }, (m)=>resolve(m));
    });
  }

  function collectPairs(){
    const set = new Set();
    const ctx = ($("ctxInstrument")?.value || "").trim();
    if(ctx && ctx !== "Unknown") set.add(ctx);

    const pairs = ($("pairs")?.value || "")
      .split(/\r?\n/)
      .map((s)=>s.trim())
      .filter(Boolean);
    pairs.forEach((p)=>set.add(p));
    if(set.size === 0) set.add("EUR/USD");
    return Array.from(set);
  }

  function refreshToolMarkets(){
    const sel = $("toolPair");
    if(!sel) return;
    const prev = sel.value;
    const pairs = collectPairs();
    sel.innerHTML = pairs.map((p)=>`<option value="${p}">${p}</option>`).join("");
    sel.value = (prev && pairs.includes(prev)) ? prev : pairs[0];
    refreshPx();
  }

  async function safeRefreshMarket(){
    log("🔄 Soft refresh started...");
    
    // Pause AutoTrader if running
    const atWasRunning = window.ENG?.AutoTrader?.isRunning?.();
    if(atWasRunning && window.ENG?.AutoTrader?.stop){
      window.ENG.AutoTrader.stop();
      log("⏸️ AutoTrader paused for refresh");
    }
    
    try{
      // Refresh market list
      refreshToolMarkets();
      
      // Collect all pairs
      const pairs = collectPairs();
      
      // Request fresh prices for all pairs
      if(pairs.length > 0){
        requestPrices(pairs);
        log(`✅ Requested prices for ${pairs.length} pairs`);
      }
      
      // Refresh strength meter if available
      if(window.ENG?.Strength?.run){
        await window.ENG.Strength.run();
        log("✅ Strength meter refreshed");
      }
      
      // Update current pair prices
      refreshPx();
      
      log("✅ Soft refresh completed");
      setStatus("Market refreshed", "ok");
      
    }catch(e){
      log(`❌ Soft refresh error: ${e?.message || e}`);
      setStatus("Refresh failed", "bad");
    }finally{
      // Resume AutoTrader if it was running
      if(atWasRunning && window.ENG?.AutoTrader?.start){
        setTimeout(()=>{
          window.ENG.AutoTrader.start();
          log("▶️ AutoTrader resumed");
        }, AUTOTRADER_RESUME_DELAY_MS);
      }
    }
  }

  async function runDiagnostics(){
    const pair = selectedPair();
    const diagTf = $("btTf")?.value || "M15";

    log("=== DIAGNOSTICS START ===");
    log(`Selected market: ${pair || "(none)"}`);
    log(`ARM: ${toolArmed() ? "ON" : "OFF"}`);

    const hasCandles = !!(Framework.pRequestCandles || Framework.RequestCandles);
    const hasPrices  = typeof Framework.RequestPrices === "function";
    const hasSendOrder = typeof Framework.SendOrder === "function";
    const hasOrders = !!Framework.Orders;
    const hasPositions = !!Framework.Positions;

    log("Candles API: " + (hasCandles?"✅":"❌"));
    log("RequestPrices: " + (hasPrices?"✅":"❌"));
    log("SendOrder: " + (hasSendOrder?"✅":"❌"));
    log("Orders: " + (hasOrders?"✅":"❌"));
    log("Positions: " + (hasPositions?"✅":"❌"));

    if(pair && hasPrices){
      requestPrices([pair]);
      refreshPx();
      log(`✅ Requested live prices for ${pair}`);
    }

    if(pair && hasCandles){
      try{
        const res = await requestCandles(pair, diagTf, 120);
        const rows = Array.isArray(res?.candles) ? res.candles.length : Array.isArray(res?.data) ? res.data.length : Array.isArray(res) ? res.length : 0;
        log(`✅ Candle pull OK: ${pair} ${diagTf} -> ${rows} rows`);
      }catch(e){
        log(`❌ Candle pull failed: ${e?.message || e}`);
      }
    }

    dumpOpenTrades();
    log("=== DIAGNOSTICS END ===");
  }

  Framework.OnLoad = function(){
    setStatus("Framework responding", "ok");
    log("✅ Framework loaded.");

    ["btnPing","btnReqPrices","btnHealth","btnDiagRun","btnPrices","btnTicket","btnBuyMarket","btnSellMarket","btnBuyTPSL","btnSellTPSL","btnChangeTPSL","btnDumpTrades","btnCloseAll","btnClearLog","btnStrengthRun","btnStrengthAuto","btnStrengthStop","btnRunBt","btnAutoStart","btnAutoStop"].forEach((id)=>{
      if($(id)) $(id).disabled = false;
    });

    $("btnPing").onclick = ()=>{
      log("Ping clicked.");
      log("RequestPrices exists " + (typeof Framework.RequestPrices === "function" ? "✅" : "❌"));
    };

    $("btnReqPrices").onclick = ()=>{
      const pairs = ($("pairs")?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,5);
      requestPrices(pairs);
      log("✅ RequestPrices sent for: " + pairs.join(", "));
    };

    $("btnHealth").onclick = ()=>{
      log("=== HEALTH CHECK ===");
      log("Candles API: " + ((Framework.pRequestCandles || Framework.RequestCandles)?"✅":"❌"));
      log("RequestPrices: " + (typeof Framework.RequestPrices === "function"?"✅":"❌"));
      log("SendOrder: " + (typeof Framework.SendOrder === "function"?"✅":"❌"));
      log("Orders: " + (Framework.Orders?"✅":"❌"));
      log("Positions: " + (Framework.Positions?"✅":"❌"));
      log("====================");
    };

    $("btnDiagRun").onclick = async ()=>{ setStatus("Running diagnostics…", "warn"); await runDiagnostics(); setStatus("Diagnostics done", "ok"); };
    $("btnPrices").onclick = ()=>{ requestPrices([selectedPair()]); refreshPx(); log(`🔁 Requested prices for ${selectedPair()}`); };
    $("btnTicket").onclick = ()=>openTicket(selectedPair());
    $("btnBuyMarket").onclick = async ()=>{ try{ await sendMarket(selectedPair(), true, lots()); setStatus("BUY sent", "ok"); }catch(e){ setStatus("BUY failed", "bad"); log(`❌ BUY failed: ${e?.message || e}`);} };
    $("btnSellMarket").onclick = async ()=>{ try{ await sendMarket(selectedPair(), false, lots()); setStatus("SELL sent", "ok"); }catch(e){ setStatus("SELL failed", "bad"); log(`❌ SELL failed: ${e?.message || e}`);} };
    $("btnBuyTPSL").onclick = async ()=>{ 
      try{ 
        const m = getMarket(selectedPair());
        const ask = Number(m.ask);
        if(!Number.isFinite(ask)) throw new Error("No valid ask price");
        const tpDist = tpPts();
        const slDist = slPts();
        const tpPrice = ask + tpDist;
        const slPrice = ask - slDist;
        await sendWithTPSL(selectedPair(), true, lots(), tpPrice, slPrice); 
        setStatus("BUY TP/SL sent", "ok"); 
      }catch(e){ 
        setStatus("BUY TP/SL failed", "bad"); 
        log(`❌ BUY TP/SL failed: ${e?.message || e}`);
      } 
    };
    $("btnSellTPSL").onclick = async ()=>{ 
      try{ 
        const m = getMarket(selectedPair());
        const bid = Number(m.bid);
        if(!Number.isFinite(bid)) throw new Error("No valid bid price");
        const tpDist = tpPts();
        const slDist = slPts();
        const tpPrice = bid - tpDist;
        const slPrice = bid + slDist;
        await sendWithTPSL(selectedPair(), false, lots(), tpPrice, slPrice); 
        setStatus("SELL TP/SL sent", "ok"); 
      }catch(e){ 
        setStatus("SELL TP/SL failed", "bad"); 
        log(`❌ SELL TP/SL failed: ${e?.message || e}`);
      } 
    };
    $("btnChangeTPSL").onclick = async ()=>{
      const oid = ($("toolOrderId")?.value || "").trim();
      if(!oid){ log("❌ Enter orderId first"); return; }
      const ord = ordersDict()[oid];
      const isBuy = !(ord && ord.orderType === 2);
      try{ await changeOrderTPSLFromDistance(oid, selectedPair(), isBuy, tpPts(), slPts()); setStatus("CHANGE sent", "ok"); }
      catch(e){ setStatus("CHANGE failed", "bad"); log(`❌ CHANGE failed: ${e?.message || e}`);} 
    };
    $("btnDumpTrades").onclick = dumpOpenTrades;
    $("btnCloseAll").onclick = async ()=>{ try{ await closeAllForInstrument(selectedPair()); setStatus("Close sent", "ok"); }catch(e){ setStatus("Close failed", "bad"); log(`❌ Close failed: ${e?.message || e}`);} };

    $("btnRefreshTool").onclick = async ()=>{ await safeRefreshMarket(); };
    $("btnClearLog").onclick = ()=>{ $("log").textContent=""; };

    try{
      const inst = (Framework.Chart && Framework.Chart.instrumentId) ? Framework.Chart.instrumentId : null;
      const tf = (Framework.Chart && Framework.Chart.timeframe) ? Framework.Chart.timeframe : null;
      if(inst) $("ctxInstrument").value = inst;
      if(tf) $("ctxTf").value = String(tf);
    }catch(_){ }

    if(window.LC && typeof window.LC.refreshBacktestMarkets === "function") window.LC.refreshBacktestMarkets();
    refreshToolMarkets();
    requestPrices([selectedPair()]);
    refreshPx();
    setInterval(()=>{ try{ requestPrices([selectedPair()]); refreshPx(); }catch(_){ } }, 1000);

    if($("toolPair")) $("toolPair").addEventListener("change", ()=>{ requestPrices([selectedPair()]); refreshPx(); });
    if($("pairs")) $("pairs").addEventListener("change", refreshToolMarkets);
  };

  Framework.OnPriceChange = function(){
    refreshPx();
  };

  window.LC.log = log;
  window.LC.setStatus = setStatus;
  window.LC.requestCandles = requestCandles;
  window.LC.pRequestCandles = requestCandles;
  window.LC.requestPrices = requestPrices;
  window.LC.refreshToolMarkets = refreshToolMarkets;

  window.LC.api = {
    safeJson,
    market: getMarket,
    requestPrices,
    openDealTicket: openTicket,
    sendMarketOrder: (instrumentId, isBuy, lotSize)=>sendMarket(instrumentId, !!isBuy, Number(lotSize || 0.01)),
    sendMarketOrderWithTPSL: (instrumentId, isBuy, lotSize, tpAbsPrice, slAbsPrice)=>sendWithTPSL(instrumentId, !!isBuy, Number(lotSize || 0.01), Number(tpAbsPrice || 0), Number(slAbsPrice || 0)),
    dumpOpenTradeSources: dumpOpenTrades,
    changeOrderTPSL,
    closeAllPositions,
    dumpOrderTypes,
    pRequestCandles: requestCandles
  };
})();
