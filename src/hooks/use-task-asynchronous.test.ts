import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskAsynchronous } from "./use-task-asynchronous";
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
    useTaskAsynchronous({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useTaskAsynchronous", () => {
  it("flags an unflagged task in one press", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.toggleAsynchronous("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { asynchronous: true }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("unflags a flagged task in one press", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { asynchronous: true })]);

    act(() => { result.current.toggleAsynchronous("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { asynchronous: false }));
  });

  it("reads the task's own flag and nothing above it", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    // The flag does not inherit, so a child of a flagged Task is unflagged and one press sets it.
    const { result } = setup([node("task-6", { asynchronous: false })]);

    act(() => { result.current.toggleAsynchronous("task-6"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(6, { asynchronous: true }));
  });

  it("declines every node that has no asynchronous column of its own", () => {
    const goal = node("goal-1", { kind: "goal" });
    const { result } = setup([goal]);

    act(() => {
      result.current.toggleAsynchronous("goal-1");
      result.current.toggleAsynchronous("task-missing");
    });

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("flips a Habit occurrence's flag on its own row", async () => {
    const occurrence = node("task-4", { ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }) });
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([occurrence]);

    act(() => { result.current.toggleAsynchronous("task-4"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(occurrence.rowId, { asynchronous: true }));
  });

  it("says so when the write fails rather than leaving the flag silently unchanged", async () => {
    vi.mocked(updateTask).mockRejectedValue(new Error("db is gone"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.toggleAsynchronous("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "task-5" }),
    ));
  });
});
