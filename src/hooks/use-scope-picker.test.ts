import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScopePicker } from "./use-scope-picker";
import { getOrCreateScope } from "@/api/scopes";
import type { Scope } from "@/api/scopes";
import type { ScopeRef } from "@/utils/scope-ref";

vi.mock("@/api/scopes", () => ({
  getOrCreateScope: vi.fn(),
  getOrCreatePartScope: vi.fn(),
  getOrCreateExactScope: vi.fn(),
}));

function mkScope(id: number): Scope {
  return {
    id,
    kind: "week",
    label: "",
    start_date: "",
    end_date: "",
    week_id: null,
    month_id: null,
    season_id: null,
    day_id: null,
    part: null,
    start_datetime: null,
    end_datetime: null,
  };
}

const week = (date: string): ScopeRef => ({ kind: "week", date });

let counter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  // Idempotent by date, like the real get-or-create: the same cell yields the same id.
  const idByDate: Record<string, number> = {};
  vi.mocked(getOrCreateScope).mockImplementation((_kind, date) => {
    idByDate[date] ??= ++counter;
    return Promise.resolve(mkScope(idByDate[date]));
  });
});

describe("useScopePicker — single mode", () => {
  it("resolves a single click to a single-scope Time Scope", async () => {
    const { result } = renderHook(() => useScopePicker("single"));
    act(() => result.current.handleClick(week("2026-06-14")));
    const ts = await result.current.resolve();
    expect(ts).toEqual({ start_id: 1, end_id: 1 });
  });

  it("deselects when the same cell is clicked twice, resolving to null", async () => {
    const { result } = renderHook(() => useScopePicker("single"));
    act(() => result.current.handleClick(week("2026-06-14")));
    act(() => result.current.handleClick(week("2026-06-14")));
    const ts = await result.current.resolve();
    expect(ts).toBeNull();
  });
});

describe("useScopePicker — range mode", () => {
  it("resolves start + end clicks to a boundaries Time Scope", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.handleClick(week("2026-06-14")));
    act(() => result.current.handleClick(week("2026-06-28")));
    const ts = await result.current.resolve();
    expect(ts).toEqual({ start_id: 1, end_id: 2 });
  });

  it("resolves a single click to a single scope (start === end)", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.handleClick(week("2026-06-14")));
    const ts = await result.current.resolve();
    expect(ts).toEqual({ start_id: 1, end_id: 1 });
  });

  it("resolves to null when nothing is selected", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    const ts = await result.current.resolve();
    expect(ts).toBeNull();
  });

  it("reset clears the selection", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.handleClick(week("2026-06-14")));
    act(() => result.current.handleClick(week("2026-06-28")));
    act(() => result.current.reset());
    expect(result.current.range).toEqual({ start: null, end: null });
    const ts = await result.current.resolve();
    expect(ts).toBeNull();
  });
});
