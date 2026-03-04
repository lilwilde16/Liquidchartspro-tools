/**
 * src/tests/util-backtest.test.js
 *
 * Unit tests for src/functions/util-backtest.js
 * Run: npm test
 */
"use strict";

const {
  maxDrawdown,
  maxDrawdownPct,
  winRate,
  expectancy,
  profitFactor,
  pipSize,
  priceToPips,
  pipsToPrice,
  calculateLotSize,
  formatDuration,
  calculateTradeStats
} = require("../functions/util-backtest");

// ── maxDrawdown ────────────────────────────────────────────────────────────────

describe("maxDrawdown", () => {
  test("returns 0 for empty array", () => {
    expect(maxDrawdown([])).toBe(0);
  });

  test("returns 0 for always-rising equity", () => {
    expect(maxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  test("calculates correct drawdown percentage", () => {
    // peak=120, then drops to 90 → DD = (120-90)/120 = 0.25
    const dd = maxDrawdown([100, 120, 110, 90, 95]);
    expect(dd).toBeCloseTo(0.25, 5);
  });
});

// ── maxDrawdownPct ─────────────────────────────────────────────────────────────

describe("maxDrawdownPct", () => {
  test("returns 0 for empty trades", () => {
    expect(maxDrawdownPct([], 1000)).toBe(0);
  });

  test("computes max drawdown from trade records", () => {
    const trades = [
      { balance: 1000 },
      { balance: 1100 },
      { balance: 950 }, // DD = (1100-950)/1100 ≈ 13.6%
      { balance: 1050 }
    ];
    const dd = maxDrawdownPct(trades, 1000);
    expect(dd).toBeCloseTo(13.636, 1);
  });
});

// ── winRate ────────────────────────────────────────────────────────────────────

describe("winRate", () => {
  test("returns 0 for empty trades", () => {
    expect(winRate([])).toBe(0);
  });

  test("calculates win rate correctly", () => {
    const trades = [
      { pnl: 50 },
      { pnl: -30 },
      { pnl: 20 },
      { pnl: -10 }
    ];
    expect(winRate(trades)).toBeCloseTo(50, 5); // 2 wins out of 4
  });

  test("returns 100 when all trades win", () => {
    const trades = [{ pnl: 10 }, { pnl: 20 }, { pnl: 5 }];
    expect(winRate(trades)).toBe(100);
  });

  test("returns 0 when all trades lose", () => {
    const trades = [{ pnl: -10 }, { pnl: -20 }];
    expect(winRate(trades)).toBe(0);
  });
});

// ── expectancy ─────────────────────────────────────────────────────────────────

describe("expectancy", () => {
  test("returns 0 for empty trades", () => {
    expect(expectancy([])).toBe(0);
  });

  test("calculates average R-multiple", () => {
    const trades = [{ netR: 1.5 }, { netR: -1 }, { netR: 2 }];
    expect(expectancy(trades)).toBeCloseTo(0.833, 2); // (1.5 - 1 + 2) / 3
  });
});

// ── profitFactor ───────────────────────────────────────────────────────────────

describe("profitFactor", () => {
  test("returns 0 for empty trades", () => {
    expect(profitFactor([])).toBe(0);
  });

  test("calculates profit factor", () => {
    const trades = [
      { pnl: 100 },
      { pnl: 50 },
      { pnl: -60 }
    ];
    // gross profit = 150, gross loss = 60 → PF = 2.5
    expect(profitFactor(trades)).toBeCloseTo(2.5, 5);
  });

  test("returns Infinity when no losses", () => {
    const trades = [{ pnl: 100 }, { pnl: 50 }];
    expect(profitFactor(trades)).toBe(Infinity);
  });
});

// ── pipSize ────────────────────────────────────────────────────────────────────

describe("pipSize", () => {
  test("returns 0.01 for JPY pairs", () => {
    expect(pipSize("USDJPY")).toBeCloseTo(0.01);
    expect(pipSize("EUR/JPY")).toBeCloseTo(0.01);
  });

  test("returns 0.0001 for non-JPY pairs", () => {
    expect(pipSize("EURUSD")).toBeCloseTo(0.0001);
    expect(pipSize("GBPUSD")).toBeCloseTo(0.0001);
  });

  test("returns 0.0001 for null/empty", () => {
    expect(pipSize(null)).toBeCloseTo(0.0001);
    expect(pipSize("")).toBeCloseTo(0.0001);
  });
});

// ── priceToPips / pipsToPrice ──────────────────────────────────────────────────

describe("priceToPips / pipsToPrice", () => {
  test("converts 10 pips for EURUSD", () => {
    expect(priceToPips(0.0010, "EURUSD")).toBeCloseTo(10, 5);
  });

  test("round-trips pips → price → pips for USDJPY", () => {
    const pips = 50;
    const price = pipsToPrice(pips, "USDJPY");
    expect(priceToPips(price, "USDJPY")).toBeCloseTo(50, 5);
  });
});

// ── calculateLotSize ───────────────────────────────────────────────────────────

describe("calculateLotSize", () => {
  test("returns minimum 0.01 lots", () => {
    const lots = calculateLotSize(1000, 1, 20, "EURUSD");
    expect(lots).toBeGreaterThanOrEqual(0.01);
  });

  test("returns 0 for invalid inputs", () => {
    expect(calculateLotSize(0, 1, 20, "EURUSD")).toBe(0);
    expect(calculateLotSize(1000, 0, 20, "EURUSD")).toBe(0);
    expect(calculateLotSize(1000, 1, 0, "EURUSD")).toBe(0);
  });
});

// ── formatDuration ─────────────────────────────────────────────────────────────

describe("formatDuration", () => {
  test("formats seconds", () => {
    expect(formatDuration(45000)).toBe("45s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(90000)).toBe("1m 30s");
  });

  test("formats hours and minutes", () => {
    expect(formatDuration(3600000 + 300000)).toBe("1h 5m");
  });

  test("formats days", () => {
    expect(formatDuration(86400000 + 3600000)).toBe("1d 1h");
  });

  test("returns '0s' for invalid input", () => {
    expect(formatDuration(NaN)).toBe("0s");
    expect(formatDuration(-1)).toBe("0s");
  });
});

// ── calculateTradeStats ────────────────────────────────────────────────────────

describe("calculateTradeStats", () => {
  test("returns zeroed stats for empty trades", () => {
    const stats = calculateTradeStats([], 1000);
    expect(stats.totalTrades).toBe(0);
    expect(stats.winRate).toBe(0);
  });

  test("calculates correct stats for a set of trades", () => {
    const trades = [
      { pnl: 100, netR: 1, balance: 1100 },
      { pnl: -50, netR: -1, balance: 1050 },
      { pnl: 200, netR: 2, balance: 1250 }
    ];
    const stats = calculateTradeStats(trades, 1000);
    expect(stats.totalTrades).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.67, 1);
    expect(stats.totalPnL).toBeCloseTo(250, 5);
  });
});
