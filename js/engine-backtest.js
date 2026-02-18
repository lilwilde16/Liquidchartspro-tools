(function(){
  const $ = (id)=>document.getElementById(id);
  const MAX_ROWS = 300;
  let stopFlag = false;
  let lastResults = null;

  function toNum(v, fallback = 0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function syncLossRate(){
    // Backward compatibility for older wiring.
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw) ? raw : (raw.candles || raw.Candles || raw.data || raw.Data || null);

    if(Array.isArray(src)){
      const rows = src.map((c)=>({
        t: Number(c?.time ?? c?.Time ?? c?.timestamp ?? c?.Timestamp ?? c?.t ?? 0),
        o: Number(c?.open ?? c?.Open ?? c?.o),
        h: Number(c?.high ?? c?.High ?? c?.h),
        l: Number(c?.low ?? c?.Low ?? c?.l),
        c: Number(c?.close ?? c?.Close ?? c?.c)
      })).filter((r)=>Number.isFinite(r.o) && Number.isFinite(r.h) && Number.isFinite(r.l) && Number.isFinite(r.c));

      if(rows.length > 1 && rows[0].t && rows[rows.length - 1].t && rows[0].t > rows[rows.length - 1].t) rows.reverse();
      return rows;
    }

    const o = raw.open || raw.Open || raw.o;
    const h = raw.high || raw.High || raw.h;
    const l = raw.low || raw.Low || raw.l;
    const c = raw.close || raw.Close || raw.c;
    const t = raw.time || raw.Time || raw.timestamp || raw.Timestamp || [];
    if(Array.isArray(o) && Array.isArray(h) && Array.isArray(l) && Array.isArray(c)){
      const n = Math.min(o.length, h.length, l.length, c.length);
      const rows = [];
      for(let i = 0; i < n; i++){
        const row = { t: Number(t[i] ?? 0), o: Number(o[i]), h: Number(h[i]), l: Number(l[i]), c: Number(c[i]) };
        if(Number.isFinite(row.o) && Number.isFinite(row.h) && Number.isFinite(row.l) && Number.isFinite(row.c)) rows.push(row);
      }
      if(rows.length > 1 && rows[0].t && rows[rows.length - 1].t && rows[0].t > rows[rows.length - 1].t) rows.reverse();
      return rows;
    }

    return [];
  }

  function candleTimeMs(t){
    if(!Number.isFinite(t) || t <= 0) return NaN;
    return t < 1e12 ? t * 1000 : t;
  }

  function inHourWindow(hour, startHour, endHour){
    if(startHour <= endHour) return hour >= startHour && hour <= endHour;
    return hour >= startHour || hour <= endHour;
  }

  function sessionHours(session){
    if(session === "london") return { startHour: 7, endHour: 16, label: "London" };
    if(session === "newyork") return { startHour: 12, endHour: 21, label: "New York" };
    return null;
  }

  function applyDateSessionFilter(candles, cfg){
    const startDateMs = cfg.startDate ? Date.parse(`${cfg.startDate}T00:00:00Z`) : null;
    const endDateMs = cfg.endDate ? Date.parse(`${cfg.endDate}T23:59:59Z`) : null;
    const sessionCfg = sessionHours(cfg.session);
    const startHour = sessionCfg ? sessionCfg.startHour : cfg.startHour;
    const endHour = sessionCfg ? sessionCfg.endHour : cfg.endHour;

    let missingTs = 0;
    const filtered = candles.filter((c)=>{
      const ms = candleTimeMs(c.t);
      if(!Number.isFinite(ms)){
        missingTs += 1;
        return cfg.session === "all" && !cfg.startDate && !cfg.endDate;
      }
      if(Number.isFinite(startDateMs) && ms < startDateMs) return false;
      if(Number.isFinite(endDateMs) && ms > endDateMs) return false;
      const d = new Date(ms);
      const hour = d.getUTCHours();
      return inHourWindow(hour, startHour, endHour);
    });

    const requestedFilter = cfg.session !== "all" || !!cfg.startDate || !!cfg.endDate;
    if(missingTs > 0 && requestedFilter){
      return {
        candles,
        sessionLabel: "All hours (timestamp fallback)",
        missingTs,
        fallbackUsed: true
      };
    }

    return {
      candles: filtered,
      sessionLabel: sessionCfg ? sessionCfg.label : (cfg.session === "all" ? "All hours" : `Custom ${startHour}:00-${endHour}:59 UTC`),
      missingTs,
      fallbackUsed: false
    };
  }

  function validateInputs(){
    const instrument = ($("btInstrument")?.value || "").trim();
    const timeframe = $("btTf")?.value;
    const strategyId = ($("btStrategyPreset")?.value || "sma_crossover").trim();
    const strategyDef = window.STRATEGIES?.byId?.[strategyId];
    const rules = ($("btStrategy")?.value || "").trim();
    const trades = Math.floor(toNum($("btCount")?.value));
    const rr = toNum($("btRr")?.value, 1);
    const startBalance = toNum($("btStartBalance")?.value);
    const riskPct = toNum($("btRiskPct")?.value);
    const costR = toNum($("btCostR")?.value, 0);
    const slAtr = toNum($("btSlAtr")?.value, 1);
    const candleCount = Math.floor(toNum($("btCandleCount")?.value, 2500));
    const allowShort = ($("btAllowShort")?.value || "yes") === "yes";

    const session = ($("btSession")?.value || "all").trim();
    const conflictModel = ($("btConflictModel")?.value || "conservative").trim();
    const startDate = ($("btStartDate")?.value || "").trim();
    const endDate = ($("btEndDate")?.value || "").trim();
    const startHour = Math.floor(toNum($("btStartHour")?.value, 0));
    const endHour = Math.floor(toNum($("btEndHour")?.value, 23));

    const fastLen = Math.floor(toNum($("btFastMa")?.value, strategyDef?.defaults?.fastMa || 10));
    const slowLen = Math.floor(toNum($("btSlowMa")?.value, strategyDef?.defaults?.slowMa || 30));
    const atrLen = Math.floor(toNum($("btAtrLen")?.value, strategyDef?.defaults?.atrLen || 14));

    if(!instrument) return { error: "Please choose a market/instrument from the selector." };
    if(!timeframe) return { error: "Timeframe is required." };
    if(!strategyDef) return { error: "Please choose a strategy." };
    if(!rules) return { error: "Strategy rules are required." };
    if(!Number.isFinite(trades) || trades < 5 || trades > 5000) return { error: "Trade count must be between 5 and 5000." };
    if(!Number.isFinite(rr) || rr <= 0) return { error: "RR must be greater than zero." };
    if(!Number.isFinite(startBalance) || startBalance <= 0) return { error: "Starting balance must be greater than zero." };
    if(!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 10) return { error: "Risk per trade must be between 0.1 and 10." };
    if(!Number.isFinite(costR) || costR < 0 || costR > 2) return { error: "Trading cost must be between 0 and 2R." };
    if(!Number.isFinite(slAtr) || slAtr < 0.2 || slAtr > 5) return { error: "Stop ATR multiple must be between 0.2 and 5." };
    if(!Number.isFinite(candleCount) || candleCount < 300 || candleCount > 20000) return { error: "Candles to fetch must be between 300 and 20000." };
    if(!Number.isFinite(fastLen) || fastLen < 2 || fastLen > 100) return { error: "Fast MA length must be between 2 and 100." };
    if(!Number.isFinite(slowLen) || slowLen < 3 || slowLen > 500) return { error: "Slow MA length must be between 3 and 500." };
    if(fastLen >= slowLen) return { error: "Fast MA must be smaller than Slow MA." };
    if(!Number.isFinite(atrLen) || atrLen < 5 || atrLen > 100) return { error: "ATR length must be between 5 and 100." };
    if(!["all", "london", "newyork", "custom"].includes(session)) return { error: "Session filter is invalid." };
    if(!["conservative", "optimistic", "skip"].includes(conflictModel)) return { error: "Intrabar conflict model is invalid." };
    if(!Number.isFinite(startHour) || startHour < 0 || startHour > 23) return { error: "Start hour must be between 0 and 23." };
    if(!Number.isFinite(endHour) || endHour < 0 || endHour > 23) return { error: "End hour must be between 0 and 23." };
    if(startDate && endDate && Date.parse(`${startDate}T00:00:00Z`) > Date.parse(`${endDate}T00:00:00Z`)) return { error: "Start date must be before or equal to End date." };

    return { instrument, timeframe, strategyId, strategyName: strategyDef.name, rules, trades, rr, startBalance, riskPct, costR, slAtr, candleCount, allowShort, fastLen, slowLen, atrLen, session, startDate, endDate, startHour, endHour, conflictModel };
  }

  function applyTrade(balance, riskPct, grossR, costR){
    const netR = grossR - costR;
    const riskDollars = balance * (riskPct / 100);
    const pnl = riskDollars * netR;
    return { netR, pnl, nextBalance: balance + pnl };
  }

  function shouldEnterTrade(strategyId, fast, slow, atr, close, i, allowShort){
    const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i];
    const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i];

    if(strategyId === "sma_crossover" || strategyId === "sma_long_trend"){
      if(crossUp) return 1;
      if(crossDown && allowShort) return -1;
      return 0;
    }

    if(strategyId === "strength_scalp_weekly"){
      const atrNow = atr[i];
      const px = close[i];
      if(!Number.isFinite(atrNow) || !Number.isFinite(px) || px <= 0) return 0;

      const atrPct = atrNow / px;
      const trendRatio = Math.abs(fast[i] - slow[i]) / atrNow;
      const isChoppy = atrPct < 0.0008 || trendRatio < 0.35;
      if(isChoppy) return 0;

      if(crossUp) return 1;
      if(crossDown && allowShort) return -1;
    }

    return 0;
  }

  async function buildMarketReplayResults(cfg){
    if(!window.LC?.requestCandles) return { error: "Candles API unavailable. Run inside LiquidCharts with framework connected." };

    const payload = await window.LC.requestCandles(cfg.instrument, cfg.timeframe, cfg.candleCount);
    const normalized = normalizeCandles(payload);
    const filtered = applyDateSessionFilter(normalized, cfg);
    const candles = filtered.candles;

    if(candles.length < 200) return { error: "Not enough candles after date/session filters. Increase candle count or widen range/session." };
    if(!window.UTIL?.sma || !window.UTIL?.atr) return { error: "Indicator utils unavailable." };

    const close = candles.map((x)=>x.c);
    const high = candles.map((x)=>x.h);
    const low = candles.map((x)=>x.l);
    const fast = window.UTIL.sma(close, cfg.fastLen);
    const slow = window.UTIL.sma(close, cfg.slowLen);
    const atr = window.UTIL.atr(high, low, close, cfg.atrLen);

    const rows = [];
    let balance = cfg.startBalance;
    let wins = 0;
    let losses = 0;
    let ambiguousBars = 0;
    const start = Math.max(cfg.slowLen + 2, cfg.atrLen + 2);

    for(let i = start; i < candles.length - 3 && rows.length < cfg.trades; i++){
      if(stopFlag) break;
      if(!Number.isFinite(fast[i - 1]) || !Number.isFinite(slow[i - 1]) || !Number.isFinite(fast[i]) || !Number.isFinite(slow[i]) || !Number.isFinite(atr[i]) || atr[i] <= 0) continue;

      const dir = shouldEnterTrade(cfg.strategyId, fast, slow, atr, close, i, cfg.allowShort);
      if(!dir) continue;

      const entryIndex = i + 1;
      const entry = candles[entryIndex]?.o;
      if(!Number.isFinite(entry) || entry <= 0) continue;

      const stopDist = atr[i] * cfg.slAtr;
      if(!Number.isFinite(stopDist) || stopDist <= 0) continue;

      const stop = dir === 1 ? entry - stopDist : entry + stopDist;
      const take = dir === 1 ? entry + (stopDist * cfg.rr) : entry - (stopDist * cfg.rr);

      let exitIndex = entryIndex;
      let exitPrice = entry;
      let reason = "No exit";

      for(let j = entryIndex + 1; j < candles.length; j++){
        const bar = candles[j];
        const hitStop = dir === 1 ? bar.l <= stop : bar.h >= stop;
        const hitTake = dir === 1 ? bar.h >= take : bar.l <= take;

        if(hitStop && hitTake){
          ambiguousBars += 1;
          if(cfg.conflictModel === "skip"){
            reason = "Ambiguous bar skipped";
            exitIndex = j;
            exitPrice = entry;
            break;
          }
          exitIndex = j;
          if(cfg.conflictModel === "optimistic"){
            exitPrice = take;
            reason = "Stop+Take same bar (optimistic take)";
          }else{
            exitPrice = stop;
            reason = "Stop+Take same bar (conservative stop)";
          }
          break;
        }
        if(hitStop){
          exitIndex = j;
          exitPrice = stop;
          reason = "Stop";
          break;
        }
        if(hitTake){
          exitIndex = j;
          exitPrice = take;
          reason = "Take profit";
          break;
        }
        if(j === candles.length - 1){
          exitIndex = j;
          exitPrice = bar.c;
          reason = "End of data";
        }
      }

      if(reason === "Ambiguous bar skipped"){
        continue;
      }

      const move = dir === 1 ? (exitPrice - entry) : (entry - exitPrice);
      const grossR = move / stopDist;
      const applied = applyTrade(balance, cfg.riskPct, grossR, cfg.costR);
      balance = applied.nextBalance;
      if(grossR > 0) wins += 1;
      else losses += 1;

      rows.push({
        trade: rows.length + 1,
        direction: dir === 1 ? "Long" : "Short",
        outcome: grossR > 0 ? "Win" : "Loss",
        reason,
        grossR,
        netR: applied.netR,
        pnl: applied.pnl,
        balance
      });

      i = Math.max(i, exitIndex - 1);
    }

    if(rows.length === 0) return { error: "No entries were found from selected strategy on returned market data." };

    return {
      rows,
      wins,
      losses,
      endingBalance: balance,
      ambiguousBars,
      source: `LiquidCharts candles (${candles.length}/${normalized.length} in filter), ${cfg.strategyName}, session ${filtered.sessionLabel}, intrabar ${cfg.conflictModel}` ,
      fallbackUsed: filtered.fallbackUsed
    };
  }

  function maxDrawdownPct(rows, startBalance){
    let peak = startBalance;
    let maxDD = 0;
    rows.forEach((r)=>{
      peak = Math.max(peak, r.balance);
      if(peak > 0){
        const dd = ((peak - r.balance) / peak) * 100;
        if(dd > maxDD) maxDD = dd;
      }
    });
    return maxDD;
  }

  function renderSummary(data){
    const avgNetR = data.rows.reduce((sum, r)=>sum + r.netR, 0) / data.rows.length;
    const actualWinRate = (data.wins / data.rows.length) * 100;
    const actualLossRate = 100 - actualWinRate;
    const dd = maxDrawdownPct(data.rows, data.startBalance);
    const end = window.FMT ? window.FMT.money(data.endingBalance) : `$${data.endingBalance.toFixed(2)}`;
    const start = window.FMT ? window.FMT.money(data.startBalance) : `$${data.startBalance.toFixed(2)}`;
    const dateRange = `${data.startDate || "start"} → ${data.endDate || "end"}`;

    $("btSummary").innerHTML = `
      <strong>${data.instrument}</strong> · ${data.timeframe} · ${data.strategyName}<br>
      Source: ${data.source}<br>
      Date range (UTC): ${dateRange}<br>
      Intrabar model: ${data.conflictModel} · Ambiguous bars: ${data.ambiguousBars ?? 0}<br>
      Timestamp quality: ${data.fallbackUsed ? "⚠ missing timestamps; date/session fallback to all hours" : "OK"}<br>
      Rules: ${data.rules.replace(/\n/g, "<br>")}<br>
      Trades: ${data.rows.length} · Wins: ${data.wins} · Losses: ${data.losses}<br>
      Reported Win/Loss: <strong>${actualWinRate.toFixed(1)}%</strong> / <strong>${actualLossRate.toFixed(1)}%</strong><br>
      Avg Net Expectancy: <strong>${avgNetR.toFixed(2)}R</strong> · Max DD: <strong>${dd.toFixed(2)}%</strong><br>
      Start/End Balance: <strong>${start}</strong> → <strong>${end}</strong>
    `;
  }

  function renderTrades(rows){
    const body = rows.map((r)=>`
      <tr>
        <td>${r.trade}</td>
        <td>${r.direction}</td>
        <td>${r.outcome}</td>
        <td>${r.reason}</td>
        <td>${r.grossR.toFixed(2)}R</td>
        <td>${r.netR.toFixed(2)}R</td>
        <td>${window.FMT ? window.FMT.money(r.pnl) : `$${r.pnl.toFixed(2)}`}</td>
        <td>${window.FMT ? window.FMT.money(r.balance) : `$${r.balance.toFixed(2)}`}</td>
      </tr>`).join("");

    $("btTrades").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Side</th>
            <th>Outcome</th>
            <th>Exit</th>
            <th>Gross R</th>
            <th>Net R</th>
            <th>P/L</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  async function run(){
    stopFlag = false;
    $("btnStopBt").disabled = false;
    $("btnRunBt").disabled = true;

    const cfg = validateInputs();
    if(cfg.error){
      window.LC.setStatus("Backtest error", "bad");
      window.LC.log(`❌ ${cfg.error}`);
      $("btnRunBt").disabled = false;
      $("btnStopBt").disabled = true;
      return;
    }

    window.LC.setStatus("Backtesting…", "warn");
    window.LC.log(`▶ Strategy backtest started: ${cfg.strategyName} on ${cfg.instrument} ${cfg.timeframe}`);

    let result;
    try{
      result = await buildMarketReplayResults(cfg);
    }catch(err){
      result = { error: err?.message || "Backtest failed." };
    }

    if(result?.error){
      window.LC.setStatus("Backtest error", "bad");
      window.LC.log(`❌ ${result.error}`);
      $("btnRunBt").disabled = false;
      $("btnStopBt").disabled = true;
      return;
    }

    const data = { ...cfg, ...result };
    lastResults = data;
    renderSummary(data);
    renderTrades(data.rows.slice(0, MAX_ROWS));

    window.LC.setStatus(stopFlag ? "Backtest stopped" : "Backtest done", stopFlag ? "warn" : (result.fallbackUsed ? "warn" : "ok"));
    if(result.fallbackUsed){
      window.LC.log("⚠ Candle timestamps were missing, so date/session filters were skipped for this run.");
    }
    window.LC.log(`✅ Backtest complete using ${result.source}`);
    $("btnRunBt").disabled = false;
    $("btnStopBt").disabled = true;
    $("btnExportBt").disabled = false;
  }

  function stop(){
    stopFlag = true;
    window.LC.setStatus("Stopping…", "warn");
  }

  function clear(){
    $("btSummary").textContent = "No results yet.";
    $("btTrades").innerHTML = "";
    window.LC.log("Backtest output cleared.");
  }

  function exportResults(){
    if(!lastResults || !lastResults.rows || lastResults.rows.length === 0){
      window.LC.log("⚠ No backtest results to export.");
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename = `backtest_${lastResults.instrument}_${lastResults.timeframe}_${timestamp}`;

    if(window.UTIL?.Export){
      window.UTIL.Export.exportBacktestResults(lastResults.rows, lastResults, filename);
      window.LC.log(`✅ Exported backtest results: ${filename}`);
    }else{
      window.LC.log("❌ Export utilities unavailable.");
    }
  }

  window.ENG = window.ENG || {};
  window.ENG.Backtest = { run, stop, clear, exportResults, syncLossRate };
})();
