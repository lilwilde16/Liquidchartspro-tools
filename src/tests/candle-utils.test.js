/**
 * src/tests/candle-utils.test.js
 *
 * Unit tests for src/functions/candle-utils.js
 * Run: npm test
 */
"use strict";

const { candleTimeMs, normalizeCandles } = require("../functions/candle-utils");

describe("candleTimeMs", () => {
  test("converts seconds-epoch to milliseconds", () => {
    expect(candleTimeMs(1700000000)).toBe(1700000000000);
  });

  test("passes through milliseconds-epoch unchanged", () => {
    expect(candleTimeMs(1700000000000)).toBe(1700000000000);
  });

  test("returns 0 for null/undefined/NaN", () => {
    expect(candleTimeMs(null)).toBe(0);
    expect(candleTimeMs(undefined)).toBe(0);
    expect(candleTimeMs(NaN)).toBe(0);
  });

  test("returns 0 for negative values", () => {
    expect(candleTimeMs(-1)).toBe(0);
  });
});

describe("normalizeCandles", () => {
  test("handles array-of-arrays format", () => {
    const raw = [
      [1700000000, 1.10, 1.11, 1.09, 1.105],
      [1700001000, 1.105, 1.12, 1.10, 1.115]
    ];
    const result = normalizeCandles(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ o: 1.10, h: 1.11, l: 1.09, c: 1.105 });
  });

  test("handles array-of-objects format", () => {
    const raw = [
      { time: 1700000000000, open: 1.10, high: 1.11, low: 1.09, close: 1.105 },
      { time: 1700001000000, open: 1.105, high: 1.12, low: 1.10, close: 1.115 }
    ];
    const result = normalizeCandles(raw);
    expect(result).toHaveLength(2);
    expect(result[0].o).toBeCloseTo(1.10);
    expect(result[0].h).toBeCloseTo(1.11);
  });

  test("handles short-key object format (t/o/h/l/c)", () => {
    const raw = [
      { t: 1700000000000, o: 1.10, h: 1.11, l: 1.09, c: 1.105 }
    ];
    const result = normalizeCandles(raw);
    expect(result).toHaveLength(1);
    expect(result[0].c).toBeCloseTo(1.105);
  });

  test("filters out candles with NaN OHLC values", () => {
    const raw = [
      { t: 1700000000000, o: NaN, h: 1.11, l: 1.09, c: 1.105 },
      { t: 1700001000000, o: 1.105, h: 1.12, l: 1.10, c: 1.115 }
    ];
    const result = normalizeCandles(raw);
    expect(result).toHaveLength(1);
  });

  test("returns empty array for null/undefined input", () => {
    expect(normalizeCandles(null)).toEqual([]);
    expect(normalizeCandles(undefined)).toEqual([]);
  });

  test("returns empty array for empty input", () => {
    expect(normalizeCandles([])).toEqual([]);
  });

  test("ensures chronological order (oldest first)", () => {
    // Reversed order (newest first) should be flipped
    const raw = [
      { t: 1700002000000, o: 1.12, h: 1.13, l: 1.11, c: 1.125 },
      { t: 1700001000000, o: 1.105, h: 1.12, l: 1.10, c: 1.115 },
      { t: 1700000000000, o: 1.10, h: 1.11, l: 1.09, c: 1.105 }
    ];
    const result = normalizeCandles(raw);
    expect(result[0].t).toBeLessThan(result[1].t);
    expect(result[1].t).toBeLessThan(result[2].t);
  });
});
