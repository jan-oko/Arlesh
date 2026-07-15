import { describe, it, expect } from "vitest";
import {
  kindsBelow, subdivisionsBetween, cycleScopeCellCount, cyclePlanCellCount, cyclePairKey, isCycleScopeKind,
  cycleLevels, pathToIndex, indexToPath,
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

describe("cycle navigation path (drill-down picker)", () => {
  it("has just one level when the target is immediately below the flow's own kind", () => {
    // A day-scoped flow (N=1) cycling by part-of-day: nothing to browse, straight to the 6 parts.
    expect(cycleLevels(1, "day", "part_of_day")).toEqual([
      { kind: "day", count: 1 },
      { kind: "part_of_day", count: 6 },
    ]);
  });

  it("adds one level per canonical kind between the flow's kind and the target", () => {
    // A 2-week flow cycling by part-of-day: which week, then which day, then which part.
    expect(cycleLevels(2, "week", "part_of_day")).toEqual([
      { kind: "week", count: 2 },
      { kind: "day", count: 7 },
      { kind: "part_of_day", count: 6 },
    ]);
  });

  it("is empty when the target isn't strictly finer than the flow's kind", () => {
    expect(cycleLevels(1, "day", "day")).toEqual([]);
    expect(cycleLevels(1, "part_of_day", "day")).toEqual([]);
  });

  it("round-trips a path through pathToIndex/indexToPath for a single-level picker", () => {
    const levels = cycleLevels(1, "day", "part_of_day");
    // Morning is the first part-of-day slot.
    expect(pathToIndex(levels, [1, 1])).toBe(1);
    expect(indexToPath(levels, 1)).toEqual([1, 1]);
  });

  it("round-trips a path through pathToIndex/indexToPath for a multi-level picker", () => {
    const levels = cycleLevels(2, "week", "part_of_day");
    // Week 2, Day 3 (of that week), Morning — 9 days after the flow start, part offset 0.
    const path = [2, 3, 1];
    const index = pathToIndex(levels, path);
    expect(index).toBe(55);
    expect(indexToPath(levels, index)).toEqual(path);
  });

  it("matches the flat cell count cycleScopeCellCount reports", () => {
    const levels = cycleLevels(2, "week", "part_of_day");
    const totalCells = cycleScopeCellCount(2, "week", "part_of_day");
    expect(pathToIndex(levels, [2, 7, 6])).toBe(totalCells);
  });
});
