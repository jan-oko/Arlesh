import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScopePicker } from "./use-scope-picker";
import type { ScopeRef } from "@/utils/scope-ref";

const week = (date: string): ScopeRef => ({ kind: "week", date });

// A selection resolves to value keys, derived on the spot: nothing is asked of the backend and
// the same cell always names the same scope.
const JUNE_14 = { kind: "week", date: "2026-06-14" };
const JUNE_28 = { kind: "week", date: "2026-06-28" };

describe("useScopePicker — single mode", () => {
  it("resolves a single click to a single-scope Time Scope", async () => {
    const { result } = renderHook(() => useScopePicker("single"));
    act(() => result.current.handleClick(week("2026-06-14")));
    const ts = await result.current.resolve();
    expect(ts).toEqual({ start_id: JUNE_14, end_id: JUNE_14 });
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
    expect(ts).toEqual({ start_id: JUNE_14, end_id: JUNE_28 });
  });

  it("resolves a single click to a single scope (start === end)", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.handleClick(week("2026-06-14")));
    const ts = await result.current.resolve();
    expect(ts).toEqual({ start_id: JUNE_14, end_id: JUNE_14 });
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

describe("useScopePicker — seeding", () => {
  it("seeds a range picker from a stored window and resolves it back unchanged", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.seed([week("2026-06-14"), week("2026-06-28")]));
    expect(result.current.range).toEqual({ start: week("2026-06-14"), end: week("2026-06-28") });
    expect(await result.current.resolve()).toEqual({ start_id: JUNE_14, end_id: JUNE_28 });
  });

  it("makes a seeded range closed, so the next click starts a new one", () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.seed([week("2026-06-14"), week("2026-06-14")]));
    act(() => result.current.handleClick(week("2026-06-28")));
    expect(result.current.range).toEqual({ start: week("2026-06-28"), end: null });
  });

  it("seeds a single picker with the first cell", () => {
    const { result } = renderHook(() => useScopePicker("single"));
    act(() => result.current.seed([week("2026-06-14")]));
    expect(result.current.single).toEqual(week("2026-06-14"));
  });

  it("seeding an empty list clears the selection", async () => {
    const { result } = renderHook(() => useScopePicker("range"));
    act(() => result.current.handleClick(week("2026-06-14")));
    act(() => result.current.seed([]));
    expect(result.current.range).toEqual({ start: null, end: null });
    expect(await result.current.resolve()).toBeNull();
  });
});
