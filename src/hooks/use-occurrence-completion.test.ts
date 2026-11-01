import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOccurrenceCompletion } from "./use-occurrence-completion";
import type { GuardedAction } from "./use-occurrence-completion";
import type { MindmapNode } from "@/utils/tree-layout";
import type { WriteResult } from "@/stores/use-pending-writes-store";
import { occurrenceRow } from "@/test/occurrence";
import { lane } from "@/test/lane-helpers";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";

const OCCURRENCE: MindmapNode = {
  id: "habit-3-0",
  kind: "task",
  title: "Groceries Mon",
  position: 0,
  tagIds: [],
  children: [],
  ...occurrenceRow({ habitId: 3, itemType: "flow_root", itemId: 3 }),
};

const MILK = [{ child_type: "task" as const, child_id: 12, title: "buy milk" }];
const HOLDING = { kind: "needs_confirmation", message: "still holds work", details: { children: MILK } };
const WRITTEN: WriteResult = { outcome: "written", response: { epoch: null, revision: null, fields: null, createdId: null } };

function action(send: GuardedAction["send"]): GuardedAction {
  return {
    label: "status change",
    patch: { kind: "fields", fields: { status: "done" } },
    send,
    refuseReadOnly: vi.fn(),
  };
}

function setup() {
  const showToast = vi.fn();
  return { ...renderHook(() => useOccurrenceCompletion({ showToast })), showToast };
}

beforeEach(() => {
  usePendingWritesStore.getState().reset();
  usePendingWritesStore.getState().reportBoard("test", { read: 0, epoch: null, revision: null });
});

describe("useOccurrenceCompletion", () => {
  it("writes straight through when the occurrence holds nothing unfinished", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.resolve(WRITTEN));
    const { result, showToast } = setup();

    act(() => { result.current.submit(OCCURRENCE, action(send)); });

    await waitFor(() => { expect(send).toHaveBeenCalledWith(false); });
    expect(result.current.prompt).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("rolls the patch back and raises a prompt naming the unfinished children, with no toast", async () => {
    const send = vi.fn((_confirmed: boolean) => Promise.reject(HOLDING));
    const { result, showToast } = setup();

    act(() => { result.current.submit(OCCURRENCE, action(send)); });

    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });
    expect(result.current.prompt?.title).toBe("Groceries Mon");
    expect(result.current.prompt?.children).toEqual(MILK);
    expect(lane()).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("confirming sends the same write again, acknowledged, patch and all, and closes the prompt", async () => {
    const send = vi.fn((confirmed: boolean) => (confirmed ? new Promise<WriteResult>(() => undefined) : Promise.reject(HOLDING)));
    const { result } = setup();
    act(() => { result.current.submit(OCCURRENCE, action(send)); });
    await waitFor(() => { expect(result.current.prompt).not.toBeNull(); });

    act(() => { result.current.confirm(); });

    expect(result.current.prompt).toBeNull();
    expect(send).toHaveBeenLastCalledWith(true);
    expect(lane().map((write) => write.patch)).toEqual([{ kind: "fields", fields: { status: "done" } }]);
  });

  it("declining sends nothing more, so there is nothing to take back", async () => {
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
