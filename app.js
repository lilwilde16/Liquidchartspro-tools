// LiquidChartsPro Tools (GitHub Pages build)
(function(){
  const el = (id)=>document.getElementById(id);

  // UI shell (kept minimal here — we can paste your full 3-tab UI next)
  function renderShell(){
    el("app").innerHTML = `
      <div class="tabs">
        <button class="tabBtn active" id="tabHome">Home</button>
        <button class="tabBtn" id="tabSettings">Settings</button>
        <button class="tabBtn" id="tabTools">Tools</button>
      </div>

      <div id="pageHome">
        <div class="card">
          <div class="title">Currency Strength Meter</div>
          <div class="row">
            <div class="field">
              <label>Status</label>
              <div class="pill warn" id="statusPill">Not connected</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="title">Output</div>
          <div id="output" class="small">Waiting…</div>
        </div>
      </div>

      <div id="pageSettings" class="hidden">
        <div class="card">
          <div class="title">Settings</div>
          <div class="small">We’ll place your meter settings here.</div>
        </div>
      </div>

      <div id="pageTools" class="hidden">
        <div class="card">
          <div class="title">Tools / Diagnostic</div>
          <div class="row">
            <button id="btnHealth">Health Check</button>
            <button id="btnClearLog">Clear Log</button>
          </div>
        </div>
        <div class="card">
          <div class="title">Log</div>
          <div id="log"></div>
        </div>
      </div>
    `;
  }

  function ts(){
    const d=new Date(), pad=n=>(n<10?"0":"")+n;
    let h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
    const ampm=h>=12?"PM":"AM"; h=h%12; if(h===0) h=12;
    return `[${h}:${pad(m)}:${pad(s)} ${ampm}]`;
  }
  function log(msg){
    const lg = el("log");
    if(!lg) return;
    lg.textContent = `${ts()} ${msg}\n` + lg.textContent;
  }
  function setStatus(text, kind){
    const pill = el("statusPill");
    if(!pill) return;
    pill.textContent = text;
    pill.className = `pill ${kind||""}`;
  }

  function setTab(which){
    ["tabHome","tabSettings","tabTools"].forEach(id=>el(id)?.classList.remove("active"));
    ["pageHome","pageSettings","pageTools"].forEach(id=>el(id)?.classList.add("hidden"));

    if(which==="home"){ el("tabHome").classList.add("active"); el("pageHome").classList.remove("hidden"); }
    if(which==="settings"){ el("tabSettings").classList.add("active"); el("pageSettings").classList.remove("hidden"); }
    if(which==="tools"){ el("tabTools").classList.add("active"); el("pageTools").classList.remove("hidden"); }
  }

  // ---- Framework bootstrap
  renderShell();

  console.log("hey");

  let Framework = null;
  try {
    Framework = new Sway.Framework();
  } catch (e) {
    setStatus("Framework load failed", "bad");
    log("❌ Could not create Sway.Framework(): " + (e.message||String(e)));
    return;
  }

  // Buttons + tabs
  el("tabHome").onclick = ()=>setTab("home");
  el("tabSettings").onclick = ()=>setTab("settings");
  el("tabTools").onclick = ()=>setTab("tools");

  el("btnClearLog").onclick = ()=>{ el("log").textContent=""; };

  el("btnHealth").onclick = ()=>{
    try{
      const hasCandles = !!(Framework.pRequestCandles || Framework.RequestCandles);
      const hasPrices = typeof Framework.RequestPrices === "function";
      const hasSendOrder = typeof Framework.SendOrder === "function";
      log("=== HEALTH CHECK ===");
      log("Candles API: " + (hasCandles?"✅":"❌"));
      log("RequestPrices: " + (hasPrices?"✅":"❌"));
      log("SendOrder: " + (hasSendOrder?"✅":"❌"));
      log("====================");
    }catch(e){
      log("❌ Health error: " + (e.message||String(e)));
    }
  };

  // IMPORTANT: LiquidCharts triggers this when connected
  Framework.OnLoad = function(){
    setStatus("Connected", "ok");
    log("✅ Framework loaded");

    // ---- DROP YOUR WORKING METER LOGIC HERE NEXT ----
    // We’ll paste your RSI7 currency strength engine + ranking + best 3 buy/sell pairs here.
    el("output").textContent = "Connected. Ready to paste full meter logic.";
  };

})();
