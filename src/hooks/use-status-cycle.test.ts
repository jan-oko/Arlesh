import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStatusCycle } from "./use-status-cycle";
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
  const rendered = renderHook(() => useStatusCycle({ findNode: (id) => byId.get(id), reload, showToast }));
  return { ...rendered, reload, showToast };
}

beforeEach(() => vi.clearAllMocks());

describe("useStatusCycle — a task that consists of its sub-items", () => {
  it("refuses Enter's cycle out loud and writes nothing", () => {
    const { result, showToast } = setup([node("task-5", { consistent: true, status: "in_progress" })]);

    act(() => { result.current.cycleStatus("task-5"); });

    expect(updateTask).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("refuses Alt+Enter's Started out loud and writes nothing", () => {
    const { result, showToast } = setup([node("task-5", { consistent: true, status: "todo" })]);

    act(() => { result.current.toggleStarted("task-5"); });

    expect(updateTask).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "task-5" }));
  });

  it("still cycles a task that does not", async () => {
    vi.mocked(updateTask).mockResolvedValue({} as never);
    const { result } = setup([node("task-5", { status: "todo" })]);

    act(() => { result.current.cycleStatus("task-5"); });

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(5, { status: "in_progress" }));
  });
});
