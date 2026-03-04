/*
 * engine-backtest-signals.js
 *
 * Backtest engine whose candle pipeline is taken DIRECTLY from the working
 * standalone HTML widget (LiquidCharts Backtest: Last 5 MA-Crossover Signals).
 *
 * Why this file exists / what was wrong before
 * ─────────────────────────────────────────────
 * The LiquidCharts candle API returns an array ordered NEWEST → OLDEST where
 * index 0 is the still-forming (live) bar.  The old candle-utils.js didn't
 * recognise the `date` timestamp field used by the API, so every candle got
 * t = 0, the sort-guard in ensureChron never fired, and the array was never
 * reversed.  Every downstream engine therefore:
 *   • processed candles in the wrong (newest→oldest) direction,
 *   • computed SMAs over a backwards window, and
 *   • labelled BUY/SELL signals the wrong way round.
 *
 * This file bypasses normalizeCandles entirely and follows the exact three
 * steps the working widget uses:
 *   1. msg.candles.slice(1)     — drop the forming bar at index 0
 *   2. .slice().reverse()       — flip to chronological (oldest → newest)
 *   3. SMA + crossover scan     — identical to the working widget
 *
 * It overrides window.ENG.Backtest when loaded after engine-backtest.js.
 */
(function(){
  "use strict";

  /* ── DOM helper ──────────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);

  const MAX_ROWS = 300;
  // Minimum number of filtered candles before falling back to unfiltered data
  // when timestamps are missing.
  const MIN_FILTERED_CANDLES = 50;
  let stopFlag   = false;
  let lastResults = null;

  /* ── timeframe conversion (string → seconds, matching working HTML) ─── */
  const TF_SECONDS = {
    M1: 60, M5: 300, M15: 900, M30: 1800,
    H1: 3600, H4: 14400, D1: 86400
  };

  function tfToSeconds(tf){
    if(TF_SECONDS[tf]) return TF_SECONDS[tf];
    const n = Number(tf);
    return Number.isFinite(n) && n > 0 ? n : 900; // default M15
  }

  /* ── candle fetch — mirrors the working HTML exactly ─────────────────── */
  async function requestCandles(instrumentId, timeframe, count){
    const tfSec = tfToSeconds(timeframe);
    // Prefer Framework directly (matches working HTML)
    if(window.Framework && window.Framework.pRequestCandles){
      return await window.Framework.pRequestCandles({
        instrumentId, timeframe: tfSec, count, streaming: false
      });
    }
    if(window.Framework && window.Framework.RequestCandles){
      return await new Promise((resolve) => {
        window.Framework.RequestCandles({
          instrumentId, timeframe: tfSec, count, streaming: false
        }, (m) => resolve(m));
      });
    }
    // Fallback: window.LC.requestCandles (passes timeframe as string)
    if(window.LC && window.LC.requestCandles){
      return await window.LC.requestCandles(instrumentId, timeframe, count);
    }
    throw new Error("No candle API available. Run inside LiquidCharts.");
  }

  /* ── get closed candles in chronological order (oldest → newest) ───────
   *
   * Mirrors the working HTML:
   *   const closed  = candles.slice(1);       // drop index 0 = forming bar
   *   const cChron  = toChron(closed);        // oldest → newest
   */
  function getClosedChron(msg){
    const raw = (msg && msg.candles)
      ? msg.candles
      : (Array.isArray(msg) ? msg : []);
    // raw[0] = forming/live bar (newest) — exclude it
    const closed = raw.slice(1);
    // raw is newest→oldest; reverse gives oldest→newest
    return closed.slice().reverse();
  }

  /* ── SMA — sliding window, identical to working HTML ────────────────── */
  function sma(series, len){
    const n   = series.length;
    const out = new Array(n).fill(null);
    let sum   = 0;
    for(let i = 0; i < n; i++){
      sum += series[i];
      if(i >= len) sum -= series[i - len];
      if(i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  /* ── ATR (Wilder) — for stop sizing ─────────────────────────────────── */
  function atr(cChron, len){
    const n  = cChron.length;
    const tr = new Array(n).fill(null);
    for(let i = 1; i < n; i++){
      const a = cChron[i].h - cChron[i].l;
      const b = Math.abs(cChron[i].h - cChron[i - 1].c);
      const c = Math.abs(cChron[i].l - cChron[i - 1].c);
      tr[i] = Math.max(a, b, c);
    }
    const out = new Array(n).fill(null);
    let prev  = null;
    for(let i = 1; i < n; i++){
      if(tr[i] === null) continue;
      if(prev === null){
        // seed: simple average of first `len` TRs
        if(i >= len){
          let s = 0;
          for(let k = i - len + 1; k <= i; k++) s += (tr[k] ?? 0);
          prev = s / len;
          out[i] = prev;
        }
      } else {
        prev     = ((prev * (len - 1)) + tr[i]) / len;
        out[i]   = prev;
      }
    }
    return out;
  }

  /* ── candle timestamp helper (used by filter and signal push) ───────── */
  function tsMs(raw){
    // raw candles may use date (ms or s) or t
    const v = raw.date ?? raw.t ?? 0;
    const n = Number(v);
    if(!Number.isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  /* ── find ALL crossover signals (oldest → newest) ────────────────────
   *
   * Logic is taken VERBATIM from the working HTML's lastCrossSignals:
   *
   *   const prevDiff = f[i-1] - s[i-1];
   *   const diff     = f[i]   - s[i];
   *   if(prevDiff <= 0 && diff > 0) → BUY
   *   if(prevDiff >= 0 && diff < 0) → SELL
   */
  function findCrossoverSignals(cChron, fastLen, slowLen, allowShort){
    const close = cChron.map((c) => c.c);
    const f     = sma(close, fastLen);
    const s     = sma(close, slowLen);

    const signals = [];
    for(let i = 1; i < cChron.length; i++){
      if(f[i] === null || s[i] === null || f[i-1] === null || s[i-1] === null) continue;

      const prevDiff = f[i-1] - s[i-1];
      const diff     = f[i]   - s[i];

      if(prevDiff <= 0 && diff > 0){
        // Bullish crossover — BUY signal
        signals.push({ idx: i, dir: 1,  entry: cChron[i].c, t: tsMs(cChron[i]) });
      } else if(prevDiff >= 0 && diff < 0 && allowShort){
        // Bearish crossover — SELL signal
        signals.push({ idx: i, dir: -1, entry: cChron[i].c, t: tsMs(cChron[i]) });
      }
    }
    return signals; // oldest → newest
  }

  /* ── session / date filter applied to the chronological array ───────── */
  function inHourWindow(hour, startHour, endHour){
    if(startHour <= endHour) return hour >= startHour && hour <= endHour;
    return hour >= startHour || hour <= endHour;
  }

  function applyFilter(cChron, cfg){
    const sessionMap = { london: [7, 16], newyork: [12, 21] };
    const startDateMs = cfg.startDate ? Date.parse(`${cfg.startDate}T00:00:00Z`) : null;
    const endDateMs   = cfg.endDate   ? Date.parse(`${cfg.endDate}T23:59:59Z`)   : null;
    const [sh, eh]    = sessionMap[cfg.session] || [cfg.startHour, cfg.endHour];
    const noFilter    = cfg.session === "all" && !cfg.startDate && !cfg.endDate;

    if(noFilter) return cChron;

    let missingTs = 0;
    const out = cChron.filter((c) => {
      const ms = tsMs(c);
      if(ms <= 0){ missingTs++; return false; }
      if(Number.isFinite(startDateMs) && ms < startDateMs) return false;
      if(Number.isFinite(endDateMs)   && ms > endDateMs)   return false;
      return inHourWindow(new Date(ms).getUTCHours(), sh, eh);
    });

    // If timestamps were missing and filters requested, fall back to all candles
    return (missingTs > 0 && out.length < MIN_FILTERED_CANDLES) ? cChron : out;
  }

  /* ── P&L ─────────────────────────────────────────────────────────────── */
  function applyTrade(balance, riskPct, grossR, costR){
    const netR        = grossR - costR;
    const riskDollars = balance * (riskPct / 100);
    const pnl         = riskDollars * netR;
    return { netR, pnl, nextBalance: balance + pnl };
  }

  /* ── input validation ────────────────────────────────────────────────── */
  function toNum(v, fallback = 0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function syncLossRate(){ /* backward-compat stub */ }

  function validateInputs(){
    const instrument   = ($("btInstrument")?.value  || "").trim();
    const timeframe    = $("btTf")?.value;
    const strategyId   = ($("btStrategyPreset")?.value || "sma_crossover").trim();
    const strategyDef  = window.STRATEGIES?.byId?.[strategyId];
    const rules        = ($("btStrategy")?.value || "").trim();
    const trades       = Math.floor(toNum($("btCount")?.value));
    const rr           = toNum($("btRr")?.value, 1);
    const startBalance = toNum($("btStartBalance")?.value);
    const riskPct      = toNum($("btRiskPct")?.value);
    const costR        = toNum($("btCostR")?.value, 0);
    const slAtr        = toNum($("btSlAtr")?.value, 1);
    const candleCount  = Math.floor(toNum($("btCandleCount")?.value, 2500));
    const allowShort   = ($("btAllowShort")?.value || "yes") === "yes";
    const session      = ($("btSession")?.value || "all").trim();
    const conflictModel= ($("btConflictModel")?.value || "conservative").trim();
    const startDate    = ($("btStartDate")?.value || "").trim();
    const endDate      = ($("btEndDate")?.value   || "").trim();
    const startHour    = Math.floor(toNum($("btStartHour")?.value, 0));
    const endHour      = Math.floor(toNum($("btEndHour")?.value, 23));
    const fastLen      = Math.floor(toNum($("btFastMa")?.value,  strategyDef?.defaults?.fastMa  || 10));
    const slowLen      = Math.floor(toNum($("btSlowMa")?.value,  strategyDef?.defaults?.slowMa  || 30));
    const atrLen       = Math.floor(toNum($("btAtrLen")?.value,  strategyDef?.defaults?.atrLen  || 14));

    if(!instrument)   return { error: "Please choose a market/instrument." };
    if(!timeframe)    return { error: "Timeframe is required." };
    if(!strategyDef)  return { error: "Please choose a strategy." };
    if(!rules)        return { error: "Strategy rules are required." };
    if(!Number.isFinite(trades)       || trades < 5       || trades > 5000)  return { error: "Trade count must be between 5 and 5000." };
    if(!Number.isFinite(rr)           || rr <= 0)                             return { error: "RR must be greater than zero." };
    if(!Number.isFinite(startBalance) || startBalance <= 0)                   return { error: "Starting balance must be greater than zero." };
    if(!Number.isFinite(riskPct)      || riskPct <= 0    || riskPct > 10)     return { error: "Risk per trade must be between 0.1 and 10." };
    if(!Number.isFinite(costR)        || costR < 0       || costR > 2)        return { error: "Trading cost must be between 0 and 2R." };
    if(!Number.isFinite(slAtr)        || slAtr < 0.2     || slAtr > 5)        return { error: "Stop ATR multiple must be between 0.2 and 5." };
    if(!Number.isFinite(candleCount)  || candleCount < 300|| candleCount > 20000) return { error: "Candles to fetch must be between 300 and 20000." };
    if(!Number.isFinite(fastLen)      || fastLen < 2     || fastLen > 100)    return { error: "Fast MA must be between 2 and 100." };
    if(!Number.isFinite(slowLen)      || slowLen < 3     || slowLen > 500)    return { error: "Slow MA must be between 3 and 500." };
    if(fastLen >= slowLen)            return { error: "Fast MA must be smaller than Slow MA." };
    if(!Number.isFinite(atrLen)       || atrLen < 5      || atrLen > 100)     return { error: "ATR length must be between 5 and 100." };
    if(!["all","london","newyork","custom"].includes(session))                return { error: "Session filter is invalid." };
    if(!["conservative","optimistic","skip"].includes(conflictModel))         return { error: "Intrabar conflict model is invalid." };
    if(!Number.isFinite(startHour)    || startHour < 0   || startHour > 23)   return { error: "Start hour must be between 0 and 23." };
    if(!Number.isFinite(endHour)      || endHour   < 0   || endHour   > 23)   return { error: "End hour must be between 0 and 23." };
    if(startDate && endDate && Date.parse(`${startDate}T00:00:00Z`) > Date.parse(`${endDate}T00:00:00Z`))
      return { error: "Start date must be before or equal to End date." };

    return {
      instrument, timeframe, strategyId, strategyName: strategyDef.name,
      rules, trades, rr, startBalance, riskPct, costR, slAtr,
      candleCount, allowShort, fastLen, slowLen, atrLen,
      session, startDate, endDate, startHour, endHour, conflictModel
    };
  }

  /* ── main backtest ───────────────────────────────────────────────────── */
  async function buildResults(cfg){
    // Fetch raw candles — timeframe sent as seconds, matching the working HTML
    const msg = await requestCandles(cfg.instrument, cfg.timeframe, cfg.candleCount);

    // Convert to chronological closed candles — EXACT same three lines as
    // the working HTML:
    //   const closed  = candles.slice(1);   // drop forming bar (index 0)
    //   const cChron  = toChron(closed);     // oldest → newest
    const allClosed = getClosedChron(msg);

    if(allClosed.length < cfg.slowLen + 2)
      return { error: "Not enough closed candles returned. Increase lookback or check the instrument." };

    // Optional session / date filter
    const cChron = applyFilter(allClosed, cfg);

    if(cChron.length < cfg.slowLen + 2)
      return { error: "Not enough candles after date/session filters. Widen range or use 'All hours'." };

    // ATR array for stop sizing
    const atrArr = atr(cChron, cfg.atrLen);

    // Detect ALL crossover signals — identical logic to the working HTML
    const allSignals = findCrossoverSignals(cChron, cfg.fastLen, cfg.slowLen, cfg.allowShort);

    if(allSignals.length === 0)
      return { error: "No SMA crossover signals found. Try increasing lookback or adjusting MA lengths." };

    /* ── forward-test each signal ─────────────────────────────────────── */
    const rows      = [];
    let balance     = cfg.startBalance;
    let wins        = 0;
    let losses      = 0;
    let ambiguous   = 0;
    let skipUntil   = -1; // index: don't open a new trade before previous closed

    for(let si = 0; si < allSignals.length && rows.length < cfg.trades; si++){
      if(stopFlag) break;

      const sig = allSignals[si];

      // Skip signals that fall within a still-active trade
      if(sig.idx <= skipUntil) continue;

      // Entry: close of the crossover candle — same value the "Last 5 Signals"
      // scanner reports as the entry price
      const entry = sig.entry;
      if(!Number.isFinite(entry) || entry <= 0) continue;

      const stopDist = atrArr[sig.idx] * cfg.slAtr;
      if(!Number.isFinite(stopDist) || stopDist <= 0) continue;

      const stop = sig.dir === 1 ? entry - stopDist : entry + stopDist;
      const take = sig.dir === 1 ? entry + stopDist * cfg.rr : entry - stopDist * cfg.rr;

      let exitIdx   = sig.idx;
      let exitPrice = entry;
      let reason    = "No exit";
      let skipped   = false;

      // Walk forward from the candle AFTER the signal
      for(let j = sig.idx + 1; j < cChron.length; j++){
        const bar     = cChron[j];
        const hitStop = sig.dir === 1 ? bar.l <= stop : bar.h >= stop;
        const hitTake = sig.dir === 1 ? bar.h >= take : bar.l <= take;

        if(hitStop && hitTake){
          ambiguous++;
          exitIdx = j;
          if(cfg.conflictModel === "skip"){ skipped = true; break; }
          exitPrice = cfg.conflictModel === "optimistic" ? take : stop;
          reason    = `Stop+Take same bar (${cfg.conflictModel})`;
          break;
        }
        if(hitStop){
          exitIdx = j; exitPrice = stop; reason = "Stop"; break;
        }
        if(hitTake){
          exitIdx = j; exitPrice = take; reason = "Take profit"; break;
        }
        if(j === cChron.length - 1){
          exitIdx = j; exitPrice = bar.c; reason = "End of data";
        }
      }

      skipUntil = exitIdx;
      if(skipped || reason === "No exit") continue;

      const move   = sig.dir === 1 ? exitPrice - entry : entry - exitPrice;
      const grossR = move / stopDist;
      const applied = applyTrade(balance, cfg.riskPct, grossR, cfg.costR);
      balance = applied.nextBalance;
      if(grossR > 0) wins++; else losses++;

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
      return { error: "No trades completed. Try increasing candle count or widening date range." };

    const sessionLabel = {
      london: "London (7-16 UTC)", newyork: "New York (12-21 UTC)", all: "All hours"
    }[cfg.session] || `Custom ${cfg.startHour}-${cfg.endHour} UTC`;

    return {
      rows, wins, losses,
      endingBalance: balance,
      ambiguousBars: ambiguous,
      source: `LiquidCharts candles (${cChron.length}/${allClosed.length} closed in filter), ` +
              `${cfg.strategyName}, session ${sessionLabel}, intrabar ${cfg.conflictModel}`,
      fallbackUsed: false
    };
  }

  /* ── max drawdown ────────────────────────────────────────────────────── */
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
    const winRate       = (data.wins / data.rows.length) * 100;
    const dd            = maxDrawdownPct(data.rows, data.startBalance);
    const fmtMoney      = (v) => window.FMT ? window.FMT.money(v) : `$${v.toFixed(2)}`;
    const dateRange     = `${data.startDate || "start"} → ${data.endDate || "end"}`;

    $("btSummary").innerHTML = `
      <strong>${data.instrument}</strong> · ${data.timeframe} · ${data.strategyName}<br>
      Source: ${data.source}<br>
      Date range (UTC): ${dateRange}<br>
      Intrabar model: ${data.conflictModel} · Ambiguous bars: ${data.ambiguousBars ?? 0}<br>
      Rules: ${data.rules.replace(/\n/g, "<br>")}<br>
      Trades: ${data.rows.length} · Wins: ${data.wins} · Losses: ${data.losses}<br>
      Win rate: <strong>${winRate.toFixed(1)}%</strong> · Loss rate: <strong>${(100 - winRate).toFixed(1)}%</strong><br>
      Avg Net Expectancy: <strong>${avgNetR.toFixed(2)}R</strong> · Max DD: <strong>${dd.toFixed(2)}%</strong><br>
      Start/End Balance: <strong>${fmtMoney(data.startBalance)}</strong> → <strong>${fmtMoney(data.endingBalance)}</strong>
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
        <td>${window.FMT ? window.FMT.money(r.pnl)    : `$${r.pnl.toFixed(2)}`}</td>
        <td>${window.FMT ? window.FMT.money(r.balance) : `$${r.balance.toFixed(2)}`}</td>
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

  /* ── public interface ────────────────────────────────────────────────── */
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

    window.LC.setStatus(stopFlag ? "Backtest stopped" : "Backtest done", stopFlag ? "warn" : "ok");
    window.LC.log(`✅ Backtest complete: ${data.rows.length} trades — ${result.source}`);
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
      window.LC.log(`✅ Exported: ${filename}`);
    }else{
      window.LC.log("❌ Export utilities unavailable.");
    }
  }

  // Override ENG.Backtest — must load after engine-backtest.js
  window.ENG          = window.ENG || {};
  window.ENG.Backtest = { run, stop, clear, exportResults, syncLossRate };
})();
