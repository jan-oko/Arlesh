import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { useStableKeys, useTemporaryIds } from "@/hooks/use-temporary-ids";

const store = () => usePendingWritesStore.getState();

function enqueueCreate(tmp: string, send: () => Promise<never> | Promise<{ outcome: "written"; response: { epoch: null; revision: null; fields: null; createdId: string } }>) {
  store().enqueue({
    nodeId: tmp, label: "create",
    patch: { kind: "create", parentId: "goal-1", afterId: null, node: { id: tmp, kind: "task", title: "" } },
    send, showToast: vi.fn(), unreachableMessage: "unreachable",
  });
}

beforeEach(() => store().reset());

describe("useTemporaryIds", () => {
  it("tells a holder the real id when a create is answered, and keeps one React key across the change", async () => {
    const onResolved = vi.fn();
    renderHook(() => useTemporaryIds({ onResolved }));
    const keys = renderHook(() => useStableKeys());
    await act(async () => {
      enqueueCreate("tmp:1", () => Promise.resolve({ outcome: "written", response: { epoch: null, revision: null, fields: null, createdId: "task-9" } }));
      await store().whenDrained();
    });
    expect(onResolved).toHaveBeenCalledWith("tmp:1", "task-9");
    expect(keys.result.current("task-9")).toBe("tmp:1");
    expect(keys.result.current("task-2")).toBe("task-2");
  });

  it("tells a holder which placeholders left when their create was refused", async () => {
    const onRemoved = vi.fn();
    renderHook(() => useTemporaryIds({ onRemoved }));
    await act(async () => {
      enqueueCreate("tmp:1", () => Promise.reject(new Error("no")));
      await store().whenDrained();
    });
    expect(onRemoved).toHaveBeenCalledWith([{ id: "tmp:1", parentId: "goal-1" }]);
  });
});
