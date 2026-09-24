import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePlanParents } from "./use-plan-parents";
import type { Scope } from "@/api/scopes";
import type { CanonicalKind } from "@/utils/scope-ref";
import { scopeKeyText } from "@/utils/scope-key";

function scope(kind: CanonicalKind, start: string, end = start): Scope {
  return {
    id: { kind, date: start }, kind, label: kind, start_date: start, end_date: end,
    part: null, start_datetime: null, end_datetime: null,
  };
}

/** The parents' canonical texts, for the keys named. */
function texts(...keys: Array<{ kind: CanonicalKind; date: string }>): string[] {
  return keys.map(scopeKeyText);
}

describe("usePlanParents", () => {
  it("names the month a week sits in", () => {
    const { result } = renderHook(() => usePlanParents(scope("week", "2026-09-20", "2026-09-26")));
    expect(result.current.exists).toBe(true);
    expect([...result.current.ids]).toEqual(texts({ kind: "month", date: "2026-09-01" }));
  });

  it("names only the month of the first day for a week at a month's edge", () => {
    const { result } = renderHook(() => usePlanParents(scope("week", "2026-09-27", "2026-10-03")));
    expect([...result.current.ids]).toEqual(texts({ kind: "month", date: "2026-09-01" }));
  });

  it("names the week a day sits in and the season a month sits in", () => {
    const day = renderHook(() => usePlanParents(scope("day", "2026-09-23")));
    expect([...day.result.current.ids]).toEqual(texts({ kind: "week", date: "2026-09-20" }));
    const month = renderHook(() => usePlanParents(scope("month", "2027-01-01", "2027-01-31")));
    expect([...month.result.current.ids]).toEqual(texts({ kind: "season", date: "2026-12-01" }));
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
