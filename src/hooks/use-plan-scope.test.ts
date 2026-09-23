import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePlanScope } from "./use-plan-scope";
import { useViewStore } from "@/stores/use-view-store";
import type { Scope } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";

vi.mock("@/hooks/use-scope-labels", () => ({ useScopeLabels: () => ({}) }));
vi.mock("@/utils/scope-format", () => ({ formatScope: (scope: Scope) => scope.label }));

/** The cell each ref names, with the dates the backend would give it. */
function cellFor(ref: ScopeRef): Scope {
  const base = {
    id: 1, week_id: null, month_id: null, season_id: null, day_id: null, part: null,
    start_datetime: null, end_datetime: null,
  };
  if (ref.kind === "exact") throw new Error("not a cell");
  if (ref.kind === "part_of_day") {
    return { ...base, kind: "part_of_day", label: ref.part, start_date: ref.date, end_date: ref.date, part: ref.part };
  }
  switch (ref.kind) {
    case "day": return { ...base, kind: "day", label: "day", start_date: ref.date, end_date: ref.date };
    case "week":
      return ref.date >= "2026-09-27"
        ? { ...base, kind: "week", label: "W40", start_date: "2026-09-27", end_date: "2026-10-03" }
        : { ...base, kind: "week", label: "W39", start_date: "2026-09-20", end_date: "2026-09-26" };
    case "month":
      return ref.date >= "2026-10-01"
        ? { ...base, kind: "month", label: "Oct", start_date: "2026-10-01", end_date: "2026-10-31" }
        : { ...base, kind: "month", label: "Sep", start_date: "2026-09-01", end_date: "2026-09-30" };
    case "season": return { ...base, kind: "season", label: "Autumn", start_date: "2026-09-01", end_date: "2026-11-30" };
  }
}

const getOrCreateForRef = vi.fn((ref: ScopeRef) => Promise.resolve(cellFor(ref)));
vi.mock("@/api/scopes", () => ({ getOrCreateForRef: (ref: ScopeRef) => getOrCreateForRef(ref) }));

// 10:00 on Tuesday 22 September 2026 — inside the Morning band.
const NOW = new Date(2026, 8, 22, 10);

async function renderAt(kind: "part_of_day" | "day" | "week" | "month" | "season", now = NOW) {
  useViewStore.setState({ planScopeKind: kind });
  const hook = renderHook(() => usePlanScope(now));
  await waitFor(() => expect(hook.result.current.scope).not.toBeNull());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("going up to the parent scope", () => {
  it.each([
    ["part_of_day", "day", "2026-09-22"],
    ["day", "week", "2026-09-22"],
    ["week", "month", "2026-09-20"],
    ["month", "season", "2026-09-01"],
  ] as const)("goes from a %s to its %s", async (from, to, date) => {
    const { result } = await renderAt(from);
    expect(result.current.parentKind).toBe(to);

    act(() => result.current.goUp());
    expect(result.current.cursor.kind).toBe(to);
    expect(result.current.cursor.date).toBe(date);
    // The kind is the tab's: the selector reads it, so going up changes it there too.
    expect(useViewStore.getState().planScopeKind).toBe(to);
  });

  // A week at a month's edge sits in two months; Up stands in the one holding its first day.
  it("takes a week at a month's edge to the month of its first day", async () => {
    const { result } = await renderAt("week", new Date(2026, 8, 30, 10));
    act(() => result.current.goUp());
    expect(result.current.cursor).toMatchObject({ kind: "month", date: "2026-09-27" });
    await waitFor(() => expect(result.current.scope?.label).toBe("Sep"));
  });

  it("offers no Up from a Season, the top of the ladder", async () => {
    const { result } = await renderAt("season");
    expect(result.current.parentKind).toBeNull();

    act(() => result.current.goUp());
    expect(result.current.cursor.kind).toBe("season");
  });

  it("offers no Up while the scope is still being materialized", () => {
    getOrCreateForRef.mockReturnValueOnce(new Promise(() => {}));
    useViewStore.setState({ planScopeKind: "week" });
    const { result } = renderHook(() => usePlanScope(NOW));
    expect(result.current.parentKind).toBeNull();
  });
});
