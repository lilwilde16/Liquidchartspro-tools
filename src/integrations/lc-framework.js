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

    // Use top-level tp/sl keys (same as attachTPSLViaChange) — the platform reliably reads these on CHANGE (101).
    const payload = {
      tradingAction: actionConst("CHANGE", 101),
      orderId: String(orderId),
      tp: Number(tpAbsPrice),
      sl: Number(slAbsPrice)
    };

    log(`🧪 CHANGE payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ CHANGE result=${safeJson(res)}`);
    return res;
  }

  async function changeOrderTPSLFromDistance(orderId, pair, isBuy, tpDistancePts, slDistancePts){
    const m = getMarket(pair);
    const bid = Number(m.bid), ask = Number(m.ask);
    if(!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("No live bid/ask yet for selected market.");
    const base = isBuy ? ask : bid;
    const tpAbs = isBuy ? (base + tpDistancePts) : (base - tpDistancePts);
    const slAbs = isBuy ? (base - slDistancePts) : (base + slDistancePts);
    return await changeOrderTPSL(orderId, tpAbs, slAbs);
  }

  function ordersDict(){
    return Framework.Orders && Framework.Orders._dict ? Framework.Orders._dict : {};
  }

  async function attachTPSLViaChange(orderId, instrumentId, isBuy, tpAbs, slAbs){
    if(!toolArmed()) throw new Error("ARM OFF → cannot CHANGE.");
    if(!orderId) throw new Error("Missing orderId for attachTPSLViaChange.");

    const payload = {
      tradingAction: actionConst("CHANGE", 101),
      orderId: String(orderId),
      tp: Number(tpAbs),
      sl: Number(slAbs)
    };

    log(`🔗 attachTPSLViaChange payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ attachTPSLViaChange result=${safeJson(res)}`);
    return res;
  }

  async function placeMarketThenAttachTPSL(instrumentId, isBuy, lotSize, tpInput, slInput, tpIsPips, options){
    if(!toolArmed()){
      log("🛡️ ARM OFF → ticket only");
      openTicket(instrumentId);
      return { orderId: null, entryResponse: null, changeResponse: null, status: "arm_off" };
    }

    const opts = options || {};
    const timeoutMs = Number(opts.timeoutMs) || 6000;
    const delayMs = Number(opts.delayMs) || 500;

    let tpAbs = Number(tpInput);
    let slAbs = Number(slInput);

    const isJpy = /JPY/.test(String(instrumentId).toUpperCase());
    const isIdx = ["NAS100","US30","SPX500","DJ30","DAX","FTSE","NIKKEI"].some((i)=>String(instrumentId).toUpperCase() === i || new RegExp("(^|[^A-Z0-9])" + i + "([^A-Z0-9]|$)").test(String(instrumentId).toUpperCase()));
    const logPrecision = isJpy ? 3 : (isIdx ? 2 : 5);

    if(tpIsPips){
      const m = getMarket(instrumentId);
      const bid = Number(m.bid), ask = Number(m.ask);
      if(!Number.isFinite(bid) || !Number.isFinite(ask)) throw new Error("No live bid/ask for pip conversion.");
      const entryPrice = isBuy ? ask : bid;
      const pipSz = isJpy ? 0.01 : (isIdx ? 1.0 : 0.0001);
      tpAbs = isBuy ? entryPrice + (tpInput * pipSz) : entryPrice - (tpInput * pipSz);
      slAbs = isBuy ? entryPrice - (slInput * pipSz) : entryPrice + (slInput * pipSz);
    }

    const action = isBuy ? actionConst("BUY", 1) : actionConst("SELL", 2);
    const entryPayload = {
      instrumentId,
      tradingAction: action,
      volume: { lots: Number(lotSize) }
    };

    log(`🚀 placeMarketThenAttachTPSL ${isBuy?"BUY":"SELL"} ${instrumentId} lots=${lotSize} TP=${Number(tpAbs).toFixed(logPrecision)} SL=${Number(slAbs).toFixed(logPrecision)}`);
    log(`🟦 ENTRY payload=${safeJson(entryPayload)}`);
    const entryResponse = await sendOrderAsync(entryPayload);
    log(`↩️ ENTRY result=${safeJson(entryResponse)}`);

    let orderId = (entryResponse?.orderId || entryResponse?.id) ? String(entryResponse.orderId || entryResponse.id) : null;

    if(!orderId){
      const normalizedId = String(instrumentId).replace(/\s/g, "").toLowerCase();
      const deadline = Date.now() + timeoutMs;
      while(!orderId && Date.now() < deadline){
        await new Promise((r)=>setTimeout(r, delayMs));
        const dict = ordersDict();
        for(const k of Object.keys(dict)){
          const o = dict[k];
          const oId = String(o.instrumentId || o.instrument || "").replace(/\s/g, "").toLowerCase();
          if(oId === normalizedId){
            orderId = k;
            break;
          }
        }
      }
      if(orderId) log(`🔍 Found orderId via Orders._dict scan: ${orderId}`);
      else log(`⚠️ Could not find orderId for ${instrumentId} in Orders._dict after ${timeoutMs}ms`);
    }

    let changeResponse = null;
    let status = "entry_placed";

    if(orderId){
      try{
        changeResponse = await attachTPSLViaChange(orderId, instrumentId, isBuy, tpAbs, slAbs);
        status = "tpsl_attached";
        log(`✅ placeMarketThenAttachTPSL complete: order=${orderId} TP=${Number(tpAbs).toFixed(logPrecision)} SL=${Number(slAbs).toFixed(logPrecision)}`);
      }catch(changeErr){
        status = "change_failed";
        log(`❌ attachTPSLViaChange failed: ${changeErr?.message || changeErr}`);
      }
    }else{
      status = "no_order_id";
      log(`⚠️ placeMarketThenAttachTPSL: entry placed but could not attach TP/SL (no orderId)`);
    }

    return { orderId, entryResponse, changeResponse, status };
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

  async function closeOrderById(orderId){
    if(!toolArmed()) throw new Error("ARM OFF → cannot close.");
    if(!orderId) throw new Error("Missing orderId.");

    // Try to read direction from Orders dict so we can use the precise close action
    const order = ordersDict()[String(orderId)];
    const instrumentId = order ? (order.instrumentId || order.instrument || null) : null;
    const isSell = order && (order.tradingAction === 2 || order.orderType === 2 || order.direction === "sell");

    // CLOSETRADE (4) targets a single order/ticket by its ID
    const payload = {
      tradingAction: actionConst("CLOSETRADE", 4),
      orderId: String(orderId)
    };
    if(instrumentId) payload.instrumentId = instrumentId;

    log(`🧨 closeOrderById id=${orderId}${instrumentId ? " inst="+instrumentId : ""}${order ? " dir="+(isSell?"SELL":"BUY") : ""}`);
    log(`🧨 closeOrderById payload=${safeJson(payload)}`);
    const res = await sendOrderAsync(payload);
    log(`↩️ closeOrderById result=${safeJson(res)}`);
    return res;
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

  // === ORDER DROPDOWN ===
  function populateOrderDropdown(){
    const sel = $("toolOrderId");
    if(!sel || sel.tagName !== "SELECT") return;
    const oDict = ordersDict();
    const pDict = positionsDict();
    const prev = sel.value;
    sel.innerHTML = `<option value="">\u2014 select open order \u2014</option>`;
    const addedIds = new Set();
    // Orders dict
    Object.keys(oDict).forEach((id)=>{
      const o = oDict[id];
      const inst = o.instrumentId || o.instrument || "";
      const dir = (o.tradingAction === 2 || o.orderType === 2 || o.direction === "sell") ? "SELL" : "BUY";
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${inst} ${dir} #${id}`;
      sel.appendChild(opt);
      addedIds.add(id);
    });
    // Positions dict (only those not already added from orders)
    Object.keys(pDict).forEach((id)=>{
      if(addedIds.has(id)) return;
      const p = pDict[id];
      const inst = p.instrumentId || p.instrument || id;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${inst} (Position) #${id}`;
      sel.appendChild(opt);
      addedIds.add(id);
    });
    const allIds = Array.from(addedIds);
    if(prev && allIds.includes(prev)){
      sel.value = prev;
    }else if(prev){
      log(`\u2139\uFE0F Order #${prev} is no longer open \u2014 dropdown reset`);
    }
  }

  // === FRAMEWORK CALLBACKS ===
  Framework.OnLoad = function(){
    setStatus("Framework responding", "ok");
    log("✅ Framework loaded.");

    // Enable buttons when framework is ready
    const buttonsToEnable = [
      "btnPing", "btnReqPrices", "btnHealth", "btnDiagRun",
      "btnPrices", "btnTicket", "btnBuyMarket", "btnSellMarket",
      "btnBuyTPSL", "btnSellTPSL", "btnChangeTPSL", "btnDumpTrades",
      "btnCloseAll", "btnCloseOne", "btnClearLog", "btnStrengthRun", "btnStrengthAuto",
      "btnStrengthStop", "btnRunBt", "btnClearBt", "btnAutoStart", "btnAutoStop",
      "btnHomeAutoStart", "btnHomeAutoStop", "btnLastSignals", "btnRefreshHome",
      "btnRefreshTool", "btnExportBt", "btnStopBt"
    ];
    
    buttonsToEnable.forEach((id)=>{
      if($(id)) $(id).disabled = false;
    });

    if($("btnPing")) $("btnPing").onclick = ()=>{
      log("Ping clicked.");
      log("RequestPrices exists " + (typeof Framework.RequestPrices === "function" ? "✅" : "❌"));
    };

    if($("btnReqPrices")) $("btnReqPrices").onclick = ()=>{
      const pairs = ($("pairs")?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,5);
      requestPrices(pairs);
      log("✅ RequestPrices sent for: " + pairs.join(", "));
    };

    if($("btnHealth")) $("btnHealth").onclick = ()=>{
      log("=== HEALTH CHECK ===");
      log("Candles API: " + ((Framework.pRequestCandles || Framework.RequestCandles)?"✅":"❌"));
      log("RequestPrices: " + (typeof Framework.RequestPrices === "function"?"✅":"❌"));
      log("SendOrder: " + (typeof Framework.SendOrder === "function"?"✅":"❌"));
      log("Orders: " + (Framework.Orders?"✅":"❌"));
      log("Positions: " + (Framework.Positions?"✅":"❌"));
      log("====================");
    };

    if($("btnDiagRun")) $("btnDiagRun").onclick = async ()=>{ setStatus("Running diagnostics…", "warn"); await runDiagnostics(); setStatus("Diagnostics done", "ok"); };
    if($("btnPrices")) $("btnPrices").onclick = ()=>{ requestPrices([selectedPair()]); refreshPx(); log(`🔁 Requested prices for ${selectedPair()}`); };
    if($("btnTicket")) $("btnTicket").onclick = ()=>openTicket(selectedPair());
    if($("btnBuyMarket")) $("btnBuyMarket").onclick = async ()=>{ try{ await sendMarket(selectedPair(), true, lots()); setStatus("BUY sent", "ok"); }catch(e){ setStatus("BUY failed", "bad"); log(`❌ BUY failed: ${e?.message || e}`);} };
    if($("btnSellMarket")) $("btnSellMarket").onclick = async ()=>{ try{ await sendMarket(selectedPair(), false, lots()); setStatus("SELL sent", "ok"); }catch(e){ setStatus("SELL failed", "bad"); log(`❌ SELL failed: ${e?.message || e}`);} };
    if($("btnBuyTPSL")) $("btnBuyTPSL").onclick = async ()=>{ 
      try{ 
        await placeMarketThenAttachTPSL(selectedPair(), true, lots(), tpPts(), slPts(), true); 
        setStatus("BUY TP/SL placed", "ok"); 
      }catch(e){ 
        setStatus("BUY TP/SL failed", "bad"); 
        log(`❌ BUY TP/SL failed: ${e?.message || e}`);
      } 
    };
    if($("btnSellTPSL")) $("btnSellTPSL").onclick = async ()=>{ 
      try{ 
        await placeMarketThenAttachTPSL(selectedPair(), false, lots(), tpPts(), slPts(), true); 
        setStatus("SELL TP/SL placed", "ok"); 
      }catch(e){ 
        setStatus("SELL TP/SL failed", "bad"); 
        log(`❌ SELL TP/SL failed: ${e?.message || e}`);
      } 
    };
    if($("btnChangeTPSL")) $("btnChangeTPSL").onclick = async ()=>{
      const oid = ($("toolOrderId")?.value || "").trim();
      if(!oid){ log("❌ Enter orderId first"); return; }
      const ord = ordersDict()[oid];
      const isBuy = !(ord && ord.orderType === 2);
      try{ await changeOrderTPSLFromDistance(oid, selectedPair(), isBuy, tpPts(), slPts()); setStatus("CHANGE sent", "ok"); }
      catch(e){ setStatus("CHANGE failed", "bad"); log(`❌ CHANGE failed: ${e?.message || e}`);} 
    };
    if($("btnDumpTrades")) $("btnDumpTrades").onclick = dumpOpenTrades;
    if($("btnCloseAll")) $("btnCloseAll").onclick = async ()=>{ try{ await closeAllForInstrument(selectedPair()); setStatus("Close sent", "ok"); }catch(e){ setStatus("Close failed", "bad"); log(`❌ Close failed: ${e?.message || e}`);} };
    if($("btnCloseOne")) $("btnCloseOne").onclick = async ()=>{
      const oid = ($("toolOrderId")?.value || "").trim();
      if(!oid){ log("❌ Enter Order ID first"); return; }
      try{ await closeOrderById(oid); setStatus("Close One sent", "ok"); }
      catch(e){ setStatus("Close One failed", "bad"); log(`❌ Close One failed: ${e?.message || e}`); }
    };

    if($("btnRefreshTool")) $("btnRefreshTool").onclick = async ()=>{ await safeRefreshMarket(); };
    if($("btnRefreshHome")) $("btnRefreshHome").onclick = async ()=>{ await safeRefreshMarket(); };
    if($("btnClearLog")) $("btnClearLog").onclick = ()=>{ $("log").textContent=""; };

    // Home tab AutoTrader proxies
    if($("btnHomeAutoStart")) $("btnHomeAutoStart").onclick = ()=>{ window.ENG?.AutoTrader?.start?.(); };
    if($("btnHomeAutoStop")) $("btnHomeAutoStop").onclick = ()=>{ window.ENG?.AutoTrader?.stop?.(); };

    // Order ID dropdown refresh
    if($("btnRefreshOrders")) $("btnRefreshOrders").onclick = ()=>{ populateOrderDropdown(); };

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

    // Populate and auto-refresh the order dropdown every 5 seconds
    populateOrderDropdown();
    window.LC._orderDropdownInterval = setInterval(populateOrderDropdown, 5000);
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
  window.LC.populateOrderDropdown = populateOrderDropdown;

  window.LC.api = {
    safeJson,
    market: getMarket,
    requestPrices,
    openDealTicket: openTicket,
    sendMarketOrder: (instrumentId, isBuy, lotSize)=>sendMarket(instrumentId, !!isBuy, Number(lotSize || 0.01)),
    sendMarketOrderWithTPSL: (instrumentId, isBuy, lotSize, tpAbsPrice, slAbsPrice)=>sendWithTPSL(instrumentId, !!isBuy, Number(lotSize || 0.01), Number(tpAbsPrice || 0), Number(slAbsPrice || 0)),
    dumpOpenTradeSources: dumpOpenTrades,
    changeOrderTPSL,
    attachTPSLViaChange,
    placeMarketThenAttachTPSL,
    closeAllPositions,
    closeOrderById,
    dumpOrderTypes,
    pRequestCandles: requestCandles
  };

  // === BACKTEST API ===
  // LCBacktestAPI provides historical data slices for backtesting
  // It implements the same interface as live LC API but returns data truncated at simulated "now"
  class LCBacktestAPI {
    constructor(){
      this.historicalData = {}; // { pair: { tf: candles[] } }
      this.simulatedNow = null;
      this.instrumentMetadata = this._initInstrumentMetadata();
    }

    _initInstrumentMetadata(){
      // Instrument metadata: pip size, typical spread, commission per lot
      const metadata = {};
      
      // Major pairs (non-JPY)
      ["EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD", "EUR/GBP"].forEach((pair)=>{
        metadata[pair] = { pipSize: 0.0001, typicalSpread: 0.00015, commission: 0 };
      });
      
      // JPY pairs
      ["USD/JPY", "EUR/JPY", "GBP/JPY", "AUD/JPY", "NZD/JPY", "CAD/JPY", "CHF/JPY"].forEach((pair)=>{
        metadata[pair] = { pipSize: 0.01, typicalSpread: 0.015, commission: 0 };
      });
      
      // CHF and CAD pairs
      ["USD/CAD", "USD/CHF", "EUR/CAD", "EUR/CHF", "GBP/CAD", "GBP/CHF"].forEach((pair)=>{
        metadata[pair] = { pipSize: 0.0001, typicalSpread: 0.0002, commission: 0 };
      });
      
      // Crosses
      ["AUD/NZD", "AUD/CAD", "NZD/CAD", "EUR/AUD", "EUR/NZD", "GBP/AUD", "GBP/NZD"].forEach((pair)=>{
        metadata[pair] = { pipSize: 0.0001, typicalSpread: 0.0003, commission: 0 };
      });
      
      // Indices (points-based, not pips)
      ["NAS100", "US30", "SPX500", "GER40", "UK100", "JPN225"].forEach((pair)=>{
        metadata[pair] = { pipSize: 1, typicalSpread: 2, commission: 0 };
      });
      
      return metadata;
    }

    // Load historical data for a pair and timeframe
    async loadHistoricalData(pair, timeframe, candles){
      if(!this.historicalData[pair]) this.historicalData[pair] = {};
      this.historicalData[pair][timeframe] = candles || [];
    }

    // Set simulated current time
    setSimulatedNow(timestamp){
      this.simulatedNow = timestamp;
    }

    // Request candles truncated at simulated "now"
    async requestCandles(pair, timeframe, count){
      const tfSec = this._tfToSeconds(timeframe);
      const allCandles = this.historicalData[pair]?.[tfSec] || [];
      
      if(allCandles.length === 0) return { candles: [] };
      
      // Filter candles up to simulated "now"
      let filtered = allCandles;
      if(this.simulatedNow !== null){
        filtered = allCandles.filter((c)=>{
          const t = this._candleTime(c);
          return t <= this.simulatedNow;
        });
      }
      
      // Return last 'count' candles
      const start = Math.max(0, filtered.length - count);
      const slice = filtered.slice(start);
      
      return { candles: slice };
    }

    // Request prices (simulated bid/ask from last candle close)
    async requestPrices(pairs){
      const prices = {};
      
      for(const pair of pairs){
        const meta = this.instrumentMetadata[pair] || { pipSize: 0.0001, typicalSpread: 0.00015 };
        
        // Get last available candle close as mid price
        let mid = null;
        const pairData = this.historicalData[pair];
        
        if(pairData){
          // Use smallest available timeframe for most recent price
          const tfs = Object.keys(pairData).map(Number).sort((a, b)=>a - b);
          for(const tf of tfs){
            const candles = pairData[tf] || [];
            const filtered = this.simulatedNow !== null 
              ? candles.filter((c)=>this._candleTime(c) <= this.simulatedNow)
              : candles;
            
            if(filtered.length > 0){
              mid = filtered[filtered.length - 1].c;
              break;
            }
          }
        }
        
        if(mid === null || !Number.isFinite(mid)){
          prices[pair] = { bid: 0, ask: 0, mid: 0 };
          continue;
        }
        
        const halfSpread = meta.typicalSpread / 2;
        prices[pair] = {
          bid: mid - halfSpread,
          ask: mid + halfSpread,
          mid
        };
      }
      
      return prices;
    }

    // Get market data for a pair (simulated)
    market(pair){
      // Synchronous version - get last known price
      const meta = this.instrumentMetadata[pair] || { pipSize: 0.0001, typicalSpread: 0.00015 };
      
      let mid = null;
      const pairData = this.historicalData[pair];
      
      if(pairData){
        const tfs = Object.keys(pairData).map(Number).sort((a, b)=>a - b);
        for(const tf of tfs){
          const candles = pairData[tf] || [];
          const filtered = this.simulatedNow !== null 
            ? candles.filter((c)=>this._candleTime(c) <= this.simulatedNow)
            : candles;
          
          if(filtered.length > 0){
            mid = filtered[filtered.length - 1].c;
            break;
          }
        }
      }
      
      if(mid === null || !Number.isFinite(mid)){
        return { bid: 0, ask: 0, mid: 0 };
      }
      
      const halfSpread = meta.typicalSpread / 2;
      return {
        bid: mid - halfSpread,
        ask: mid + halfSpread,
        mid
      };
    }

    // Get instrument metadata
    getMetadata(pair){
      return this.instrumentMetadata[pair] || { pipSize: 0.0001, typicalSpread: 0.00015, commission: 0 };
    }

    // Convert timeframe string to seconds
    _tfToSeconds(tf){
      if(typeof tf === "number") return tf;
      const str = String(tf).toUpperCase();
      if(str === "M1") return 60;
      if(str === "M5") return 300;
      if(str === "M15") return 900;
      if(str === "M30") return 1800;
      if(str === "H1") return 3600;
      if(str === "H4") return 14400;
      if(str === "D1") return 86400;
      return 900; // Default M15
    }

    // Get candle timestamp
    _candleTime(candle){
      const t = candle.t || candle.time || candle.Time || candle.timestamp || candle.Timestamp || 0;
      // Convert to milliseconds if needed
      return t < 1e12 ? t * 1000 : t;
    }
  }

  window.LC.LCBacktestAPI = LCBacktestAPI;
})();
