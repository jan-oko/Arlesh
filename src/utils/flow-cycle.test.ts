import { describe, it, expect } from "vitest";
import {
  kindsBelow, subdivisionsBetween, cycleScopeCellCount, cyclePlanCellCount, cyclePairKey, isCycleScopeKind,
} from "./flow-cycle";

describe("flow-cycle geometry", () => {
  it("lists the kinds strictly below a given kind", () => {
    expect(kindsBelow("week")).toEqual(["day", "part_of_day"]);
    expect(kindsBelow("day")).toEqual(["part_of_day"]);
    expect(kindsBelow("part_of_day")).toEqual([]);
    expect(kindsBelow("season")).toEqual(["month", "week", "day", "part_of_day"]);
  });

  it("multiplies adjacent subdivisions", () => {
    expect(subdivisionsBetween("week", "day")).toBe(7);
    expect(subdivisionsBetween("day", "part_of_day")).toBe(6);
    expect(subdivisionsBetween("week", "part_of_day")).toBe(42);
    expect(subdivisionsBetween("season", "day")).toBe(3 * 4 * 7);
  });

  it("returns 0 when the child is not strictly finer", () => {
    expect(subdivisionsBetween("day", "week")).toBe(0);
    expect(subdivisionsBetween("week", "week")).toBe(1);
  });

  it("counts cycle-scope cells across the whole flow window", () => {
    expect(cycleScopeCellCount(2, "week", "day")).toBe(14);
    expect(cycleScopeCellCount(3, "month", "week")).toBe(12);
  });

  it("counts cycle-plan cells within one cycle scope", () => {
    expect(cyclePlanCellCount("day", "part_of_day")).toBe(6);
  });

  it("validates scope kinds", () => {
    expect(isCycleScopeKind("day")).toBe(true);
    expect(isCycleScopeKind("exact")).toBe(false);
  });

  it("keys cycle pairs distinctly, treating null as a wildcard slot", () => {
    const whole = { scopeKind: null, scopeIndex: null, planKind: null, planStart: null, planEnd: null };
    const day3 = { scopeKind: "day", scopeIndex: 3, planKind: null, planStart: null, planEnd: null };
    expect(cyclePairKey(whole)).not.toBe(cyclePairKey(day3));
    expect(cyclePairKey(day3)).toBe(cyclePairKey({ ...day3 }));
  });
});
