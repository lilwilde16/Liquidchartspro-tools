/**
 * src/tests/util-indicators.test.js
 *
 * Unit tests for src/functions/util-indicators.js
 * Run: npm test
 */
"use strict";

const { sma, atr, rsi, linregSlope, toChron } = require("../functions/util-indicators");

describe("sma", () => {
  test("computes simple moving average", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = sma(values, 3);
    // index 2: (1+2+3)/3 = 2
    expect(result[2]).toBeCloseTo(2);
    // index 9: (8+9+10)/3 = 9
    expect(result[9]).toBeCloseTo(9);
  });

  test("returns null for indices before period-1", () => {
    const values = [1, 2, 3, 4, 5];
    const result = sma(values, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).not.toBeNull();
  });

  test("handles period equal to array length", () => {
    const values = [2, 4, 6, 8];
    const result = sma(values, 4);
    expect(result[3]).toBeCloseTo(5); // (2+4+6+8)/4 = 5
  });
});

describe("atr", () => {
  test("computes ATR values", () => {
    // Build simple OHLC data
    const n = 20;
    const high  = Array.from({ length: n }, (_, i) => 100 + i + 1);
    const low   = Array.from({ length: n }, (_, i) => 100 + i - 1);
    const close = Array.from({ length: n }, (_, i) => 100 + i);
    const result = atr(high, low, close, 14);
    // ATR should start being defined from index 14
    expect(result[14]).not.toBeNull();
    expect(result[14]).toBeGreaterThan(0);
    // Early values should be null
    expect(result[0]).toBeNull();
  });
});

describe("rsi", () => {
  test("returns values between 0 and 100", () => {
    // Alternating up/down prices → RSI near 50
    const close = [];
    for (let i = 0; i < 30; i++) {
      close.push(100 + (i % 2 === 0 ? 1 : -1));
    }
    const result = rsi(close, 7);
    const defined = result.filter((v) => v !== null);
    defined.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  test("returns mostly null before the period", () => {
    const close = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(close, 7);
    expect(result[0]).toBeNull();
    expect(result[6]).toBeNull();
    expect(result[7]).not.toBeNull();
  });

  test("RSI is high when prices consistently rise", () => {
    const close = Array.from({ length: 30 }, (_, i) => 100 + i);
    const result = rsi(close, 7);
    const lastDefined = result.filter((v) => v !== null).pop();
    expect(lastDefined).toBeGreaterThan(80);
  });

  test("RSI is low when prices consistently fall", () => {
    const close = Array.from({ length: 30 }, (_, i) => 200 - i);
    const result = rsi(close, 7);
    const lastDefined = result.filter((v) => v !== null).pop();
    expect(lastDefined).toBeLessThan(20);
  });
});

describe("linregSlope", () => {
  test("returns positive slope for ascending data", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = linregSlope(values, 5);
    expect(result[9]).toBeGreaterThan(0);
  });

  test("returns negative slope for descending data", () => {
    const values = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const result = linregSlope(values, 5);
    expect(result[9]).toBeLessThan(0);
  });

  test("returns null for indices before period-1", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const result = linregSlope(values, 5);
    expect(result[0]).toBeNull();
    expect(result[3]).toBeNull();
    expect(result[4]).not.toBeNull();
  });
});

describe("toChron", () => {
  test("reverses array", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(toChron(arr)).toEqual([5, 4, 3, 2, 1]);
  });

  test("handles single-element array", () => {
    expect(toChron([42])).toEqual([42]);
  });

  test("handles empty array", () => {
    expect(toChron([])).toEqual([]);
  });
});
