import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useExpectationActions } from "@/hooks/use-expectation-actions";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const updateExpectation = vi.fn((_id: number | string, _request: unknown) => Promise.resolve());
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  updateExpectation: (id: number | string, request: unknown) => updateExpectation(id, request),
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
    const { actions, showToast } = setup(node({
      rowId: "d-5", origin: { kind: "delegation_wait", task_id: 5 }, status: "pending",
    }));
    actions.toggleRelease("x");
    expect(updateExpectation).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "x", message: "delegationWaitReleasedByTask" });
  });

  it("releases a spawned wait on its own row, like any wait", () => {
    setup(node({ rowId: "s-7", origin: { kind: "spawned_wait", task_id: 7 }, status: "pending" })).actions.toggleRelease("x");
    expect(updateExpectation).toHaveBeenLastCalledWith("s-7", { status: "released" });
  });
});
