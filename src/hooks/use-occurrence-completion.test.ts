import { storedRowId } from "@/test/stored-id";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOccurrenceCompletion } from "./use-occurrence-completion";
import type { GuardedAction } from "./use-occurrence-completion";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";

const OCCURRENCE: MindmapNode = {
  id: "habit-3-0",
  kind: "task",
  title: "Groceries Mon",
  position: 0,
  tagIds: [],
  children: [],
  ...occurrenceRow({ habitId: 3, itemType: "flow_root", itemId: 3 }),
};

const MILK = [{ child_type: "task" as const, child_id: storedRowId(12), title: "buy milk" }];
const HOLDING = { kind: "needs_confirmation", message: "still holds work", details: { children: MILK } };

function action(send: GuardedAction["send"]): GuardedAction {
  return {
    send,
    refuseReadOnly: vi.fn(),
  };
}

function setup() {
  const showToast = vi.fn();
  return { ...renderHook(() => useOccurrenceCompletion({ showToast })), showToast };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useOccurrenceCompletion", () => {
  it("writes straight through when the occurrence holds nothing unfinished", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.resolve());
    const { result, showToast } = setup();

    await act(async () => { await result.current.submit(OCCURRENCE, action(send)); });

    expect(send).toHaveBeenCalledWith(false);
    expect(result.current.prompt).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("raises a prompt naming the unfinished children, with no toast", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.reject(HOLDING));
    const { result, showToast } = setup();

    act(() => { result.current.submit(OCCURRENCE, action(send)); });

    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });
    expect(result.current.prompt?.title).toBe("Groceries Mon");
    expect(result.current.prompt?.children).toEqual(MILK);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("confirming sends the same write again, acknowledged, and closes the prompt", async () => {
    const send = vi.fn((confirmed: boolean) => (confirmed ? new Promise<void>(() => undefined) : Promise.reject(HOLDING)));
    const { result } = setup();
    act(() => { result.current.submit(OCCURRENCE, action(send)); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.confirm(); });

    expect(result.current.prompt).toBeNull();
    expect(send).toHaveBeenLastCalledWith(true);
  });

  it("declining sends nothing more", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.reject(HOLDING));
    const { result } = setup();
    act(() => { result.current.submit(OCCURRENCE, action(send)); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.cancel(); });

    expect(result.current.prompt).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not turn a real failure into a question", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.reject({ kind: "database", message: "database is locked" }));
    const { result, showToast } = setup();

    act(() => { result.current.submit(OCCURRENCE, action(send)); });

    await waitFor(() => { expect(showToast).toHaveBeenCalledWith({ nodeId: OCCURRENCE.id, message: "database is locked" }); });
    expect(result.current.prompt).toBeNull();
  });
});
