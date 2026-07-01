import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useNodeEditor } from "./use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";
import { updateTask, scopeContainmentConflicts } from "@/api/tasks";
import { updateGoal } from "@/api/goals";

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

const taskNode: MindmapNode = {
  id: "task-5", kind: "task", title: "Task", tagIds: [], position: 0, children: [],
};
const root: MindmapNode = {
  id: "root", kind: "domain", title: "Arlesh", tagIds: [], position: 0, children: [taskNode],
};

function setup() {
  const reload = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useNodeEditor({ tree: root, allTasksAndGoals: [taskNode], renameNode: vi.fn(), reload }),
  );
  act(() => result.current.setEditorModal({ nodeId: "task-5", node: taskNode }));
  return result;
}

const saveData = {
  title: "Task", status: "todo", blockedReason: "", tagIds: [],
  addedDeps: [], removedDeps: [], timeScope: { start_id: 1, end_id: 1 }, planScopeId: null,
};

beforeEach(() => vi.clearAllMocks());

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
});
