#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const headers = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx];
    });
    rows.push({
      date: Number(row.time_ms),
      o: Number(row.open),
      h: Number(row.high),
      l: Number(row.low),
      c: Number(row.close),
      v: Number(row.volume || 0)
    });
  }
  rows.sort((a, b) => a.date - b.date);
  return rows;
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function minutesUtc(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function inSession(minute, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  if (start <= end) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
}

function filterTradesBySession(trades, sessionStartMin, sessionEndMin) {
  if (!Number.isFinite(sessionStartMin) || !Number.isFinite(sessionEndMin)) return trades;
  return (trades || []).filter((t) => {
    const ts = Number(t.entryTime || t.exitTime || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return inSession(minutesUtc(ts), sessionStartMin, sessionEndMin);
  });
}

function summarize(trades, initialEquity) {
  let eq = initialEquity;
  let peak = initialEquity;
  let maxDd = 0;
  let grossWin = 0;
  let grossLoss = 0;
  const dayPnl = new Map();

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i] || {};
    const pnl = Number(t.pnlCurrency || 0);
    eq += pnl;
    if (pnl >= 0) grossWin += pnl;
    else grossLoss += Math.abs(pnl);

    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDd) maxDd = dd;

    const k = dayKey(Number(t.exitTime || t.entryTime || 0));
    dayPnl.set(k, (dayPnl.get(k) || 0) + pnl);
  }

  const vals = Array.from(dayPnl.values());
  const n = vals.length || 1;
  const mean = vals.reduce((a, v) => a + v, 0) / n;
  const std = Math.sqrt(vals.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n);
  const pos = vals.filter((v) => v > 0).length;
  const neg = vals.filter((v) => v < 0).length;
  const net = eq - initialEquity;
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  // Phase 2 objective: robustness-first score.
  const score =
    net
    - maxDd * 0.65
    - std * 1.5
    + (pos - neg) * 2.4
    + Math.min(pf, 3) * 3.2;

  return { net, maxDd, std, pos, neg, pf, score };
}

function setupBacktestEnv(candlesChron) {
  const newestFirst = candlesChron.slice().reverse();
  global.window = { LCPro: {} };
  window.LCPro.MarketData = {
    async requestCandles(_instrumentId, _timeframeSec, lookback) {
      const n = Math.max(1, Math.min(Number(lookback) || newestFirst.length, newestFirst.length));
      return { candles: newestFirst.slice(0, n) };
    },
    candlesToChron(candles) {
      return (candles || []).slice().reverse();
    }
  };
  vm.runInThisContext(fs.readFileSync(path.join("src", "backtest", "sma-crossover.js"), "utf8"));
  vm.runInThisContext(fs.readFileSync(path.join("src", "strategy", "actions.js"), "utf8"));
}

function* product(keys, grid, idx = 0, acc = {}) {
  if (idx >= keys.length) {
    yield { ...acc };
    return;
  }
  const k = keys[idx];
  const vals = grid[k] || [];
  for (let i = 0; i < vals.length; i++) {
    acc[k] = vals[i];
    yield* product(keys, grid, idx + 1, acc);
  }
}

function buildCandidates() {
  const pGrid = {
    stochLower: [40, 45],
    stochUpper: [60, 65],
    rsiBuyMax: [48, 50],
    rsiSellMin: [52, 53],
    srBufferTicks: [3, 4],
    cooldownBars: [1, 2],
    bbEntryEnabled: [false, true],
    bbConfluenceMode: ["either", "both"],
    bbReclaimRequired: [false, true]
  };

  const tmGrid = {
    slTicks: [6, 7],
    tpTicks: [6, 7],
    breakEvenTriggerTicks: [2, 3],
    maxBarsInTrade: [4, 5],
    slMode: ["fixed", "range"],
    slRangeMultiplier: [0.9, 1.0],
    sessionStartMin: [null, 14 * 60 + 30],
    sessionEndMin: [null, 20 * 60]
  };

  const pKeys = Object.keys(pGrid);
  const tKeys = Object.keys(tmGrid);
  const out = [];

  for (const p of product(pKeys, pGrid)) {
    if (p.stochLower >= p.stochUpper) continue;
    if (!p.bbEntryEnabled && (p.bbConfluenceMode !== "either" || p.bbReclaimRequired)) continue;
    for (const t of product(tKeys, tmGrid)) {
      if ((t.sessionStartMin == null) !== (t.sessionEndMin == null)) continue;
      if (t.tpTicks > t.slTicks + 1) continue;
      out.push({ params: { ...p }, tm: { ...t } });
    }
  }

  return out;
}

async function evaluateOnChron(chron, candidate, baseTM) {
  setupBacktestEnv(chron);
  const tm = Object.assign({}, baseTM, candidate.tm);
  const sessionStartMin = tm.sessionStartMin;
  const sessionEndMin = tm.sessionEndMin;
  delete tm.sessionStartMin;
  delete tm.sessionEndMin;

  const report = await window.LCPro.Strategy.runBacktest("nas100_rsi_sr_stoch_scalper", {
    instrumentId: "NDX",
    timeframeSec: 60,
    lookback: chron.length,
    keepN: 50000,
    rangePreset: "all",
    params: candidate.params,
    tradeManagement: tm
  });

  const tradesRaw = report.trades || [];
  const trades = filterTradesBySession(tradesRaw, sessionStartMin, sessionEndMin);
  return {
    trades,
    count: trades.length,
    summary: summarize(trades, 300)
  };
}

function buildWalkForwardFolds(allChron, trainPct, testPct, stepPct) {
  const n = allChron.length;
  const trainN = Math.max(500, Math.floor(n * trainPct));
  const testN = Math.max(200, Math.floor(n * testPct));
  const stepN = Math.max(150, Math.floor(n * stepPct));
  const folds = [];

  let start = 0;
  while (start + trainN + testN <= n) {
    const trainChron = allChron.slice(start, start + trainN);
    const testChron = allChron.slice(start + trainN, start + trainN + testN);
    folds.push({ trainChron, testChron, start, trainN, testN });
    start += stepN;
  }
  return folds;
}

async function run() {
  const dataset = path.join("exports", "NDX_1m_30d_2026-03-18.csv");
  const allChron = parseCsv(dataset);
  const candidates = buildCandidates();
  const folds = buildWalkForwardFolds(allChron, 0.55, 0.25, 0.1);

  const baseTM = {
    tickSize: 1,
    lots: 0.01,
    pointValue: 100,
    exitOnOpposite: true,
    bothHitModel: "sl_first",
    dynamicRangeLookback: 8,
    minDynamicSlTicks: 4,
    maxDynamicSlTicks: 9
  };

  const aggregate = [];

  // Keep runtime reasonable: random stride sample from candidate list.
  const stride = Math.max(1, Math.floor(candidates.length / 1400));
  const sampled = [];
  for (let i = 0; i < candidates.length; i += stride) sampled.push(candidates[i]);

  for (let i = 0; i < sampled.length; i++) {
    const c = sampled[i];
    let trainScore = 0;
    let testScore = 0;
    let trainTrades = 0;
    let testTrades = 0;
    let valid = true;

    for (let f = 0; f < folds.length; f++) {
      const fold = folds[f];
      const trainEval = await evaluateOnChron(fold.trainChron, c, baseTM);
      const testEval = await evaluateOnChron(fold.testChron, c, baseTM);

      if (trainEval.count < 18 || testEval.count < 8) {
        valid = false;
        break;
      }

      trainScore += trainEval.summary.score;
      testScore += testEval.summary.score;
      trainTrades += trainEval.count;
      testTrades += testEval.count;
    }

    if (!valid) continue;

    const trainAvg = trainScore / folds.length;
    const testAvg = testScore / folds.length;
    const combined = testAvg * 0.75 + trainAvg * 0.25;

    aggregate.push({
      params: c.params,
      tradeManagement: c.tm,
      folds: folds.length,
      trainTradesAvg: trainTrades / folds.length,
      testTradesAvg: testTrades / folds.length,
      trainScoreAvg: trainAvg,
      testScoreAvg: testAvg,
      combined
    });
  }

  aggregate.sort((a, b) => b.combined - a.combined);
  const top = aggregate.slice(0, 8).map((x, idx) => ({
    rank: idx + 1,
    params: x.params,
    tradeManagement: x.tradeManagement,
    folds: x.folds,
    trainTradesAvg: Number(x.trainTradesAvg.toFixed(2)),
    testTradesAvg: Number(x.testTradesAvg.toFixed(2)),
    trainScoreAvg: Number(x.trainScoreAvg.toFixed(3)),
    testScoreAvg: Number(x.testScoreAvg.toFixed(3)),
    combined: Number(x.combined.toFixed(3))
  }));

  const output = {
    dataset,
    rows: allChron.length,
    folds: folds.length,
    sampledCandidates: sampled.length,
    retainedCandidates: aggregate.length,
    top
  };

  const outPath = path.join("exports", "optimization_phase2_30d_1m.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, top1: top[0] || null }, null, 2));
}

run().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
