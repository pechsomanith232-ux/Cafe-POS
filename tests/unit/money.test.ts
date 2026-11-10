import { describe, expect, it } from "vitest";
import {
  dec,
  roundTo,
  sum,
  toCostString,
  toMoneyString,
  toQtyString,
} from "@/lib/domain/money";

describe("dec", () => {
  it("adds decimals exactly (no float drift)", () => {
    expect(dec("0.1").plus("0.2").toString()).toBe("0.3");
  });

  it("accepts the strings Drizzle returns for numeric columns", () => {
    expect(dec("4.7500").equals(dec(4.75))).toBe(true);
  });

  it("rejects values that are not numbers", () => {
    expect(() => dec("abc")).toThrow();
    expect(() => dec("")).toThrow();
    expect(() => dec(Number.NaN)).toThrow(/finite/);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});

describe("roundTo", () => {
  it("rounds half away from zero", () => {
    expect(roundTo("2.345", 2).toString()).toBe("2.35");
    expect(roundTo("-2.345", 2).toString()).toBe("-2.35");
    expect(roundTo("2.344", 2).toString()).toBe("2.34");
  });
});

describe("sum", () => {
  it("sums a list of numeric strings exactly", () => {
    expect(sum(["17.70", "21.00", "0.01"]).toString()).toBe("38.71");
  });

  it("returns zero for an empty list", () => {
    expect(sum([]).toString()).toBe("0");
  });
});

describe("database strings (plan §2.5)", () => {
  it("formats money as numeric(18,4)", () => {
    expect(toMoneyString("4.75")).toBe("4.7500");
    expect(toMoneyString("0.00609756")).toBe("0.0061");
  });

  it("formats quantities as numeric(18,4)", () => {
    expect(toQtyString("24000")).toBe("24000.0000");
  });

  it("formats unit cost as numeric(18,6), e.g. the WAC example in §4.2", () => {
    const avg = dec("11800").times("0.0015").plus(dec("12000").times("0.00175")).div("23800");
    expect(avg.toString()).toMatch(/^0\.00162605042/);
    expect(toCostString(avg)).toBe("0.001626");
  });
});
