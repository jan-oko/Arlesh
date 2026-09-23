import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import { useExpectationActions } from "@/hooks/use-expectation-actions";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const updateExpectation = vi.fn((_id: number, _request: unknown) => Promise.resolve());
const completeExpectationCheck = vi.fn((_id: number) => Promise.resolve());
const updateSpawnedWait = vi.fn((_taskId: number, _request: unknown) => Promise.resolve());
const completeSpawnedWaitCheck = vi.fn((_taskId: number) => Promise.resolve());
const reopenExpectationCheck = vi.fn((_id: number, _dueAt: string) => Promise.resolve());
const reopenSpawnedWaitCheck = vi.fn((_taskId: number, _dueAt: string) => Promise.resolve());
vi.mock("@/api/expectations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/expectations")>()),
  updateExpectation: (id: number, request: unknown) => updateExpectation(id, request),
  completeExpectationCheck: (id: number) => completeExpectationCheck(id),
  updateSpawnedWait: (taskId: number, request: unknown) => updateSpawnedWait(taskId, request),
  completeSpawnedWaitCheck: (taskId: number) => completeSpawnedWaitCheck(taskId),
  reopenExpectationCheck: (id: number, dueAt: string) => reopenExpectationCheck(id, dueAt),
  reopenSpawnedWaitCheck: (taskId: number, dueAt: string) => reopenSpawnedWaitCheck(taskId, dueAt),
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

  it("completes the check from its check task", () => {
    setup(node({ kind: "task", virtual: true, expectationCheck: { kind: "stored", expectationId: 4 } })).actions.completeCheck("x");
    expect(completeExpectationCheck).toHaveBeenLastCalledWith(4);
  });

  it("reopens a done check task instead of completing another", () => {
    const done = { kind: "task" as const, virtual: true, status: "done", checkDueAt: "2026-07-03T02:00:00" };
    setup(node({ ...done, expectationCheck: { kind: "stored", expectationId: 4 } })).actions.completeCheck("x");
    expect(reopenExpectationCheck).toHaveBeenLastCalledWith(4, "2026-07-03T02:00:00");
    setup(node({ ...done, expectationCheck: { kind: "spawned", taskId: 7 } })).actions.completeCheck("x");
    expect(reopenSpawnedWaitCheck).toHaveBeenLastCalledWith(7, "2026-07-03T02:00:00");
    expect(completeExpectationCheck).not.toHaveBeenCalled();
    expect(completeSpawnedWaitCheck).not.toHaveBeenCalled();
  });

  it("works a spawned wait through its task's overlay", () => {
    const spawned: Partial<MindmapNode> = { virtual: true, spawnedBy: { taskId: 7 }, checkEvery: { n: 2, kind: "day" } };
    setup(node({ ...spawned, status: "pending" })).actions.toggleRelease("x");
    expect(updateSpawnedWait).toHaveBeenLastCalledWith(7, { status: "released" });
    setup(node({ kind: "task", virtual: true, expectationCheck: { kind: "spawned", taskId: 7 } })).actions.completeCheck("x");
    expect(completeSpawnedWaitCheck).toHaveBeenLastCalledWith(7);
    expect(updateExpectation).not.toHaveBeenCalled();
  });
});
