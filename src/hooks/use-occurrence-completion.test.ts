import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOccurrenceCompletion } from "./use-occurrence-completion";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/flows", () => ({
  setHabitItemStatus: vi.fn(),
  unfinishedChildren: vi.fn(),
}));

import { setHabitItemStatus, unfinishedChildren } from "@/api/flows";
import { testKey } from "@/test/scope-key";

const OCCURRENCE: MindmapNode = {
  id: "habit-3-0-virtual",
  kind: "task",
  title: "Groceries Mon",
  position: 0,
  tagIds: [],
  children: [],
  virtual: true,
  habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: testKey(100), cycleId: 0 },
};

const REFUSAL = { kind: "needs_confirmation", message: "still holds work" };
const MILK = [{ child_type: "task" as const, child_id: 12, title: "buy milk" }];

beforeEach(() => {
  vi.mocked(setHabitItemStatus).mockReset();
  vi.mocked(unfinishedChildren).mockReset().mockReturnValue(null);
});

describe("useOccurrenceCompletion", () => {
  it("writes straight through when the occurrence holds nothing unfinished", async () => {
    vi.mocked(setHabitItemStatus).mockResolvedValue(undefined);
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useOccurrenceCompletion(reload));

    act(() => { result.current.setOccurrenceStatus(OCCURRENCE, "done"); });

    await waitFor(() => { expect(reload).toHaveBeenCalled(); });
    expect(setHabitItemStatus).toHaveBeenCalledWith(
      3, "flow_root", 3, testKey(100), 0, "done", expect.any(Number), undefined,
    );
    expect(result.current.prompt).toBeNull();
  });

  it("raises a prompt naming the unfinished children instead of failing", async () => {
    vi.mocked(setHabitItemStatus).mockRejectedValue(REFUSAL);
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useOccurrenceCompletion(reload));

    act(() => { result.current.setOccurrenceStatus(OCCURRENCE, "done"); });

    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });
    expect(result.current.prompt?.title).toBe("Groceries Mon");
    expect(result.current.prompt?.children).toEqual(MILK);
    expect(reload).not.toHaveBeenCalled();
  });

  it("confirming asks again, acknowledged, and closes the prompt", async () => {
    vi.mocked(setHabitItemStatus).mockRejectedValueOnce(REFUSAL).mockResolvedValue(undefined);
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useOccurrenceCompletion(reload));

    act(() => { result.current.setOccurrenceStatus(OCCURRENCE, "done"); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.confirm(); });

    await waitFor(() => { expect(result.current.prompt).toBeNull(); });
    expect(setHabitItemStatus).toHaveBeenLastCalledWith(
      3, "flow_root", 3, testKey(100), 0, "done", expect.any(Number), true,
    );
    expect(reload).toHaveBeenCalled();
  });

  it("declining writes nothing at all, so there is nothing to take back", async () => {
    vi.mocked(setHabitItemStatus).mockRejectedValue(REFUSAL);
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const reload = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useOccurrenceCompletion(reload));

    act(() => { result.current.setOccurrenceStatus(OCCURRENCE, "done"); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.cancel(); });

    expect(result.current.prompt).toBeNull();
    expect(setHabitItemStatus).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not turn a real failure into a question", async () => {
    vi.mocked(setHabitItemStatus).mockRejectedValue(new Error("database is locked"));
    const reload = vi.fn(() => Promise.resolve());
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useOccurrenceCompletion(reload));

    act(() => { result.current.setOccurrenceStatus(OCCURRENCE, "done"); });

    await waitFor(() => { expect(errors).toHaveBeenCalled(); });
    expect(result.current.prompt).toBeNull();
    errors.mockRestore();
  });
});
