import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useListDelete } from "./use-list-delete";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** One entry of the cascade, as `removeNode` receives them. */
interface DeletedNode {
  id: string;
  kind: MindmapNode["kind"];
}

function setup(nodes: MindmapNode[], neighbour: string | null = "task-2") {
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  // Typed parameters, so the recorded calls can be read back without an assertion.
  const removeNode = vi.fn((_nodes: DeletedNode[]) => Promise.resolve());
  const neighbourAfterDelete = vi.fn((_id: string, _deletedIds: ReadonlySet<string>) => neighbour);
  const selectRow = vi.fn();
  const showToast = vi.fn();
  const rendered = renderHook(() =>
    useListDelete({
      findNode: (id) => byId.get(id),
      removeNode,
      neighbourAfterDelete,
      selectRow,
      showToast,
    }),
  );
  return { ...rendered, removeNode, neighbourAfterDelete, selectRow, showToast };
}

const leaf = () => node("task-1", "task");
const withSubtree = () =>
  node("task-1", "task", {
    children: [node("task-1a", "task", { children: [node("task-1b", "task")] })],
  });

beforeEach(() => vi.clearAllMocks());

describe("useListDelete", () => {
  it("asks before it writes anything", () => {
    const view = setup([leaf()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    expect(view.result.current.pendingDelete?.node.id).toBe("task-1");
    expect(view.removeNode).not.toHaveBeenCalled();
  });

  it("counts what goes with the row, so the confirmation can say", () => {
    const view = setup([withSubtree()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    expect(view.result.current.pendingDelete?.descendantCount).toBe(2);
  });

  it("counts nothing extra for a leaf", () => {
    const view = setup([leaf()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    expect(view.result.current.pendingDelete?.descendantCount).toBe(0);
  });

  it("writes nothing when the confirmation is cancelled", () => {
    const view = setup([leaf()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    act(() => { view.result.current.cancelDelete(); });
    expect(view.result.current.pendingDelete).toBeNull();
    expect(view.removeNode).not.toHaveBeenCalled();
  });

  // Children first, so nothing is orphaned mid-write — the Mindmap's own cascade order.
  it("deletes the whole subtree, deepest first", async () => {
    const view = setup([withSubtree()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    act(() => { view.result.current.confirmDelete(); });
    await waitFor(() => expect(view.removeNode).toHaveBeenCalledTimes(1));
    expect(view.removeNode.mock.calls[0]?.[0]).toEqual([
      { id: "task-1b", kind: "task" },
      { id: "task-1a", kind: "task" },
      { id: "task-1", kind: "task" },
    ]);
  });

  it("moves the selection to the neighbour the list named", async () => {
    const view = setup([leaf()], "task-2");
    act(() => { view.result.current.requestDelete("task-1"); });
    act(() => { view.result.current.confirmDelete(); });
    await waitFor(() => expect(view.selectRow).toHaveBeenCalledWith("task-2"));
  });

  // The neighbour has to be read off the list as it stands, because afterwards the row and its
  // subtree are gone and there is nothing left to measure from.
  it("asks for the neighbour before the write, naming everything that is about to go", () => {
    const view = setup([withSubtree()]);
    act(() => { view.result.current.requestDelete("task-1"); });
    act(() => { view.result.current.confirmDelete(); });
    const call = view.neighbourAfterDelete.mock.calls[0];
    if (call === undefined) throw new Error("expected the neighbour to be resolved before the write");
    expect(call[0]).toBe("task-1");
    expect([...call[1]].sort()).toEqual(["task-1", "task-1a", "task-1b"]);
  });

  it("deletes a Commitment too — it is a real row like any other", async () => {
    const view = setup([node("commitment-3", "commitment")]);
    act(() => { view.result.current.requestDelete("commitment-3"); });
    act(() => { view.result.current.confirmDelete(); });
    await waitFor(() => expect(view.removeNode).toHaveBeenCalledWith([{ id: "commitment-3", kind: "commitment" }]));
  });

  // Derived at load time, so there is no row to delete — and the thing behind it is the Habit's
  // template, which is emphatically not what Delete on one occurrence should take away.
  it("refuses a Habit repetition out loud instead of doing nothing", () => {
    const view = setup([node("habititem-flow_task-2-1-0-virtual", "task", { virtual: true })]);
    act(() => { view.result.current.requestDelete("habititem-flow_task-2-1-0-virtual"); });
    expect(view.result.current.pendingDelete).toBeNull();
    expect(view.showToast).toHaveBeenCalledTimes(1);
    expect(view.removeNode).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open and shows a refusal from the backend", async () => {
    const byId = new Map([["task-1", leaf()]]);
    const removeNode = vi.fn(() => Promise.reject(new Error("still referenced")));
    const selectRow = vi.fn();
    const { result } = renderHook(() =>
      useListDelete({
        findNode: (id) => byId.get(id),
        removeNode,
        neighbourAfterDelete: () => null,
        selectRow,
        showToast: vi.fn(),
      }),
    );
    act(() => { result.current.requestDelete("task-1"); });
    act(() => { result.current.confirmDelete(); });
    await waitFor(() => expect(result.current.error).toContain("still referenced"));
    expect(result.current.pendingDelete).not.toBeNull();
    expect(selectRow).not.toHaveBeenCalled();
  });

  it("clears a previous refusal when the next delete is asked for", async () => {
    const byId = new Map([["task-1", leaf()]]);
    const removeNode = vi.fn(() => Promise.reject(new Error("nope")));
    const { result } = renderHook(() =>
      useListDelete({
        findNode: (id) => byId.get(id),
        removeNode,
        neighbourAfterDelete: () => null,
        selectRow: vi.fn(),
        showToast: vi.fn(),
      }),
    );
    act(() => { result.current.requestDelete("task-1"); });
    act(() => { result.current.confirmDelete(); });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => { result.current.cancelDelete(); });
    act(() => { result.current.requestDelete("task-1"); });
    expect(result.current.error).toBeNull();
  });

  it("does nothing at all for a row that is no longer there", () => {
    const view = setup([leaf()]);
    act(() => { view.result.current.requestDelete("task-gone"); });
    expect(view.result.current.pendingDelete).toBeNull();
    expect(view.showToast).not.toHaveBeenCalled();
  });
});
