import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOccurrenceCompletion } from "./use-occurrence-completion";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";

vi.mock("@/api/flows", () => ({
  unfinishedChildren: vi.fn(),
}));

import { unfinishedChildren } from "@/api/flows";

const OCCURRENCE: MindmapNode = {
  id: "habit-3-0",
  kind: "task",
  title: "Groceries Mon",
  position: 0,
  tagIds: [],
  children: [],
  ...occurrenceRow({ habitId: 3, itemType: "flow_root", itemId: 3 }),
};

const REFUSAL = { kind: "needs_confirmation", message: "still holds work" };
const MILK = [{ child_type: "task" as const, child_id: 12, title: "buy milk" }];

beforeEach(() => {
  vi.mocked(unfinishedChildren).mockReset().mockReturnValue(null);
});

describe("useOccurrenceCompletion", () => {
  it("writes straight through when the occurrence holds nothing unfinished", async () => {
    const write = vi.fn((_confirmed: boolean) => Promise.resolve());
    const onError = vi.fn();
    const { result } = renderHook(() => useOccurrenceCompletion());

    act(() => { result.current.guard(OCCURRENCE, write, onError); });

    await waitFor(() => { expect(write).toHaveBeenCalledWith(false); });
    expect(result.current.prompt).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("raises a prompt naming the unfinished children instead of failing", async () => {
    const write = vi.fn((_confirmed: boolean) => Promise.reject(REFUSAL));
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const onError = vi.fn();
    const { result } = renderHook(() => useOccurrenceCompletion());

    act(() => { result.current.guard(OCCURRENCE, write, onError); });

    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });
    expect(result.current.prompt?.title).toBe("Groceries Mon");
    expect(result.current.prompt?.children).toEqual(MILK);
    expect(onError).not.toHaveBeenCalled();
  });

  it("confirming runs the same write again, acknowledged, and closes the prompt", async () => {
    const write = vi.fn((confirmed: boolean) => (confirmed ? Promise.resolve() : Promise.reject(REFUSAL)));
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const { result } = renderHook(() => useOccurrenceCompletion());

    act(() => { result.current.guard(OCCURRENCE, write, vi.fn()); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.confirm(); });

    await waitFor(() => { expect(result.current.prompt).toBeNull(); });
    expect(write).toHaveBeenLastCalledWith(true);
  });

  it("declining writes nothing at all, so there is nothing to take back", async () => {
    const write = vi.fn((_confirmed: boolean) => Promise.reject(REFUSAL));
    vi.mocked(unfinishedChildren).mockReturnValue(MILK);
    const { result } = renderHook(() => useOccurrenceCompletion());

    act(() => { result.current.guard(OCCURRENCE, write, vi.fn()); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.cancel(); });

    expect(result.current.prompt).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not turn a real failure into a question", async () => {
    const failure = new Error("database is locked");
    const write = vi.fn((_confirmed: boolean) => Promise.reject(failure));
    const onError = vi.fn();
    const { result } = renderHook(() => useOccurrenceCompletion());

    act(() => { result.current.guard(OCCURRENCE, write, onError); });

    await waitFor(() => { expect(onError).toHaveBeenCalledWith(failure); });
    expect(result.current.prompt).toBeNull();
  });
});
