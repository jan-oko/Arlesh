import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mockCommandOnce, mockGestureProtocol } from "@/test/command-mock";
import {
  listTasks, createTask, updateTask, deleteTask,
  getTask, listTaskDependencies, addTaskDependency, removeTaskDependency,
  addTagToTask, removeTagFromTask, scopeContainmentConflicts, reparentScopeConflicts,
} from "./tasks";
import type { Task, CreateTaskRequest, Dependency, TaskWithBlockers, ViolatingDescendant, ReparentConflicts } from "./tasks";
import type { TimeScope } from "./time-scope";
import { testKey } from "@/test/scope-key";
import { storedRowId } from "@/test/stored-id";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockTask: Task = {
  id: storedRowId(1), title: "Write tests", parent_type: "domain", parent_id: storedRowId(2),
  status: { kind: "ordinary", status: "todo" }, delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null,
  archival: "live", tag_ids: [], position: 0, is_private: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGestureProtocol();
});

describe("listTasks", () => {
  it("calls invoke with list_tasks and returns the task array", async () => {
    mockCommandOnce([mockTask]);
    const result = await listTasks("2026-01-05T09:00:00");
    expect(invoke).toHaveBeenCalledWith("list_tasks", { now: "2026-01-05T09:00:00" });
    expect(result).toEqual([mockTask]);
  });
});

describe("createTask", () => {
  it("calls invoke with create_task and wraps the request", async () => {
    mockCommandOnce(mockTask);
    const req: CreateTaskRequest = { title: "Write tests", parent_type: "domain", parent_id: storedRowId(2) };
    const result = await createTask(req);
    expect(invoke).toHaveBeenCalledWith("create_task", { request: req });
    expect(result).toEqual(mockTask);
  });
});

describe("updateTask", () => {
  it("calls invoke with update_task, the id, and the partial request", async () => {
    const updated = { ...mockTask, status: { kind: "ordinary", status: "done" } };
    mockCommandOnce(updated);
    const result = await updateTask(storedRowId(1), { status: { kind: "ordinary", status: "done" } });
    expect(invoke).toHaveBeenCalledWith("update_task", { id: storedRowId(1), request: { status: { kind: "ordinary", status: "done" } } });
    expect(result.status).toEqual({ kind: "ordinary", status: "done" });
  });
});

describe("deleteTask", () => {
  it("calls invoke with delete_task and the id", async () => {
    mockCommandOnce(undefined);
    await deleteTask(storedRowId(3));
    expect(invoke).toHaveBeenCalledWith("delete_task", { id: storedRowId(3) });
  });
});

describe("getTask", () => {
  it("calls invoke with get_task and the id", async () => {
    const withBlockers: TaskWithBlockers = { task: mockTask, block_reasons: [] };
    mockCommandOnce(withBlockers);
    const result = await getTask(storedRowId(1));
    expect(invoke).toHaveBeenCalledWith("get_task", { id: storedRowId(1) });
    expect(result).toEqual(withBlockers);
  });
});

describe("listTaskDependencies", () => {
  it("calls invoke with list_task_dependencies and the taskId", async () => {
    const deps: Dependency[] = [{ type: "goal", id: storedRowId(5) }];
    mockCommandOnce(deps);
    const result = await listTaskDependencies(storedRowId(1));
    expect(invoke).toHaveBeenCalledWith("list_task_dependencies", { taskId: storedRowId(1) });
    expect(result).toEqual(deps);
  });
});

describe("addTaskDependency", () => {
  it("calls invoke with add_task_dependency, taskId, and dependency", async () => {
    mockCommandOnce(undefined);
    const dep: Dependency = { type: "task", id: storedRowId(2) };
    await addTaskDependency(storedRowId(1), dep);
    expect(invoke).toHaveBeenCalledWith("add_task_dependency", { taskId: storedRowId(1), dependency: dep });
  });
});

describe("removeTaskDependency", () => {
  it("calls invoke with remove_task_dependency, taskId, and dependency", async () => {
    mockCommandOnce(undefined);
    const dep: Dependency = { type: "task", id: storedRowId(2) };
    await removeTaskDependency(storedRowId(1), dep);
    expect(invoke).toHaveBeenCalledWith("remove_task_dependency", { taskId: storedRowId(1), dependency: dep });
  });
});

describe("addTagToTask", () => {
  it("calls invoke with add_tag_to_task, taskId, and tagId", async () => {
    mockCommandOnce(undefined);
    await addTagToTask(storedRowId(1), storedRowId(99));
    expect(invoke).toHaveBeenCalledWith("add_tag_to_task", { taskId: storedRowId(1), tagId: storedRowId(99) });
  });
});

describe("removeTagFromTask", () => {
  it("calls invoke with remove_tag_from_task, taskId, and tagId", async () => {
    mockCommandOnce(undefined);
    await removeTagFromTask(storedRowId(1), storedRowId(99));
    expect(invoke).toHaveBeenCalledWith("remove_tag_from_task", { taskId: storedRowId(1), tagId: storedRowId(99) });
  });
});

describe("reparentScopeConflicts", () => {
  it("calls invoke with reparent_scope_conflicts and the node + new parent", async () => {
    const result: ReparentConflicts = {
      ancestor_time_scope: { start_id: testKey(3), end_id: testKey(3) },
      conflicts: [{ node_type: "task", node_id: storedRowId(8) }],
    };
    mockCommandOnce(result);
    const out = await reparentScopeConflicts("task", storedRowId(8), "goal", storedRowId(4));
    expect(invoke).toHaveBeenCalledWith("reparent_scope_conflicts", {
      nodeType: "task",
      nodeId: storedRowId(8),
      newParentType: "goal",
      newParentId: storedRowId(4),
    });
    expect(out).toEqual(result);
  });
});

describe("scopeContainmentConflicts", () => {
  it("calls invoke with scope_containment_conflicts and the node + candidate scope", async () => {
    const conflicts: ViolatingDescendant[] = [{ node_type: "task", node_id: storedRowId(7) }];
    mockCommandOnce(conflicts);
    const timeScope: TimeScope = { start_id: testKey(3), end_id: testKey(3) };
    const result = await scopeContainmentConflicts("goal", storedRowId(5), timeScope);
    expect(invoke).toHaveBeenCalledWith("scope_containment_conflicts", {
      nodeType: "goal",
      nodeId: storedRowId(5),
      timeScope,
    });
    expect(result).toEqual(conflicts);
  });
});
