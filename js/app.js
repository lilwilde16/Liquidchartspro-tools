(function(){
  const $ = (id)=>document.getElementById(id);

  function collectMarkets(){
    const defaults = [
      "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
      "USD/CAD", "EUR/GBP", "EUR/JPY", "GBP/JPY", "AUD/JPY", "NAS100", "US30"
    ];

    const set = new Set(defaults);
    const ctx = ($("ctxInstrument")?.value || "").trim();
    if(ctx && ctx !== "Unknown") set.add(ctx);

    const pairs = ($("pairs")?.value || "")
      .split(/\r?\n/)
      .map((s)=>s.trim())
      .filter(Boolean);

    pairs.forEach((p)=>set.add(p));
    return Array.from(set);
  }

  function populateBacktestMarkets(){
    const select = $("btInstrument");
    if(!select) return;

    const markets = collectMarkets();
    const prev = select.value;
    select.innerHTML = markets.map((m)=>`<option value="${m}">${m}</option>`).join("");
    select.value = (prev && markets.includes(prev)) ? prev : markets[0];
  }

  function applyStrategyToForm(strategy){
    if(!strategy) return;
    const d = strategy.defaults || {};
    if($("btFastMa") && Number.isFinite(Number(d.fastMa))) $("btFastMa").value = String(d.fastMa);
    if($("btSlowMa") && Number.isFinite(Number(d.slowMa))) $("btSlowMa").value = String(d.slowMa);
    if($("btAtrLen") && Number.isFinite(Number(d.atrLen))) $("btAtrLen").value = String(d.atrLen);
    if($("btRr") && Number.isFinite(Number(d.rr))) $("btRr").value = String(d.rr);
    if($("btSlAtr") && Number.isFinite(Number(d.slAtr))) $("btSlAtr").value = String(d.slAtr);
    if($("btAllowShort") && d.allowShort) $("btAllowShort").value = d.allowShort;
    if($("btTf") && d.timeframe) $("btTf").value = d.timeframe;
    if($("btSession") && d.session) $("btSession").value = d.session;
    if($("btCount") && Number.isFinite(Number(d.count))) $("btCount").value = String(d.count);
    if($("btStrategy")) $("btStrategy").value = strategy.description;
    syncSessionInputs();
  }

  function populateStrategyDropdown(){
    const select = $("btStrategyPreset");
    const registry = window.STRATEGIES;
    if(!select || !registry || !Array.isArray(registry.list) || registry.list.length === 0) return;

    const prev = select.value;
    select.innerHTML = registry.list.map((s)=>`<option value="${s.id}">${s.name}</option>`).join("");
    select.value = (prev && registry.byId[prev]) ? prev : registry.list[0].id;
    applyStrategyToForm(registry.byId[select.value]);

    select.onchange = ()=>applyStrategyToForm(registry.byId[select.value]);
  }


  function initBacktestDateDefaults(){
    const end = new Date();
    const start = new Date(end.getTime() - (1000 * 60 * 60 * 24 * 30));
    const fmt = (d)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
    if($("btStartDate") && !$("btStartDate").value) $("btStartDate").value = fmt(start);
    if($("btEndDate") && !$("btEndDate").value) $("btEndDate").value = fmt(end);
  }

  function syncSessionInputs(){
    const session = $("btSession")?.value || "all";
    const sh = $("btStartHour");
    const eh = $("btEndHour");
    if(!sh || !eh) return;

    if(session === "london"){
      sh.value = "7";
      eh.value = "16";
      sh.readOnly = true;
      eh.readOnly = true;
    }else if(session === "newyork"){
      sh.value = "12";
      eh.value = "21";
      sh.readOnly = true;
      eh.readOnly = true;
    }else if(session === "all"){
      sh.value = "0";
      eh.value = "23";
      sh.readOnly = true;
      eh.readOnly = true;
    }else{
      sh.readOnly = false;
      eh.readOnly = false;
    }
  }

  function ready(){
    if(window.ENG?.Strength && $("btnStrengthRun")){
      $("btnStrengthRun").onclick = ()=>window.ENG.Strength.run();
      if(typeof window.ENG.Strength.init === "function") window.ENG.Strength.init();
    }

    if(window.ENG?.Backtest){
      if($("btnRunBt")) $("btnRunBt").onclick = ()=>window.ENG.Backtest.run();
      if($("btnStopBt")) $("btnStopBt").onclick = ()=>window.ENG.Backtest.stop();
      if($("btnClearBt")) $("btnClearBt").onclick = ()=>window.ENG.Backtest.clear();
      window.ENG.Backtest.syncLossRate();
    }

    if(window.ENG?.AutoTrader){
      if(typeof window.ENG.AutoTrader.init === "function") window.ENG.AutoTrader.init();
    }

    populateBacktestMarkets();
    populateStrategyDropdown();
    initBacktestDateDefaults();
    syncSessionInputs();

    if($("pairs")) $("pairs").addEventListener("change", populateBacktestMarkets);
    if($("btSession")) $("btSession").addEventListener("change", syncSessionInputs);

    window.LC = window.LC || {};
    window.LC.refreshBacktestMarkets = populateBacktestMarkets;
    window.LC.refreshBacktestStrategies = populateStrategyDropdown;
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  }else{
    ready();
  }
})();
