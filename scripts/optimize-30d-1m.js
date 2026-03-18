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

  // Robustness score: rewards return and daily consistency, penalizes drawdown and volatility.
  const score = net - maxDd * 0.55 - std * 1.35 + (pos - neg) * 2.2 + Math.min(pf, 3) * 3;

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

function buildCandidates() {
  const pGrid = {
    stochLower: [35, 40, 45],
    stochUpper: [60, 65],
    rsiBuyMax: [47, 50],
    rsiSellMin: [50, 53],
    srBufferTicks: [3, 4, 5],
    cooldownBars: [1, 2],
    bbEntryEnabled: [false],
    bbConfluenceMode: ["either"]
  };

  const tmGrid = {
    slTicks: [6, 7, 8],
    tpTicks: [5, 6, 7],
    breakEvenTriggerTicks: [2, 3, 4],
    maxBarsInTrade: [4, 5],
    slMode: ["fixed", "range"],
    slRangeMultiplier: [1.0]
  };

  const pKeys = Object.keys(pGrid);
  const tKeys = Object.keys(tmGrid);

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

  const out = [];
  for (const p of product(pKeys, pGrid)) {
    if (p.stochLower >= p.stochUpper) continue;
    for (const t of product(tKeys, tmGrid)) {
      if (t.tpTicks > t.slTicks + 1) continue;
      out.push({ params: { ...p }, tm: { ...t } });
    }
  }
  return out;
}

async function run() {
  const inputFile = path.join("exports", "NDX_1m_30d_2026-03-18.csv");
  const allChron = parseCsv(inputFile);
  const split = Math.floor(allChron.length * 0.67);
  const trainChron = allChron.slice(0, split);
  const testChron = allChron.slice(split);

  const baseTM = {
    tickSize: 1,
    lots: 0.01,
    pointValue: 100,
    exitOnOpposite: true,
    bothHitModel: "sl_first",
    dynamicRangeLookback: 8,
    minDynamicSlTicks: 4,
    maxDynamicSlTicks: 8
  };

  const candidates = buildCandidates();

  setupBacktestEnv(trainChron);
  const trainRank = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const report = await window.LCPro.Strategy.runBacktest("nas100_rsi_sr_stoch_scalper", {
      instrumentId: "NDX",
      timeframeSec: 60,
      lookback: trainChron.length,
      keepN: 50000,
      rangePreset: "all",
      params: c.params,
      tradeManagement: Object.assign({}, baseTM, c.tm)
    });
    const trades = report.trades || [];
    if (trades.length < 30) continue;
    trainRank.push({
      params: c.params,
      tm: c.tm,
      trainTrades: trades.length,
      train: summarize(trades, 300)
    });
  }
  trainRank.sort((a, b) => b.train.score - a.train.score);
  const finalists = trainRank.slice(0, 12);

  setupBacktestEnv(testChron);
  const evaluated = [];
  for (let i = 0; i < finalists.length; i++) {
    const f = finalists[i];
    const report = await window.LCPro.Strategy.runBacktest("nas100_rsi_sr_stoch_scalper", {
      instrumentId: "NDX",
      timeframeSec: 60,
      lookback: testChron.length,
      keepN: 50000,
      rangePreset: "all",
      params: f.params,
      tradeManagement: Object.assign({}, baseTM, f.tm)
    });
    const test = summarize(report.trades || [], 300);
    const combined = test.score * 0.7 + f.train.score * 0.3;
    evaluated.push({
      params: f.params,
      tradeManagement: f.tm,
      trainTrades: f.trainTrades,
      train: f.train,
      testTrades: (report.trades || []).length,
      test,
      combined
    });
  }
  evaluated.sort((a, b) => b.combined - a.combined);

  const top = evaluated.slice(0, 5).map((x, idx) => ({
    rank: idx + 1,
    params: x.params,
    tradeManagement: x.tradeManagement,
    trainTrades: x.trainTrades,
    train: x.train,
    testTrades: x.testTrades,
    test: x.test,
    combined: Number(x.combined.toFixed(3))
  }));

  const output = {
    dataset: inputFile,
    rows: allChron.length,
    split: { trainRows: trainChron.length, testRows: testChron.length },
    candidatesEvaluated: candidates.length,
    trainQualified: trainRank.length,
    top
  };

  const outPath = path.join("exports", "optimization_30d_1m.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, top1: top[0] || null }, null, 2));
}

run().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
