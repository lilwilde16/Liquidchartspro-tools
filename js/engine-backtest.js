(function(){
  const $ = (id)=>document.getElementById(id);

  let stopFlag = false;

  function parsePairs(){
    return ($("pairs").value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  }

  function parseStrategy(){
    try{ return JSON.parse($("btStrategy").value); }
    catch(e){ return { error: "Invalid JSON: " + (e.message||String(e)) }; }
  }

  function renderSummary(text){
    $("btSummary").innerHTML = text;
  }

  async function run(){
    stopFlag = false;
    $("btnStopBt").disabled = false;
    $("btnRunBt").disabled = true;

    const strat = parseStrategy();
    if(strat.error){
      window.LC.setStatus("Backtest error", "bad");
      window.LC.log("❌ " + strat.error);
      $("btnRunBt").disabled = false;
      $("btnStopBt").disabled = true;
      return;
    }

    const tf = Number($("btTf").value);
    const count = Number($("btCount").value||2000);
    const instruments = parsePairs();

    window.LC.setStatus("Backtesting…", "warn");
    window.LC.log(`▶ Backtest start tf=${tf} count=${count} instruments=${instruments.length}`);

    // TODO: put your backtest logic here (we can paste your current engine)
    renderSummary(`Ran ${instruments.length} instruments (engine skeleton).`);

    window.LC.setStatus("Backtest done", "ok");
    $("btnRunBt").disabled = false;
    $("btnStopBt").disabled = true;
  }

  function stop(){
    stopFlag = true;
    window.LC.setStatus("Stopping…", "warn");
  }

  function clear(){
    $("btSummary").textContent = "No results yet.";
    $("btTrades").innerHTML = "";
  }

  window.ENG = window.ENG || {};
  window.ENG.Backtest = { run, stop, clear };
})();
