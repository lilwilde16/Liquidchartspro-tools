/**
 * src/tests/util-format.test.js
 *
 * Unit tests for src/functions/util-format.js
 * Run: npm test
 */
"use strict";

const { num, pct, money } = require("../functions/util-format");

describe("num", () => {
  test("formats a number to 2 decimal places by default", () => {
    expect(num(1234.5678)).toBe("1,234.57");
  });

  test("respects custom digits parameter", () => {
    expect(num(1.23456, 4)).toBe("1.2346");
  });

  test("returns '0' for non-finite values", () => {
    expect(num(NaN)).toBe("0");
    expect(num(Infinity)).toBe("0");
    expect(num(undefined)).toBe("0");
    // null coerces to 0, which is finite → formats as "0.00"
    expect(num(null)).toBe("0.00");
  });

  test("handles zero", () => {
    expect(num(0)).toBe("0.00");
  });

  test("handles negative numbers", () => {
    const result = num(-1234.56);
    expect(result).toContain("1,234.56");
  });
});

describe("pct", () => {
  test("appends percent sign", () => {
    expect(pct(55.1)).toBe("55.1%");
  });

  test("respects digits parameter", () => {
    expect(pct(55.1234, 2)).toBe("55.12%");
  });
});

describe("money", () => {
  test("prepends dollar sign and formats to 2 dp", () => {
    expect(money(1000)).toBe("$1,000.00");
  });

  test("returns '$0.00' for non-finite values", () => {
    expect(money(NaN)).toBe("$0.00");
    expect(money(Infinity)).toBe("$0.00");
    expect(money(undefined)).toBe("$0.00");
  });

  test("handles negative money", () => {
    const result = money(-500.5);
    expect(result).toContain("500.50");
  });
});
