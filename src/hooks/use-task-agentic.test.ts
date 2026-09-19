import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskAgentic } from "./use-task-agentic";
import { updateTask } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() =>
    useTaskAgentic({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useTaskAgentic", () => {
  it("marks an unset task agentic — the state every task starts in is one press from Yes", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.cycleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "yes" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("moves an agentic task to explicitly not agentic", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { agentic: true })]);

    act(() => { result.current.cycleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "no" }));
  });

  it("closes the cycle: a not-agentic task goes back to inheriting", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { agentic: false })]);

    act(() => { result.current.cycleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "inherit" }));
  });

  it("reads the task's own flag, not what it inherits — an inherited yes still cycles to yes", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    // Reads as agentic on screen, but has given no answer of its own. Cycling what it *reads as*
    // would jump it straight to "no" and detach it from the ancestor deciding for it.
    const { result } = setup([node("task-5", { agentic: null, inheritedAgentic: true })]);

    act(() => { result.current.cycleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "yes" }));
  });

  it("declines every node that has no agentic column of its own", () => {
    const goal = node("goal-1", { kind: "goal" });
    const habitInstance = node("task-4-virtual", {
      virtual: true,
      habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100 },
    });
    const { result } = setup([goal, habitInstance]);

    act(() => {
      result.current.cycleAgentic("goal-1");
      result.current.cycleAgentic("task-4-virtual");
      result.current.cycleAgentic("task-missing");
    });

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("says so when the write fails rather than leaving the flag silently unchanged", async () => {
    vi.mocked(updateTask).mockRejectedValue(new Error("db is gone"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.cycleAgentic("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "task-5" }),
    ));
  });
});
