(function(){
  const $ = (id)=>document.getElementById(id);
  
  // Default major currency pairs for first-time users
  const DEFAULT_PAIRS = "EUR/USD\nGBP/USD\nUSD/JPY\nAUD/USD\nNZD/USD\nUSD/CAD\nUSD/CHF\nEUR/GBP\nEUR/JPY\nGBP/JPY";

  // === GOALS PERSISTENCE ===
  const GOALS_KEY = "lc_goals_v1";

  function loadGoals(){
    try{ return JSON.parse(localStorage.getItem(GOALS_KEY) || "{}") || {}; }catch(_){ return {}; }
  }

  function saveGoals(goals){
    try{ localStorage.setItem(GOALS_KEY, JSON.stringify(goals)); }catch(_){ }
  }

  // === HOME TAB DISPLAY ===
  function updateHomeDisplay(){
    // Strategy name
    const preset = $("btStrategyPreset");
    const nameEl = $("homeStrategyName");
    if(nameEl){
      const selected = preset?.options[preset?.selectedIndex]?.text || "";
      nameEl.textContent = selected || "No strategy selected \u2014 go to Strategy tab to choose one";
    }

    // Pairs list
    const pairsEl = $("pairs");
    const listEl = $("homePairsList");
    if(listEl && pairsEl){
      const pairs = pairsEl.value.split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
      if(pairs.length === 0){
        listEl.textContent = "No pairs configured \u2014 add pairs in Strategy tab";
      }else{
        listEl.innerHTML = pairs.map((p)=>`<span class="pairTag">${p}</span>`).join(" ");
      }
    }
  }

  function collectMarkets(){
    const defaults = [
      "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "NZD/USD",
      "USD/CAD", "EUR/GBP", "EUR/JPY", "GBP/JPY", "AUD/JPY", "NAS100", "US30", "SPX500"
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
    // Apply strategy settings to the live strategy settings inputs
    if($("stratFastMa") && Number.isFinite(Number(d.fastMa))) $("stratFastMa").value = String(d.fastMa);
    if($("stratSlowMa") && Number.isFinite(Number(d.slowMa))) $("stratSlowMa").value = String(d.slowMa);
    if($("stratAtrLen") && Number.isFinite(Number(d.atrLen))) $("stratAtrLen").value = String(d.atrLen);
    // Also apply to backtest fields for consistency
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
    if($("btStrategy-display")) $("btStrategy-display").textContent = strategy.description;
    syncSessionInputs();
    updateHomeDisplay();
  }

  function populateStrategyDropdown(){
    const select = $("btStrategyPreset");
    const registry = window.STRATEGIES;
    if(!select || !registry || !Array.isArray(registry.list) || registry.list.length === 0) return;

    const prev = select.value;
    select.innerHTML = registry.list.map((s)=>`<option value="${s.id}">${s.name}</option>`).join("");
    select.value = (prev && registry.byId[prev]) ? prev : registry.list[0].id;

    // Show description preview on change, but do NOT apply until Confirm is clicked
    select.onchange = ()=>{
      const s = registry.byId[select.value];
      if($("btStrategy-display")) $("btStrategy-display").textContent = s ? s.description : "";
      if($("btStrategy")) $("btStrategy").value = s ? s.description : "";
    };

    // Apply the default strategy on initial load
    applyStrategyToForm(registry.byId[select.value]);
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
      if($("btnExportBt")) $("btnExportBt").onclick = ()=>window.ENG.Backtest.exportResults();
      window.ENG.Backtest.syncLossRate();
    }

    if(window.ENG?.AutoTrader){
      if(typeof window.ENG.AutoTrader.init === "function") window.ENG.AutoTrader.init();
    }

    populateBacktestMarkets();
    populateStrategyDropdown();
    initBacktestDateDefaults();
    syncSessionInputs();

    if($("pairs")) $("pairs").addEventListener("change", ()=>{ populateBacktestMarkets(); updateHomeDisplay(); });
    if($("btSession")) $("btSession").addEventListener("change", syncSessionInputs);

    window.LC = window.LC || {};
    window.LC.refreshBacktestMarkets = populateBacktestMarkets;
    window.LC.refreshBacktestStrategies = populateStrategyDropdown;

    // === CONFIRM STRATEGY BUTTON ===
    if($("btnConfirmStrategy")){
      $("btnConfirmStrategy").onclick = ()=>{
        const select = $("btStrategyPreset");
        const registry = window.STRATEGIES;
        const strategy = registry?.byId?.[select?.value];
        if(strategy){
          applyStrategyToForm(strategy);
          const s = $("strategyConfirmStatus");
          if(s){ s.textContent = "\u2714 Strategy confirmed!"; setTimeout(()=>{ s.textContent = ""; }, 2000); }
        }
      };
    }

    // === ARM SYNC: homeArm ↔ toolArm ===
    const homeArmEl = $("homeArm");
    const toolArmEl = $("toolArm");
    if(homeArmEl && toolArmEl){
      homeArmEl.value = toolArmEl.value;
      homeArmEl.addEventListener("change", ()=>{ toolArmEl.value = homeArmEl.value; });
      toolArmEl.addEventListener("change", ()=>{ homeArmEl.value = toolArmEl.value; });
    }

    // === PROFIT GOALS ===
    const goals = loadGoals();
    if($("goalDaily") && goals.daily != null) $("goalDaily").value = goals.daily;
    if($("goalWeekly") && goals.weekly != null) $("goalWeekly").value = goals.weekly;

    if($("btnSaveGoals")){
      $("btnSaveGoals").onclick = ()=>{
        saveGoals({
          daily: Number($("goalDaily")?.value || 0),
          weekly: Number($("goalWeekly")?.value || 0)
        });
        const s = $("goalsStatus");
        if(s){ s.textContent = "Saved!"; setTimeout(()=>{ s.textContent = ""; }, 1500); }
      };
    }

    // === COPY LOG ===
    if($("btnCopyLog")){
      $("btnCopyLog").onclick = ()=>{
        const logEl = $("log");
        if(!logEl) return;
        const text = logEl.textContent;
        if(navigator.clipboard){
          navigator.clipboard.writeText(text).catch(()=>fallbackCopy(text));
        }else{
          fallbackCopy(text);
        }
        const btn = $("btnCopyLog");
        if(btn){ btn.textContent = "\u2714 Copied!"; setTimeout(()=>{ btn.textContent = "\uD83D\uDCCB Copy Log"; }, 2000); }
      };
    }

    function fallbackCopy(text){
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      ta.setAttribute("aria-hidden", "true");
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand("copy"); }catch(_){}
      document.body.removeChild(ta);
    }

    function isJPYPair(pair){ return String(pair).includes("JPY"); }

    // === LAST 5 SIGNALS (SMA Crossover history scan) ===
    if($("btnLastSignals")){
      $("btnLastSignals").onclick = async ()=>{
        const btn = $("btnLastSignals");
        const resultBox = $("lastSignalsResult");
        if(!resultBox) return;

        btn.disabled = true;
        btn.textContent = "Scanning\u2026";
        resultBox.innerHTML = "<p>Scanning all pairs for SMA crossover signals\u2026</p>";
        resultBox.classList.remove("hidden");

        try{
          if(!window.ENG?.AutoTrader?.scanCrossoverSignals){
            resultBox.innerHTML = "<p>\u274C AutoTrader engine not available. Ensure all scripts are loaded.</p>";
            return;
          }
          const scanTime = new Date().toLocaleTimeString();
          const signals = await window.ENG.AutoTrader.scanCrossoverSignals(5);

          if(signals.length === 0){
            resultBox.innerHTML = "<p>No pairs returned data. Check that pairs are configured and the platform has live data.</p>";
            return;
          }

          const fastMa = parseInt($("stratFastMa")?.value || "10", 10);
          const slowMa = parseInt($("stratSlowMa")?.value || "30", 10);
          const tf = $("atTf")?.value || "M15";

          resultBox.innerHTML = `<p class="note" style="margin-bottom:8px">Last 5 SMA(${fastMa})/SMA(${slowMa}) crossover signals on <strong>${tf}</strong> &mdash; scan at ${scanTime}</p>` +
            signals.map((r, i)=>{
              const dirLabel = r.dir === 1 ? "<span class='sig-buy' aria-label='BUY signal'>\uD83D\uDFE2 BUY</span>" :
                               "<span class='sig-sell' aria-label='SELL signal'>\uD83D\uDD34 SELL</span>";
              const price = Number.isFinite(r.price) ? r.price.toFixed(isJPYPair(r.pair) ? 3 : 5) : "\u2014";
              const timeStr = r.t ? new Date(r.t).toLocaleString() : `${r.candlesAgo} candle(s) ago`;
              return `<div class="signalCard">
                <span class="sigRank" aria-label="Rank ${i+1}">${i+1}</span>
                <strong>${r.pair}</strong> ${dirLabel}
                <span class="sigPrice">Price: <b>${price}</b></span>
                <span class="sigTime">When: ${timeStr}</span>
              </div>`;
            }).join("");

        }catch(e){
          resultBox.innerHTML = `<p>\u274C Scan failed: ${e?.message || e}</p>`;
        }finally{
          btn.disabled = false;
          btn.textContent = "\uD83D\uDD0D Show Last 5 Signals (by Pair)";
        }
      };
    }

    // === SETTINGS (pairs) ===
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
      
      // Prefill pairs with defaults if empty on first load
      const pairsEl = $("pairs");
      if(pairsEl && (!s.pairs || s.pairs.trim() === "")){
        pairsEl.value = DEFAULT_PAIRS;
        window.setSettings({ pairs: DEFAULT_PAIRS });
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
        updateHomeDisplay();
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
    updateHomeDisplay();
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  }else{
    ready();
  }
})();