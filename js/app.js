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

    const SETTINGS_KEY = "lc_settings_v1";
    const settingsFields = ["pairs"];

    window.getSettings = () => {
      try {
        return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
      } catch (e) {
        console.warn("Settings: failed to parse localStorage", e);
        return {};
      }
    };

    window.setSettings = (partial = {}) => {
      const current = window.getSettings();
      const next = { ...current, ...partial };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    };

    window.applySettingsToUI = () => {
      const s = window.getSettings();
      settingsFields.forEach((id) => {
        const el = $(id);
        if (!el) {
          console.warn(`Settings: missing element #${id}`);
          return;
        }
        if (s[id] !== undefined) el.value = s[id];
      });
      
      // Prefill pairs with majors if not already set
      const pairsEl = $("pairs");
      if (pairsEl && (!s.pairs || s.pairs.trim() === "")) {
        const defaultPairs = "EUR/USD\nGBP/USD\nUSD/JPY\nAUD/USD\nNZD/USD\nUSD/CAD\nUSD/CHF\nEUR/GBP\nEUR/JPY\nGBP/JPY";
        pairsEl.value = defaultPairs;
        window.setSettings({ pairs: defaultPairs });
      }
    };

    window.readUIToSettings = () => {
      const out = {};
      settingsFields.forEach((id) => {
        const el = $(id);
        if (!el) {
          console.warn(`Settings: missing element #${id}`);
          return;
        }
        out[id] = el.value;
      });
      return out;
    };

    const status = $("settingsStatus");
    const saveBtn = $("saveSettings");
    const showSaved = () => {
      if (status) status.textContent = "Saved.";
      if (status) setTimeout(() => { status.textContent = ""; }, 1200);
    };

    if (saveBtn) {
      saveBtn.onclick = () => {
        window.setSettings(window.readUIToSettings());
        showSaved();
      };
    } else {
      console.warn("Settings: missing #saveSettings");
    }

    let saveTimer = null;
    settingsFields.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          window.setSettings(window.readUIToSettings());
          showSaved();
        }, 300);
      });
    });

    window.applySettingsToUI();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  }else{
    ready();
  }
})();