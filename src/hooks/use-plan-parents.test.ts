import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePlanParents } from "./use-plan-parents";
import type { Scope, ScopeKind } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";

const getOrCreateForRef = vi.fn((ref: ScopeRef) =>
  Promise.resolve(scope(ref.kind === "exact" ? "exact" : ref.kind, "date" in ref ? ref.date : "", ref.kind === "month" && "date" in ref && ref.date.startsWith("2026-10") ? 31 : 30)),
);
vi.mock("@/api/scopes", () => ({ getOrCreateForRef: (ref: ScopeRef) => getOrCreateForRef(ref) }));

function scope(kind: ScopeKind, start: string, id = 1, end = start): Scope {
  return {
    id, kind, label: kind, start_date: start, end_date: end,
    week_id: null, month_id: null, season_id: null, day_id: null, part: null,
    start_datetime: null, end_datetime: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlanParents", () => {
  it("materializes the month a week sits in", async () => {
    const week = scope("week", "2026-09-20", 10, "2026-09-26");
    const { result } = renderHook(() => usePlanParents(week));
    expect(result.current.exists).toBe(true);
    await waitFor(() => expect([...result.current.ids]).toEqual([30]));
  });

  it("materializes both months of a week at a month's edge", async () => {
    const week = scope("week", "2026-09-27", 11, "2026-10-03");
    const { result } = renderHook(() => usePlanParents(week));
    await waitFor(() => expect([...result.current.ids].sort()).toEqual([30, 31]));
  });

  it("has no parent for a Season, and asks the backend for none", () => {
    const season = scope("season", "2026-09-01", 40, "2026-11-30");
    const { result } = renderHook(() => usePlanParents(season));
    expect(result.current.exists).toBe(false);
    expect(result.current.ids.size).toBe(0);
    expect(getOrCreateForRef).not.toHaveBeenCalled();
  });
});
