import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import { updateTask, scopeContainmentConflicts } from "@/api/tasks";
import { updateGoal } from "@/api/goals";
import { flowOrigins, setFlowItemCycles, updateFlowTask, addFlowDependency } from "@/api/flows";

vi.mock("@/api/domains", () => ({
  listDomains: vi.fn().mockResolvedValue([]),
  updateDomain: vi.fn(),
  DOMAIN_SUBTYPE: { TAG: "tag" },
}));
vi.mock("@/api/tasks", () => ({
  updateTask: vi.fn().mockResolvedValue(undefined),
  addTagToTask: vi.fn().mockResolvedValue(undefined),
  removeTagFromTask: vi.fn().mockResolvedValue(undefined),
  addTaskDependency: vi.fn().mockResolvedValue(undefined),
  removeTaskDependency: vi.fn().mockResolvedValue(undefined),
  scopeContainmentConflicts: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/api/goals", () => ({
  updateGoal: vi.fn().mockResolvedValue(undefined),
  addTagToGoal: vi.fn().mockResolvedValue(undefined),
  removeTagFromGoal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/flows", () => ({
  updateFlow: vi.fn(), updateFlowGoal: vi.fn(), updateFlowTask: vi.fn(),
  setFlowItemCycles: vi.fn().mockResolvedValue(null), addFlowDependency: vi.fn(), removeFlowDependency: vi.fn(),
  flowOrigins: vi.fn().mockResolvedValue([]),
  setHabitInstancePlan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api/gesture", () => ({
  withGesture: vi.fn((_name: string, run: () => Promise<unknown>) => run()),
}));
vi.mock("@/api/block-reasons", () => ({
  setBlockReasons: vi.fn().mockResolvedValue(undefined),
}));

const taskNode: MindmapNode = {
  id: "task-5", kind: "task", title: "Task", tagIds: [], position: 0, children: [],
};
const virtualHabitItemNode: MindmapNode = {
  id: "habititem-flow_task-4-3-virtual", kind: "task", title: "Breakfast", tagIds: [], position: 0, children: [],
  virtual: true,
  habitItem: { flowId: 4, itemType: "flow_task", itemId: 4, scopeId: 26, cycleId: 0 },
};
const virtualIterationRoot: MindmapNode = {
  id: "habit-4-0-virtual", kind: "task", title: "Routine W1", tagIds: [], position: 0, children: [],
  virtual: true,
  habitItem: { flowId: 4, itemType: "flow_root", itemId: 4, scopeId: 26, cycleId: 0 },
};
const root: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", tagIds: [], position: 0,
  children: [taskNode, virtualHabitItemNode, virtualIterationRoot],
};

function setup() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], reload }),
  );
  act(() => result.current.setEditorModal({ nodeId: "task-5", node: taskNode }));
  return result;
}

const saveData: TaskSaveData = {
  title: "Task", status: "todo", blockReasons: [], tagIds: [],
  addedDeps: [], removedDeps: [], timeScope: { start_id: 1, end_id: 1 },
  onScopeExit: null, plan: null, archival: "live", agentic: "inherit", asynchronous: false, isPrivate: false,
};

beforeEach(() => vi.clearAllMocks());

describe("useNodeEditor — double-click", () => {
  // A virtual Habit instance (root or item) isn't backed by a real Task/Goal row — its Time Scope
  // is derived from the flow's Duration kind and the item's Cycle, not independently settable.
  // Opening the full editor on it would save against a `dbId` parsed from its non-numeric
  // `-virtual` id tail (NaN), silently failing — so the full editor never opens on one. A task
  // occurrence opens its own Plan editor instead.
  it("opens the occurrence editor, not the Task editor, on a habit task occurrence", () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], reload }),
    );
    act(() => result.current.onDoubleClick("habititem-flow_task-4-3-virtual"));
    expect(result.current.editorModal).toBeNull();
    expect(result.current.occurrenceEditor.target?.key).toMatchObject({
      flowId: 4, itemId: 4, scopeId: 26, cycleId: 0,
    });
  });

  it("opens nothing on a habit iteration root, which is not edited per occurrence", () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], reload }),
    );
    act(() => result.current.onDoubleClick("habit-4-0-virtual"));
    expect(result.current.editorModal).toBeNull();
    expect(result.current.occurrenceEditor.target).toBeNull();
  });
});

describe("useNodeEditor — scope clamp", () => {
  it("clamps conflicting descendants to the new window before saving the parent", async () => {
    vi.mocked(scopeContainmentConflicts).mockResolvedValue([
      { node_type: "task", node_id: 9 },
      { node_type: "goal", node_id: 12 },
    ]);
    const result = setup();

    await act(async () => { await result.current.onTaskSave(saveData); });

    expect(updateTask).toHaveBeenCalledWith(9, { time_scope: { start_id: 1, end_id: 1 } });
    expect(updateGoal).toHaveBeenCalledWith(12, { time_scope: { start_id: 1, end_id: 1 } });
    // Parent saved with its new time scope.
    expect(updateTask).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ time_scope: { start_id: 1, end_id: 1 } }),
    );
  });

  it("does not clamp when there are no conflicts", async () => {
    vi.mocked(scopeContainmentConflicts).mockResolvedValue([]);
    const result = setup();
    await act(async () => { await result.current.onTaskSave(saveData); });
    // Only the parent update, no descendant clamps.
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateGoal).not.toHaveBeenCalled();
  });
});

describe("useNodeEditor — checkScopeClamp confirm", () => {
  it("returns true immediately when there are no conflicts", async () => {
    vi.mocked(scopeContainmentConflicts).mockResolvedValue([]);
    const result = setup();
    await expect(result.current.checkScopeClamp("task", 5, { start_id: 1, end_id: 1 })).resolves.toBe(true);
  });

  it("surfaces a prompt and resolves with the user's choice", async () => {
    vi.mocked(scopeContainmentConflicts).mockResolvedValue([{ node_type: "task", node_id: 9 }]);
    const result = setup();

    let decision: Promise<boolean>;
    act(() => {
      decision = result.current.checkScopeClamp("task", 5, { start_id: 1, end_id: 1 });
    });
    await waitFor(() => expect(result.current.scopeClampRequest).not.toBeNull());

    act(() => result.current.resolveScopeClamp(true));
    await expect(decision!).resolves.toBe(true);
    expect(result.current.scopeClampRequest).toBeNull();
  });

  it("annotates conflicting descendants that were materialized from a flow", async () => {
    vi.mocked(scopeContainmentConflicts).mockResolvedValue([
      { node_type: "task", node_id: 9 },
      { node_type: "goal", node_id: 12 },
    ]);
    vi.mocked(flowOrigins).mockResolvedValue([{ node_type: "task", node_id: 9, flow_title: "Add Feature" }]);
    const result = setup();

    act(() => { void result.current.checkScopeClamp("task", 5, { start_id: 1, end_id: 1 }); });
    await waitFor(() => expect(result.current.scopeClampRequest).not.toBeNull());

    expect(result.current.scopeClampRequest?.flowOrigins).toEqual({ "task-9": "Add Feature" });
  });
});

describe("useNodeEditor — saving a flow item", () => {
  const flowTask: MindmapNode = {
    id: "flowtask-7", kind: "flow_task", title: "Stretch", tagIds: [], position: 0, children: [],
    flowItem: {
      itemType: "flow_task", flowId: 3, flowInstanceType: "task", flowScopeN: 1, flowScopeKind: "day",
      cycles: [], dependsOn: [],
    },
  };

  it("lands the rest of the save on the fork an Archive & new answer created", async () => {
    vi.mocked(setFlowItemCycles).mockResolvedValueOnce({ flow_id: 9, goals: [], tasks: [[7, 70], [6, 60]] });
    const reload = vi.fn().mockResolvedValue(undefined);
    const tree: MindmapNode = { ...root, children: [flowTask] };
    const { result } = renderHook(() => useNodeEditor({ tree, allTasksAndGoals: [], reload }));
    act(() => result.current.setEditorModal({ nodeId: "flowtask-7", node: flowTask }));

    await act(() => result.current.onFlowItemSave({
      title: "Stretch well", cycles: [], isPrivate: false, reconcile: "fork",
      addedDeps: [{ type: "flow_task", id: 6 }], removedDeps: [],
    }));

    expect(setFlowItemCycles).toHaveBeenCalledWith(3, "flow_task", 7, [], "fork");
    expect(updateFlowTask).toHaveBeenCalledWith(70, { title: "Stretch well", isPrivate: false });
    expect(addFlowDependency).toHaveBeenCalledWith(9, "flow_task", 70, "flow_task", 60);
  });
});
