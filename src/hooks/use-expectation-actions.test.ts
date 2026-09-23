import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useExpectationActions } from "@/hooks/use-expectation-actions";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const updateExpectation = vi.fn((_id: number, _request: unknown) => Promise.resolve());
const clearExpectationCheckBy = vi.fn((_id: number) => Promise.resolve());
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  updateExpectation: (id: number, request: unknown) => updateExpectation(id, request),
  clearExpectationCheckBy: (id: number) => clearExpectationCheckBy(id),
}));

function node(over: Partial<MindmapNode>): MindmapNode {
  return { id: "x", kind: "expectation", title: "Reply", position: 0, tagIds: [], children: [], ...over };
}

function setup(target: MindmapNode) {
  const reload = vi.fn(() => Promise.resolve());
  const showToast = vi.fn();
  const { result } = renderHook(() => useExpectationActions({ findNode: () => target, reload, showToast }));
  return { actions: result.current, showToast };
}

describe("useExpectationActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("releases a pending wait and takes a release back", () => {
    setup(node({ rowId: 3, status: "pending" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith(3, { status: "released" });
    setup(node({ rowId: 3, status: "released" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith(3, { status: "pending" });
  });

  it("refuses to release a delegated task's wait by hand, out loud", () => {
    const { actions, showToast } = setup(node({ virtual: true, delegationWait: { taskId: 5 }, status: "pending" }));
    actions.toggleRelease("x");
    expect(updateExpectation).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "x", message: "delegationWaitReleasedByTask" });
  });

  it("completes the check from the wait or from its check task", () => {
    setup(node({ rowId: 3, checkBy: { start_id: 1, end_id: 1 } })).actions.completeCheck("x");
    expect(clearExpectationCheckBy).toHaveBeenLastCalledWith(3);
    setup(node({ kind: "task", virtual: true, expectationCheck: { expectationId: 4 } })).actions.completeCheck("x");
    expect(clearExpectationCheckBy).toHaveBeenLastCalledWith(4);
  });

  it("says so when there is no check to complete", () => {
    const bare = setup(node({ rowId: 3, checkBy: null }));
    bare.actions.completeCheck("x");
    expect(bare.showToast).toHaveBeenCalledWith({ nodeId: "x", message: "noCheckBy" });
    const delegated = setup(node({ virtual: true, delegationWait: { taskId: 5 } }));
    delegated.actions.completeCheck("x");
    expect(delegated.showToast).toHaveBeenCalledWith({ nodeId: "x", message: "delegationWaitHasNoCheck" });
    expect(clearExpectationCheckBy).not.toHaveBeenCalled();
  });
});
