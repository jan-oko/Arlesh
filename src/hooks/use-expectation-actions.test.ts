import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useExpectationActions } from "@/hooks/use-expectation-actions";
import { lane, patchedFields } from "@/test/lane-helpers";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const updateExpectation = vi.fn((_id: number | string, request: { status?: string }) =>
  Promise.resolve({ status: request.status }));
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  updateExpectation: (id: number | string, request: { status?: string }) => updateExpectation(id, request),
}));

function node(over: Partial<MindmapNode>): MindmapNode {
  return { id: "x", kind: "expectation", title: "Reply", position: 0, tagIds: [], children: [], ...over };
}

function setup(target: MindmapNode) {
  const showToast = vi.fn();
  const { result } = renderHook(() => useExpectationActions({ findNode: () => target, showToast }));
  return { actions: result.current, showToast };
}

describe("useExpectationActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePendingWritesStore.getState().reset();
    usePendingWritesStore.getState().reportBoard("test", { read: 0, epoch: null, revision: null });
  });

  it("releases a pending wait", () => {
    setup(node({ rowId: 3, status: "pending" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith(3, { status: "released" });
  });

  it("takes a release back", () => {
    setup(node({ rowId: 3, status: "released" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith(3, { status: "pending" });
  });

  it("shows the release at once and the returned row's status after the answer", async () => {
    setup(node({ rowId: 3, status: "pending" })).actions.toggleRelease("x");
    expect(patchedFields()).toEqual([{ status: "released" }]);
    await waitFor(() => expect(lane()[0]?.answer?.fields).toEqual({ status: "released" }));
  });

  it("refuses to release a delegated task's wait by hand, out loud", () => {
    const { actions, showToast } = setup(node({
      rowId: "d-5", origin: { kind: "delegation_wait", task_id: 5 }, status: "pending",
    }));
    actions.toggleRelease("x");
    expect(updateExpectation).not.toHaveBeenCalled();
    expect(lane()).toEqual([]);
    expect(showToast).toHaveBeenCalledWith({ nodeId: "x", message: "delegationWaitReleasedByTask" });
  });

  it("releases a spawned wait on its own row, like any wait", () => {
    setup(node({ rowId: "s-7", origin: { kind: "spawned_wait", task_id: 7 }, status: "pending" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith("s-7", { status: "released" });
  });
});
