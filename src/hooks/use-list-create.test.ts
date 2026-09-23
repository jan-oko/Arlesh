import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useListCreate } from "./use-list-create";
import type { MindmapNode } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";

function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function setup(created: MindmapNode = node("task-9", "task", { status: "todo" })) {
  const createTask = vi.fn(() => Promise.resolve(created));
  const deleteTask = vi.fn(() => Promise.resolve());
  const renameTask = vi.fn(() => Promise.resolve());
  const selectRow = vi.fn();
  const showToast = vi.fn();
  const rendered = renderHook(() =>
    useListCreate({ createTask, deleteTask, renameTask, selectRow, showToast }),
  );
  return { ...rendered, createTask, deleteTask, renameTask, selectRow, showToast };
}

/** Runs the whole gesture: create under `parent`, and settle the reload it waits on. */
async function createUnder(
  view: ReturnType<typeof setup>,
  parent: MindmapNode,
): Promise<void> {
  act(() => { view.result.current.createTaskUnder(parent); });
  await waitFor(() => expect(view.result.current.editingTaskId).not.toBeNull());
}

beforeEach(() => vi.clearAllMocks());

describe("useListCreate", () => {
  it("creates the Task under the parent it was given", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    expect(view.createTask).toHaveBeenCalledWith("goal-1", "goal", undefined);
  });

  it("seeds the new Task's own Agentic flag when it is given one", async () => {
    const view = setup();
    act(() => { view.result.current.createTaskUnder(node("goal-1", "goal"), "yes"); });
    await waitFor(() => expect(view.createTask).toHaveBeenCalledWith("goal-1", "goal", "yes"));
  });

  it("selects the new row and opens it for naming, so typing lands in it", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    expect(view.selectRow).toHaveBeenCalledWith("task-9");
    expect(view.result.current.editingTaskId).toBe("task-9");
  });

  it("names it on Enter", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    act(() => { view.result.current.commitTitle("task-9", "  Write the report  "); });
    expect(view.renameTask).toHaveBeenCalledWith("task-9", "Write the report");
    expect(view.result.current.editingTaskId).toBeNull();
    expect(view.deleteTask).not.toHaveBeenCalled();
  });

  // The promise this feature makes: a mistaken create costs nothing.
  it("discards the Task entirely when the first naming is cancelled", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    act(() => { view.result.current.cancelTitleEdit(); });
    expect(view.deleteTask).toHaveBeenCalledWith("task-9");
    expect(view.result.current.editingTaskId).toBeNull();
  });

  it("discards it just as readily on an empty name, which is no name at all", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    act(() => { view.result.current.commitTitle("task-9", "   "); });
    expect(view.deleteTask).toHaveBeenCalledWith("task-9");
    expect(view.renameTask).not.toHaveBeenCalled();
  });

  it("leaves the Task alone once it has been named and the editor reopened", async () => {
    const view = setup();
    await createUnder(view, node("goal-1", "goal"));
    act(() => { view.result.current.commitTitle("task-9", "Write the report"); });
    act(() => { view.result.current.startRename("task-9"); });
    act(() => { view.result.current.cancelTitleEdit(); });
    expect(view.deleteTask).not.toHaveBeenCalled();
  });

  it("cancels an ordinary rename without deleting the row", () => {
    const view = setup();
    act(() => { view.result.current.startRename("task-1"); });
    expect(view.result.current.editingTaskId).toBe("task-1");
    act(() => { view.result.current.cancelTitleEdit(); });
    expect(view.deleteTask).not.toHaveBeenCalled();
    expect(view.result.current.editingTaskId).toBeNull();
  });

  it("keeps an existing row's title when its rename is committed empty", () => {
    const view = setup();
    act(() => { view.result.current.startRename("task-1"); });
    act(() => { view.result.current.commitTitle("task-1", "  "); });
    expect(view.renameTask).not.toHaveBeenCalled();
    expect(view.deleteTask).not.toHaveBeenCalled();
  });

  // A Habit repetition is derived, not stored: there is no row to parent anything to.
  it("refuses a Habit repetition out loud rather than posting a doomed create", () => {
    const view = setup();
    act(() => {
      view.result.current.createTaskUnder(node("habititem-flow_task-2-1-0-virtual", "task", { virtual: true }));
    });
    expect(view.createTask).not.toHaveBeenCalled();
    expect(view.showToast).toHaveBeenCalledTimes(1);
  });

  it("refuses a parent whose kind cannot hold a Task, and says so", () => {
    const view = setup();
    act(() => { view.result.current.createTaskUnder(node("info-3", "info")); });
    expect(view.createTask).not.toHaveBeenCalled();
    expect(view.showToast).toHaveBeenCalledTimes(1);
  });

  it("says so when the backend refuses the create", async () => {
    const createTask = vi.fn(() => Promise.reject(new Error("nope")));
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useListCreate({
        createTask, deleteTask: vi.fn(() => Promise.resolve()), renameTask: vi.fn(() => Promise.resolve()),
        selectRow: vi.fn(), showToast,
      }),
    );
    act(() => { result.current.createTaskUnder(node("goal-1", "goal")); });
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(result.current.editingTaskId).toBeNull();
  });
});
