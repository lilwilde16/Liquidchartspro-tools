#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

function parseArgs(argv) {
  const out = {
    symbol: "^NDX",
    interval: "5m",
    range: "1mo",
    includePrePost: false,
    outFile: ""
  };

  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || "");
    if (a === "--symbol" && i + 1 < argv.length) out.symbol = String(argv[++i]);
    else if (a === "--interval" && i + 1 < argv.length) out.interval = String(argv[++i]);
    else if (a === "--range" && i + 1 < argv.length) out.range = String(argv[++i]);
    else if (a === "--out" && i + 1 < argv.length) out.outFile = String(argv[++i]);
    else if (a === "--prepost") out.includePrePost = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/fetch-yahoo-chart.js --symbol ^NDX --interval 5m --range 1mo",
    "",
    "Options:",
    "  --symbol    Yahoo symbol (default: ^NDX)",
    "  --interval  1m|2m|5m|15m|30m|60m|90m|1d|1wk|1mo (default: 5m)",
    "  --range     1d|5d|1mo|3mo|6mo|1y|2y|5y|max (default: 1mo)",
    "  --out       Output CSV path (default writes to exports/)",
    "  --prepost   Include pre/after-market where available",
    "  -h, --help  Show this help"
  ].join("\n");
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 LiquidChartsPro-Tools"
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk);
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error("Failed to parse JSON response"));
          }
        });
      }
    );
    req.on("error", reject);
  });
}

function sanitizeSymbol(s) {
  return String(s || "symbol")
    .replace(/[^a-zA-Z0-9_\-^]/g, "_")
    .replace(/^\^/, "")
    .toUpperCase();
}

function defaultOutFile(symbol, interval, range) {
  const today = new Date().toISOString().slice(0, 10);
  return path.join("exports", `${sanitizeSymbol(symbol)}_${interval}_${range}_${today}.csv`);
}

function toCsvRows(payload) {
  const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result) {
    const msg = payload && payload.chart && payload.chart.error && payload.chart.error.description;
    throw new Error(msg || "No chart result returned");
  }

  const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
  if (!quote) throw new Error("No quote payload returned");

  const open = Array.isArray(quote.open) ? quote.open : [];
  const high = Array.isArray(quote.high) ? quote.high : [];
  const low = Array.isArray(quote.low) ? quote.low : [];
  const close = Array.isArray(quote.close) ? quote.close : [];
  const volume = Array.isArray(quote.volume) ? quote.volume : [];

  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const t = Number(ts[i]) * 1000;
    const o = Number(open[i]);
    const h = Number(high[i]);
    const l = Number(low[i]);
    const c = Number(close[i]);
    const v = Number(volume[i]);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      continue;
    }
    const timeIso = new Date(t).toISOString();
    rows.push({ timeIso, timeMs: t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }

  rows.sort((a, b) => a.timeMs - b.timeMs);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const symbol = args.symbol;
  const interval = args.interval;
  const range = args.range;
  const outFile = args.outFile || defaultOutFile(symbol, interval, range);

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=${args.includePrePost ? "true" : "false"}`;

  const payload = await httpGetJson(url);
  const rows = toCsvRows(payload);
  if (!rows.length) {
    throw new Error("No candle rows returned for that symbol/interval/range");
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const lines = ["time_iso,time_ms,open,high,low,close,volume"];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines.push(
      [r.timeIso, String(r.timeMs), String(r.o), String(r.h), String(r.l), String(r.c), String(r.v)].join(",")
    );
  }
  fs.writeFileSync(outFile, lines.join("\n") + "\n", "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        symbol,
        interval,
        range,
        rows: rows.length,
        from: rows[0].timeIso,
        to: rows[rows.length - 1].timeIso,
        outFile
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
