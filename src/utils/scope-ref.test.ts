import { describe, it, expect } from "vitest";
import {
  sameScopeRef,
  refSortKey,
  orderRefs,
  nextSingleSelection,
  nextRangeSelection,
  adjustRangeEndpoint,
  type ScopeRef,
} from "./scope-ref";

const week = (date: string): ScopeRef => ({ kind: "week", date });
const day = (date: string): ScopeRef => ({ kind: "day", date });

describe("sameScopeRef", () => {
  it("matches canonical refs of the same kind and date", () => {
    expect(sameScopeRef(week("2026-06-14"), week("2026-06-14"))).toBe(true);
    expect(sameScopeRef(week("2026-06-14"), week("2026-06-21"))).toBe(false);
  });

  it("distinguishes different kinds with the same date", () => {
    expect(sameScopeRef(week("2026-06-14"), day("2026-06-14"))).toBe(false);
  });

  it("compares part and datetimes for part-of-day and exact refs", () => {
    const morning: ScopeRef = { kind: "part_of_day", date: "2026-06-20", part: "morning" };
    const night: ScopeRef = { kind: "part_of_day", date: "2026-06-20", part: "night" };
    expect(sameScopeRef(morning, { ...morning })).toBe(true);
    expect(sameScopeRef(morning, night)).toBe(false);

    const a: ScopeRef = { kind: "exact", start: "2026-06-20T09:00:00", end: "2026-06-20T10:00:00" };
    expect(sameScopeRef(a, { ...a })).toBe(true);
    expect(sameScopeRef(a, { ...a, end: "2026-06-20T11:00:00" })).toBe(false);
  });
});

describe("refSortKey / orderRefs", () => {
  it("orders canonical refs by date", () => {
    const [first, second] = orderRefs(week("2026-06-21"), week("2026-06-14"));
    expect(first).toEqual(week("2026-06-14"));
    expect(second).toEqual(week("2026-06-21"));
  });

  it("orders parts of the same day by start hour", () => {
    const morning: ScopeRef = { kind: "part_of_day", date: "2026-06-20", part: "morning" };
    const evening: ScopeRef = { kind: "part_of_day", date: "2026-06-20", part: "evening" };
    expect(refSortKey(morning) < refSortKey(evening)).toBe(true);
  });
});

describe("nextSingleSelection", () => {
  it("selects when nothing is selected", () => {
    expect(nextSingleSelection(null, day("2026-06-20"))).toEqual(day("2026-06-20"));
  });

  it("replaces a different selection", () => {
    expect(nextSingleSelection(day("2026-06-20"), day("2026-06-21"))).toEqual(day("2026-06-21"));
  });

  it("deselects when the selected cell is clicked again", () => {
    expect(nextSingleSelection(day("2026-06-20"), day("2026-06-20"))).toBeNull();
  });
});

describe("nextRangeSelection", () => {
  it("first click sets the start and clears the end", () => {
    expect(nextRangeSelection({ start: null, end: null }, week("2026-06-14"))).toEqual({
      start: week("2026-06-14"),
      end: null,
    });
  });

  it("second click sets the end", () => {
    const state = nextRangeSelection({ start: week("2026-06-14"), end: null }, week("2026-06-28"));
    expect(state).toEqual({ start: week("2026-06-14"), end: week("2026-06-28") });
  });

  it("second click earlier than start swaps them so start stays earliest", () => {
    const state = nextRangeSelection({ start: week("2026-06-28"), end: null }, week("2026-06-14"));
    expect(state).toEqual({ start: week("2026-06-14"), end: week("2026-06-28") });
  });

  it("third click (both set) resets to a new start", () => {
    const both = { start: week("2026-06-14"), end: week("2026-06-28") };
    expect(nextRangeSelection(both, week("2026-07-05"))).toEqual({
      start: week("2026-07-05"),
      end: null,
    });
  });
});

describe("adjustRangeEndpoint", () => {
  it("moves an endpoint and re-orders", () => {
    const both = { start: week("2026-06-14"), end: week("2026-06-28") };
    // Drag the start past the end → they swap.
    const moved = adjustRangeEndpoint(both, "start", week("2026-07-05"));
    expect(moved).toEqual({ start: week("2026-06-28"), end: week("2026-07-05") });
  });
});
