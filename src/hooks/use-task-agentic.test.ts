import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskAgentic } from "./use-task-agentic";
import { updateTask } from "@/api/tasks";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  updateTask: vi.fn(),
}));

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
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
  it("marks an unset task agentic in one press — the state every task starts in", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "yes" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("turns an agentic task off in one press", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { agentic: true })]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "no" }));
  });

  it("turns an explicit No back on in one press, not two", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    // Under a non-agentic parent this reads exactly like an unset task, so sending it to Inherit
    // first would spend a press on a move nothing on screen could show.
    const { result } = setup([node("task-5", { agentic: false, inheritedAgentic: false })]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "yes" }));
  });

  it("pins a task that was only inheriting Yes to an explicit No", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    // Reads as agentic, so one press has to turn the badge off. That detaches it from the ancestor
    // deciding for it, which is the toggle's price: the editor is where Inherit comes back.
    const { result } = setup([node("task-5", { agentic: null, inheritedAgentic: true })]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { agentic: "no" }));
  });

  it("never writes Inherit — the key resolves through it rather than landing on it", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([
      node("task-1"),
      node("task-2", { agentic: true }),
      node("task-3", { agentic: false }),
      node("task-4", { agentic: null, inheritedAgentic: true }),
    ]);

    act(() => {
      result.current.toggleAgentic("task-1");
      result.current.toggleAgentic("task-2");
      result.current.toggleAgentic("task-3");
      result.current.toggleAgentic("task-4");
    });

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(4));
    for (const call of vi.mocked(updateTask).mock.calls) {
      expect(call[1]).not.toEqual({ agentic: "inherit" });
    }
  });

  it("declines every node that has no agentic column of its own", () => {
    const goal = node("goal-1", { kind: "goal" });
    const { result } = setup([goal]);

    act(() => {
      result.current.toggleAgentic("goal-1");
      result.current.toggleAgentic("task-missing");
    });

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("flags a Habit occurrence on its own row, since it is a Task like any other", async () => {
    const occurrence = node("task-4", { ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }) });
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([occurrence]);

    act(() => { result.current.toggleAgentic("task-4"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(occurrence.rowId, expect.any(Object)));
  });

  it("says so when the write fails rather than leaving the flag silently unchanged", async () => {
    vi.mocked(updateTask).mockRejectedValue(new Error("db is gone"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.toggleAgentic("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "task-5" }),
    ));
  });
});
