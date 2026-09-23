import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlanParents } from "./use-plan-parents";
import type { Scope, ScopeKind } from "@/api/scopes";

function scope(kind: ScopeKind, start: string, end = start): Scope {
  return {
    id: `${kind}:${start}`, kind, label: kind, start_date: start, end_date: end,
    part: null, start_datetime: null, end_datetime: null,
  };
}

describe("usePlanParents", () => {
  it("names the month a week sits in", () => {
    const { result } = renderHook(() => usePlanParents(scope("week", "2026-09-20", "2026-09-26")));
    expect(result.current.exists).toBe(true);
    expect([...result.current.ids]).toEqual(["month:2026-09-01"]);
  });

  it("names both months of a week at a month's edge", () => {
    const { result } = renderHook(() => usePlanParents(scope("week", "2026-09-27", "2026-10-03")));
    expect([...result.current.ids].sort()).toEqual(["month:2026-09-01", "month:2026-10-01"]);
  });

  it("names the week a day sits in and the season a month sits in", () => {
    const day = renderHook(() => usePlanParents(scope("day", "2026-09-23")));
    expect([...day.result.current.ids]).toEqual(["week:2026-09-20"]);
    const month = renderHook(() => usePlanParents(scope("month", "2027-01-01", "2027-01-31")));
    expect([...month.result.current.ids]).toEqual(["season:2026-12-01"]);
  });

  it("has no parent for a Season", () => {
    const { result } = renderHook(() => usePlanParents(scope("season", "2026-09-01", "2026-11-30")));
    expect(result.current.exists).toBe(false);
    expect(result.current.ids.size).toBe(0);
  });

  it("has nothing to say before the scope is known", () => {
    const { result } = renderHook(() => usePlanParents(null));
    expect(result.current.exists).toBe(false);
    expect(result.current.ids.size).toBe(0);
  });
});
