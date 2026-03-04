/*
 * engine-backtest-signals.js
 *
 * Corrected backtest engine that uses the EXACT same SMA-crossover signal
 * detection logic as `scanCrossoverSignals` in engine-autotrader.js and the
 * standalone backtest-last5-signals.html widget.
 *
 * Key difference from the original engine-backtest.js:
 *   - Entry price = close of the crossover candle (matches what the
 *     "Last 5 Signals" scanner reports as the entry price).
 *   - The forming (last) bar is excluded from the candle set — we only
 *     operate on fully closed candles, same as backtest-last5-signals.html.
 *   - Signal detection is a pure MA crossover scan with no extra filters,
 *     so the signals found here are identical to those shown in the UI.
 *
 * This file overrides window.ENG.Backtest when loaded after engine-backtest.js.
 */
(function(){
  "use strict";

  const $ = (id) => document.getElementById(id);
  const MAX_ROWS = 300;
  let stopFlag = false;
  let lastResults = null;

  /* ── small utilities ─────────────────────────────────────────────────── */

  function toNum(v, fallback = 0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function syncLossRate(){ /* backward-compat stub */ }

  function candleTimeMs(t){
    if(!Number.isFinite(t) || t <= 0) return 0;
    return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  }

  function normalizeCandles(raw){
    if(!raw) return [];
    const src = Array.isArray(raw)
      ? raw
      : (raw.candles || raw.Candles || raw.data || raw.Data || raw);
    if(!Array.isArray(src)) return [];
    const rows = src.map((c) => ({
      t: candleTimeMs(Number(c?.time ?? c?.Time ?? c?.timestamp ?? c?.Timestamp ?? c?.t ?? 0)),
      o: Number(c?.open  ?? c?.Open  ?? c?.o ?? NaN),
      h: Number(c?.high  ?? c?.High  ?? c?.h ?? NaN),
      l: Number(c?.low   ?? c?.Low   ?? c?.l ?? NaN),
      c: Number(c?.close ?? c?.Close ?? c?.c ?? NaN)
    })).filter((x) =>
      Number.isFinite(x.o) && Number.isFinite(x.h) &&
      Number.isFinite(x.l) && Number.isFinite(x.c)
    );
    if(rows.length > 1 && rows[0].t && rows[rows.length - 1].t &&
       rows[0].t > rows[rows.length - 1].t) rows.reverse();
    return rows;
  }

  function inHourWindow(hour, startHour, endHour){
    if(startHour <= endHour) return hour >= startHour && hour <= endHour;
    return hour >= startHour || hour <= endHour;
  }

  function sessionHours(session){
    if(session === "london")  return { startHour: 7,  endHour: 16, label: "London" };
    if(session === "newyork") return { startHour: 12, endHour: 21, label: "New York" };
    return null;
  }

  function applyDateSessionFilter(candles, cfg){
    const startDateMs = cfg.startDate ? Date.parse(`${cfg.startDate}T00:00:00Z`) : null;
    const endDateMs   = cfg.endDate   ? Date.parse(`${cfg.endDate}T23:59:59Z`)   : null;
    const sessionCfg  = sessionHours(cfg.session);
    const startHour   = sessionCfg ? sessionCfg.startHour : cfg.startHour;
    const endHour     = sessionCfg ? sessionCfg.endHour   : cfg.endHour;

    let missingTs = 0;
    const filtered = candles.filter((c) => {
      const ms = candleTimeMs(c.t);
      if(ms <= 0){
        missingTs += 1;
        return cfg.session === "all" && !cfg.startDate && !cfg.endDate;
      }
      if(Number.isFinite(startDateMs) && ms < startDateMs) return false;
      if(Number.isFinite(endDateMs)   && ms > endDateMs)   return false;
      const hour = new Date(ms).getUTCHours();
      return inHourWindow(hour, startHour, endHour);
    });

    const requestedFilter = cfg.session !== "all" || !!cfg.startDate || !!cfg.endDate;
    if(missingTs > 0 && requestedFilter){
      return { candles, sessionLabel: "All hours (timestamp fallback)", missingTs, fallbackUsed: true };
    }
    return {
      candles: filtered,
      sessionLabel: sessionCfg
        ? sessionCfg.label
        : (cfg.session === "all"
          ? "All hours"
          : `Custom ${startHour}:00-${endHour}:59 UTC`),
      missingTs,
      fallbackUsed: false
    };
  }

  /* ── input validation ────────────────────────────────────────────────── */

  function validateInputs(){
    const instrument  = ($("btInstrument")?.value  || "").trim();
    const timeframe   = $("btTf")?.value;
    const strategyId  = ($("btStrategyPreset")?.value || "sma_crossover").trim();
    const strategyDef = window.STRATEGIES?.byId?.[strategyId];
    const rules       = ($("btStrategy")?.value || "").trim();
    const trades      = Math.floor(toNum($("btCount")?.value));
    const rr          = toNum($("btRr")?.value, 1);
    const startBalance= toNum($("btStartBalance")?.value);
    const riskPct     = toNum($("btRiskPct")?.value);
    const costR       = toNum($("btCostR")?.value, 0);
    const slAtr       = toNum($("btSlAtr")?.value, 1);
    const candleCount = Math.floor(toNum($("btCandleCount")?.value, 2500));
    const allowShort  = ($("btAllowShort")?.value || "yes") === "yes";
    const session     = ($("btSession")?.value || "all").trim();
    const conflictModel = ($("btConflictModel")?.value || "conservative").trim();
    const startDate   = ($("btStartDate")?.value || "").trim();
    const endDate     = ($("btEndDate")?.value   || "").trim();
    const startHour   = Math.floor(toNum($("btStartHour")?.value, 0));
    const endHour     = Math.floor(toNum($("btEndHour")?.value, 23));
    const fastLen     = Math.floor(toNum($("btFastMa")?.value, strategyDef?.defaults?.fastMa || 10));
    const slowLen     = Math.floor(toNum($("btSlowMa")?.value, strategyDef?.defaults?.slowMa || 30));
    const atrLen      = Math.floor(toNum($("btAtrLen")?.value, strategyDef?.defaults?.atrLen || 14));

    if(!instrument)  return { error: "Please choose a market/instrument from the selector." };
    if(!timeframe)   return { error: "Timeframe is required." };
    if(!strategyDef) return { error: "Please choose a strategy." };
    if(!rules)       return { error: "Strategy rules are required." };
    if(!Number.isFinite(trades) || trades < 5 || trades > 5000) return { error: "Trade count must be between 5 and 5000." };
    if(!Number.isFinite(rr)    || rr <= 0)                      return { error: "RR must be greater than zero." };
    if(!Number.isFinite(startBalance) || startBalance <= 0)      return { error: "Starting balance must be greater than zero." };
    if(!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 10) return { error: "Risk per trade must be between 0.1 and 10." };
    if(!Number.isFinite(costR)  || costR < 0 || costR > 2)       return { error: "Trading cost must be between 0 and 2R." };
    if(!Number.isFinite(slAtr)  || slAtr < 0.2 || slAtr > 5)     return { error: "Stop ATR multiple must be between 0.2 and 5." };
    if(!Number.isFinite(candleCount) || candleCount < 300 || candleCount > 20000) return { error: "Candles to fetch must be between 300 and 20000." };
    if(!Number.isFinite(fastLen) || fastLen < 2  || fastLen > 100)  return { error: "Fast MA length must be between 2 and 100." };
    if(!Number.isFinite(slowLen) || slowLen < 3  || slowLen > 500)  return { error: "Slow MA length must be between 3 and 500." };
    if(fastLen >= slowLen) return { error: "Fast MA must be smaller than Slow MA." };
    if(!Number.isFinite(atrLen)  || atrLen < 5  || atrLen > 100)    return { error: "ATR length must be between 5 and 100." };
    if(!["all","london","newyork","custom"].includes(session)) return { error: "Session filter is invalid." };
    if(!["conservative","optimistic","skip"].includes(conflictModel)) return { error: "Intrabar conflict model is invalid." };
    if(!Number.isFinite(startHour) || startHour < 0 || startHour > 23) return { error: "Start hour must be between 0 and 23." };
    if(!Number.isFinite(endHour)   || endHour   < 0 || endHour   > 23) return { error: "End hour must be between 0 and 23." };
    if(startDate && endDate && Date.parse(`${startDate}T00:00:00Z`) > Date.parse(`${endDate}T00:00:00Z`))
      return { error: "Start date must be before or equal to End date." };

    return {
      instrument, timeframe, strategyId,
      strategyName: strategyDef.name,
      rules, trades, rr, startBalance, riskPct, costR, slAtr,
      candleCount, allowShort, fastLen, slowLen, atrLen,
      session, startDate, endDate, startHour, endHour, conflictModel
    };
  }

  /* ── core signal detection ───────────────────────────────────────────── */
  /*
   * Identical logic to scanCrossoverSignals (engine-autotrader.js) and
   * lastCrossSignals (backtest-last5-signals.html).
   *
   * Returns every crossover in oldest→newest order.
   * Entry price = close of the crossover candle (same value shown in the
   * "Last 5 Signals" UI).
   */
  function findCrossoverSignals(candles, fastLen, slowLen, allowShort){
    const closes = candles.map((x) => x.c);
    const fast   = window.UTIL.sma(closes, fastLen);
    const slow   = window.UTIL.sma(closes, slowLen);

    const signals = [];
    for(let i = 1; i < candles.length; i++){
      const fCurr = fast[i], sCurr = slow[i];
      const fPrev = fast[i - 1], sPrev = slow[i - 1];
      if(fCurr === null || sCurr === null || fPrev === null || sPrev === null) continue;

      if(fPrev <= sPrev && fCurr > sCurr){
        // Bullish crossover
        signals.push({ idx: i, dir: 1,  entry: candles[i].c, t: candles[i].t });
      } else if(fPrev >= sPrev && fCurr < sCurr && allowShort){
        // Bearish crossover
        signals.push({ idx: i, dir: -1, entry: candles[i].c, t: candles[i].t });
      }
    }
    return signals;
  }

  /* ── trade P&L helper ────────────────────────────────────────────────── */

  function applyTrade(balance, riskPct, grossR, costR){
    const netR = grossR - costR;
    const riskDollars = balance * (riskPct / 100);
    const pnl = riskDollars * netR;
    return { netR, pnl, nextBalance: balance + pnl };
  }

  /* ── main backtest ───────────────────────────────────────────────────── */

  async function buildResults(cfg){
    if(!window.LC?.requestCandles)
      return { error: "Candles API unavailable. Run inside LiquidCharts with framework connected." };

    const payload    = await window.LC.requestCandles(cfg.instrument, cfg.timeframe, cfg.candleCount);
    const normalized = (window.CandleUtils && typeof window.CandleUtils.normalizeCandles === "function")
      ? window.CandleUtils.normalizeCandles(payload)
      : normalizeCandles(payload);

    // Exclude the forming (last) bar — only operate on fully closed candles.
    // This matches the behaviour of backtest-last5-signals.html.
    const closedCandles = normalized.slice(0, normalized.length - 1);

    const filtered = applyDateSessionFilter(closedCandles, cfg);
    const candles  = filtered.candles;

    if(candles.length < cfg.slowLen + 2)
      return { error: "Not enough candles after date/session filters. Increase candle count or widen range/session." };
    if(!window.UTIL?.sma || !window.UTIL?.atr)
      return { error: "Indicator utils unavailable." };

    // Pre-compute ATR array for stop sizing
    const high  = candles.map((x) => x.h);
    const low   = candles.map((x) => x.l);
    const close = candles.map((x) => x.c);
    const atr   = window.UTIL.atr(high, low, close, cfg.atrLen);

    // Detect every crossover signal (oldest → newest)
    const allSignals = findCrossoverSignals(candles, cfg.fastLen, cfg.slowLen, cfg.allowShort);

    const rows = [];
    let balance       = cfg.startBalance;
    let wins          = 0;
    let losses        = 0;
    let ambiguousBars = 0;
    let skipUntilIdx  = -1; // do not open a new trade before a previous one has closed

    for(let si = 0; si < allSignals.length && rows.length < cfg.trades; si++){
      if(stopFlag) break;

      const sig = allSignals[si];

      // Skip signals that fall inside the duration of the previous trade
      if(sig.idx <= skipUntilIdx) continue;

      const entryIdx = sig.idx;
      const entry    = sig.entry; // close of the crossover candle
      if(!Number.isFinite(entry) || entry <= 0) continue;

      const stopDist = atr[entryIdx] * cfg.slAtr;
      if(!Number.isFinite(stopDist) || stopDist <= 0) continue;

      const stop = sig.dir === 1 ? entry - stopDist : entry + stopDist;
      const take = sig.dir === 1 ? entry + stopDist * cfg.rr : entry - stopDist * cfg.rr;

      let exitIdx     = entryIdx;
      let exitPrice   = entry;
      let reason      = "No exit";
      let wasAmbiguous = false;
      let skipped      = false;

      // Forward-test: walk bars after the signal candle checking SL/TP
      for(let j = entryIdx + 1; j < candles.length; j++){
        const bar     = candles[j];
        const hitStop = sig.dir === 1 ? bar.l <= stop : bar.h >= stop;
        const hitTake = sig.dir === 1 ? bar.h >= take : bar.l <= take;

        if(hitStop && hitTake){
          wasAmbiguous = true;
          ambiguousBars += 1;
          exitIdx = j;
          if(cfg.conflictModel === "skip"){ skipped = true; break; }
          exitPrice = cfg.conflictModel === "optimistic" ? take : stop;
          reason    = `Stop+Take same bar (${cfg.conflictModel})`;
          break;
        }
        if(hitStop){
          exitIdx   = j;
          exitPrice = stop;
          reason    = "Stop";
          break;
        }
        if(hitTake){
          exitIdx   = j;
          exitPrice = take;
          reason    = "Take profit";
          break;
        }
        if(j === candles.length - 1){
          exitIdx   = j;
          exitPrice = bar.c;
          reason    = "End of data";
        }
      }

      skipUntilIdx = exitIdx;
      if(skipped || reason === "No exit") continue;

      const move   = sig.dir === 1 ? exitPrice - entry : entry - exitPrice;
      const grossR = move / stopDist;
      const applied = applyTrade(balance, cfg.riskPct, grossR, cfg.costR);
      balance = applied.nextBalance;
      if(grossR > 0) wins += 1; else losses += 1;

      rows.push({
        trade:     rows.length + 1,
        direction: sig.dir === 1 ? "Long" : "Short",
        outcome:   grossR > 0 ? "Win" : "Loss",
        reason,
        grossR,
        netR:    applied.netR,
        pnl:     applied.pnl,
        balance
      });
    }

    if(rows.length === 0)
      return { error: "No entries were found from the selected strategy on the returned market data." };

    return {
      rows, wins, losses,
      endingBalance: balance,
      ambiguousBars,
      source: `LiquidCharts candles (${candles.length}/${normalized.length - 1} closed), ${cfg.strategyName}, session ${filtered.sessionLabel}, intrabar ${cfg.conflictModel}`,
      fallbackUsed: filtered.fallbackUsed
    };
  }

  /* ── drawdown helper ─────────────────────────────────────────────────── */

  function maxDrawdownPct(rows, startBalance){
    let peak  = startBalance;
    let maxDD = 0;
    rows.forEach((r) => {
      peak = Math.max(peak, r.balance);
      if(peak > 0){
        const dd = ((peak - r.balance) / peak) * 100;
        if(dd > maxDD) maxDD = dd;
      }
    });
    return maxDD;
  }

  /* ── rendering ───────────────────────────────────────────────────────── */

  function renderSummary(data){
    const avgNetR       = data.rows.reduce((s, r) => s + r.netR, 0) / data.rows.length;
    const actualWinRate = (data.wins / data.rows.length) * 100;
    const dd            = maxDrawdownPct(data.rows, data.startBalance);
    const end   = window.FMT ? window.FMT.money(data.endingBalance) : `$${data.endingBalance.toFixed(2)}`;
    const start = window.FMT ? window.FMT.money(data.startBalance)  : `$${data.startBalance.toFixed(2)}`;
    const dateRange = `${data.startDate || "start"} → ${data.endDate || "end"}`;

    $("btSummary").innerHTML = `
      <strong>${data.instrument}</strong> · ${data.timeframe} · ${data.strategyName}<br>
      Source: ${data.source}<br>
      Date range (UTC): ${dateRange}<br>
      Intrabar model: ${data.conflictModel} · Ambiguous bars: ${data.ambiguousBars ?? 0}<br>
      Timestamp quality: ${data.fallbackUsed ? "⚠ missing timestamps; date/session fallback to all hours" : "OK"}<br>
      Rules: ${data.rules.replace(/\n/g, "<br>")}<br>
      Trades: ${data.rows.length} · Wins: ${data.wins} · Losses: ${data.losses}<br>
      Win rate: <strong>${actualWinRate.toFixed(1)}%</strong> · Loss rate: <strong>${(100 - actualWinRate).toFixed(1)}%</strong><br>
      Avg Net Expectancy: <strong>${avgNetR.toFixed(2)}R</strong> · Max DD: <strong>${dd.toFixed(2)}%</strong><br>
      Start/End Balance: <strong>${start}</strong> → <strong>${end}</strong>
    `;
  }

  function renderTrades(rows){
    const body = rows.map((r) => `
      <tr>
        <td>${r.trade}</td>
        <td>${r.direction}</td>
        <td>${r.outcome}</td>
        <td>${r.reason}</td>
        <td>${r.grossR.toFixed(2)}R</td>
        <td>${r.netR.toFixed(2)}R</td>
        <td>${window.FMT ? window.FMT.money(r.pnl)     : `$${r.pnl.toFixed(2)}`}</td>
        <td>${window.FMT ? window.FMT.money(r.balance)  : `$${r.balance.toFixed(2)}`}</td>
      </tr>`).join("");

    $("btTrades").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th><th>Side</th><th>Outcome</th><th>Exit</th>
            <th>Gross R</th><th>Net R</th><th>P/L</th><th>Balance</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  /* ── public API ──────────────────────────────────────────────────────── */

  async function run(){
    stopFlag = false;
    $("btnStopBt").disabled  = false;
    $("btnRunBt").disabled   = true;

    const cfg = validateInputs();
    if(cfg.error){
      window.LC.setStatus("Backtest error", "bad");
      window.LC.log(`❌ ${cfg.error}`);
      $("btnRunBt").disabled  = false;
      $("btnStopBt").disabled = true;
      return;
    }

    window.LC.setStatus("Backtesting…", "warn");
    window.LC.log(`▶ Backtest started: ${cfg.strategyName} on ${cfg.instrument} ${cfg.timeframe}`);

    let result;
    try{
      result = await buildResults(cfg);
    }catch(err){
      result = { error: err?.message || "Backtest failed." };
    }

    if(result?.error){
      window.LC.setStatus("Backtest error", "bad");
      window.LC.log(`❌ ${result.error}`);
      $("btnRunBt").disabled  = false;
      $("btnStopBt").disabled = true;
      return;
    }

    const data = { ...cfg, ...result };
    lastResults = data;
    renderSummary(data);
    renderTrades(data.rows.slice(0, MAX_ROWS));

    window.LC.setStatus(
      stopFlag ? "Backtest stopped" : "Backtest done",
      stopFlag ? "warn" : (result.fallbackUsed ? "warn" : "ok")
    );
    if(result.fallbackUsed){
      window.LC.log("⚠ Candle timestamps were missing, so date/session filters were skipped for this run.");
    }
    window.LC.log(`✅ Backtest complete using ${result.source}`);
    $("btnRunBt").disabled   = false;
    $("btnStopBt").disabled  = true;
    $("btnExportBt").disabled = false;
    if($("btnClearBt")) $("btnClearBt").disabled = false;
  }

  function stop(){
    stopFlag = true;
    window.LC.setStatus("Stopping…", "warn");
  }

  function clear(){
    $("btSummary").textContent = "No results yet.";
    $("btTrades").innerHTML    = "";
    window.LC.log("Backtest output cleared.");
    if($("btnExportBt")) $("btnExportBt").disabled = true;
    if($("btnClearBt"))  $("btnClearBt").disabled  = true;
  }

  function exportResults(){
    if(!lastResults || !lastResults.rows || lastResults.rows.length === 0){
      window.LC.log("⚠ No backtest results to export.");
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const filename  = `backtest_${lastResults.instrument}_${lastResults.timeframe}_${timestamp}`;
    if(window.UTIL?.Export){
      window.UTIL.Export.exportBacktestResults(lastResults.rows, lastResults, filename);
      window.LC.log(`✅ Exported backtest results: ${filename}`);
    }else{
      window.LC.log("❌ Export utilities unavailable.");
    }
  }

  // Override ENG.Backtest — this file must be loaded after engine-backtest.js
  window.ENG          = window.ENG || {};
  window.ENG.Backtest = { run, stop, clear, exportResults, syncLossRate };
})();
