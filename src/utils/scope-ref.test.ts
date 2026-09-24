import { describe, it, expect } from "vitest";
import {
  sameScopeRef,
  refSortKey,
  orderRefs,
  nextSingleSelection,
  nextRangeSelection,
  adjustRangeEndpoint,
  refForScope,
  refsForScopes,
  seededRange,
  type ScopeRef,
} from "./scope-ref";
import type { Scope } from "@/api/scopes";

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

describe("refForScope", () => {
  function scope(fields: Partial<Scope>): Scope {
    return {
      id: { kind: "day", date: "2026-09-16" }, kind: "day", label: "", start_date: "2026-09-16", end_date: "2026-09-16",
      part: null, start_datetime: null, end_datetime: null,
      ...fields,
    };
  }

  it("reads a canonical scope as its cell", () => {
    expect(refForScope(scope({ kind: "month", start_date: "2026-09-01" }))).toEqual({
      kind: "month",
      date: "2026-09-01",
    });
  });

  it("reads a part-of-day scope as its date and band", () => {
    expect(refForScope(scope({ kind: "part_of_day", part: "night" }))).toEqual({
      kind: "part_of_day",
      date: "2026-09-16",
      part: "night",
    });
  });

  it("reads an exact scope as its datetime window", () => {
    const exact = scope({
      kind: "exact",
      start_datetime: "2026-09-16T14:00:00",
      end_datetime: "2026-09-16T15:00:00",
    });
    expect(refForScope(exact)).toEqual({
      kind: "exact",
      start: "2026-09-16T14:00:00",
      end: "2026-09-16T15:00:00",
    });
  });

  it("names no cell for a row missing its band or datetimes", () => {
    expect(refForScope(scope({ kind: "part_of_day", part: null }))).toBeNull();
    expect(refForScope(scope({ kind: "exact" }))).toBeNull();
  });
});

describe("refsForScopes", () => {
  const month = (_id: number, startDate: string): Scope => ({
    id: { kind: "month", date: startDate }, kind: "month", label: "", start_date: startDate, end_date: startDate,
    part: null, start_datetime: null, end_datetime: null,
  });

  it("gives one ref per scope, taken from its start_date", () => {
    expect(refsForScopes([month(1, "2026-06-01"), month(2, "2026-08-01")])).toEqual([
      { kind: "month", date: "2026-06-01" },
      { kind: "month", date: "2026-08-01" },
    ]);
  });

  it("drops a row that names no calendar cell", () => {
    const broken: Scope = { ...month(3, "2026-06-01"), kind: "part_of_day", part: null };
    expect(refsForScopes([broken, month(1, "2026-06-01")])).toEqual([
      { kind: "month", date: "2026-06-01" },
    ]);
  });
});

describe("seededRange", () => {
  it("seeds a two-endpoint window as a closed range, earliest first", () => {
    expect(seededRange([week("2026-06-21"), week("2026-06-07")])).toEqual({
      start: week("2026-06-07"),
      end: week("2026-06-21"),
    });
  });

  it("seeds a single-scope window as both endpoints of the same cell", () => {
    expect(seededRange([day("2026-06-20"), day("2026-06-20")])).toEqual({
      start: day("2026-06-20"),
      end: day("2026-06-20"),
    });
  });

  it("seeds nothing when a window has fewer than two drawable cells", () => {
    expect(seededRange([])).toEqual({ start: null, end: null });
    expect(seededRange([day("2026-06-20")])).toEqual({ start: null, end: null });
  });

  it("is closed, so the next click starts a new range rather than extending it", () => {
    const seeded = seededRange([week("2026-06-07"), week("2026-06-07")]);
    expect(nextRangeSelection(seeded, week("2026-06-21"))).toEqual({
      start: week("2026-06-21"),
      end: null,
    });
  });
});
