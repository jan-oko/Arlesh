import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskBacklog } from "./use-task-backlog";
import { updateTask } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

const PLAN = { start_id: 4, end_id: 4 };

/** The refusal `update_task` returns rather than throwing a Plan away unasked. */
const NEEDS_CONFIRMATION = { kind: "needs_confirmation", message: "a backlogged task cannot also be planned" };

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() =>
    useTaskBacklog({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useTaskBacklog", () => {
  it("puts an ordinary task in the backlog", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5", { status: "todo" })]);

    act(() => { result.current.toggleBacklog("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { archival: "backlog" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("takes a backlogged task back out — the same key reverses itself", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { status: "in_progress", backlogged: true })]);

    act(() => { result.current.toggleBacklog("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { archival: "live" }));
  });

  it("raises a prompt instead of silently dropping a planned task's Plan", async () => {
    vi.mocked(updateTask).mockRejectedValue(NEEDS_CONFIRMATION);
    const { result } = setup([node("task-5", { status: "todo", plan: PLAN, title: "Ship it" })]);

    act(() => { result.current.toggleBacklog("task-5"); });

    await waitFor(() => expect(result.current.planPrompt).not.toBeNull());
    expect(result.current.planPrompt?.title).toBe("Ship it");
    expect(result.current.planPrompt?.plan).toEqual(PLAN);
  });

  it("clears the Plan and backlogs in one write when the prompt is accepted", async () => {
    vi.mocked(updateTask).mockRejectedValueOnce(NEEDS_CONFIRMATION).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5", { status: "todo", plan: PLAN })]);

    act(() => { result.current.toggleBacklog("task-5"); });
    await waitFor(() => expect(result.current.planPrompt).not.toBeNull());
    act(() => { result.current.confirmClearPlan(); });

    await waitFor(() =>
      expect(updateTask).toHaveBeenLastCalledWith(5, { archival: "backlog", plan: null }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(result.current.planPrompt).toBeNull();
  });

  it("declining writes nothing — the task keeps its plan and stays out of the backlog", async () => {
    vi.mocked(updateTask).mockRejectedValue(NEEDS_CONFIRMATION);
    const { result } = setup([node("task-5", { status: "todo", plan: PLAN })]);

    act(() => { result.current.toggleBacklog("task-5"); });
    await waitFor(() => expect(result.current.planPrompt).not.toBeNull());
    act(() => { result.current.cancelPlanPrompt(); });

    expect(result.current.planPrompt).toBeNull();
    // Only the refused attempt; nothing was written.
    expect(updateTask).toHaveBeenCalledTimes(1);
  });

  it("reports a real failure as a toast rather than as a prompt", async () => {
    vi.mocked(updateTask).mockRejectedValue({ kind: "database", message: "disk is full" });
    const { result, showToast } = setup([node("task-5", { status: "todo" })]);

    act(() => { result.current.toggleBacklog("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(result.current.planPrompt).toBeNull();
  });

  it("ignores a goal, a container and a virtual Habit instance — none has a backlog column", () => {
    const { result } = setup([
      { ...node("goal-1"), kind: "goal" },
      { ...node("project-1"), kind: "project" },
      node("task-9", { habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3 } }),
    ]);

    act(() => {
      result.current.toggleBacklog("goal-1");
      result.current.toggleBacklog("project-1");
      result.current.toggleBacklog("task-9");
      result.current.toggleBacklog("task-missing");
    });

    expect(updateTask).not.toHaveBeenCalled();
  });
});
