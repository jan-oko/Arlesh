import { describe, it, expect, vi, beforeEach } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTaskCompound } from "./use-task-compound";
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
    useTaskCompound({ findNode: (id) => byId.get(id), reload, showToast }),
  );
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useTaskCompound", () => {
  it("makes a task consist of its sub-items in one press", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result, reload } = setup([node("task-5")]);

    act(() => { result.current.toggleCompound("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { compound: true }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("switches it off with the flag alone, so the backend keeps the status it showed", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { compound: true, status: "in_progress" })]);

    act(() => { result.current.toggleCompound("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { compound: false }));
  });

  it("switches an occurrence of a flow Task item, over its item's flag", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const fields = occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 });
    const { result } = setup([node("task-4", { ...fields })]);

    act(() => { result.current.toggleCompound("task-4"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(fields.rowId, { compound: true }));
  });

  it("turns a check task away out loud: its status is the check itself", () => {
    const check = node("task-3", {
      rowId: "00000000-0000-5000-8000-000000000003",
      origin: { kind: "check", wait_kind: "stored", wait_id: 4, due_at: "2026-01-05T09:00:00" },
    });
    const { result, showToast } = setup([check]);

    act(() => { result.current.toggleCompound("task-3"); });

    expect(updateTask).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-3" }));
  });

  it("declines every node that is not a task", () => {
    const { result } = setup([node("goal-1", { kind: "goal" })]);

    act(() => {
      result.current.toggleCompound("goal-1");
      result.current.toggleCompound("task-missing");
    });

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("says so when the write fails", async () => {
    vi.mocked(updateTask).mockRejectedValue(new Error("db is gone"));
    const { result, showToast } = setup([node("task-5")]);

    act(() => { result.current.toggleCompound("task-5"); });

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" })));
  });
});
