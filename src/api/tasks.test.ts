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

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockTask: Task = {
  id: 1, title: "Write tests", parent_type: "domain", parent_id: 2,
  status: "todo", delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null,
  archival: "live", tag_ids: [], position: 0, is_private: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGestureProtocol();
});

describe("listTasks", () => {
  it("calls invoke with list_tasks and returns the task array", async () => {
    mockCommandOnce([mockTask]);
    const result = await listTasks();
    expect(invoke).toHaveBeenCalledWith("list_tasks");
    expect(result).toEqual([mockTask]);
  });
});

describe("createTask", () => {
  it("calls invoke with create_task and wraps the request", async () => {
    mockCommandOnce(mockTask);
    const req: CreateTaskRequest = { title: "Write tests", parent_type: "domain", parent_id: 2 };
    const result = await createTask(req);
    expect(invoke).toHaveBeenCalledWith("create_task", { request: req });
    expect(result).toEqual(mockTask);
  });
});

describe("updateTask", () => {
  it("calls invoke with update_task, the id, and the partial request", async () => {
    const updated = { ...mockTask, status: "done" };
    mockCommandOnce(updated);
    const result = await updateTask(1, { status: "done" });
    expect(invoke).toHaveBeenCalledWith("update_task", { id: 1, request: { status: "done" } });
    expect(result.status).toBe("done");
  });
});

describe("deleteTask", () => {
  it("calls invoke with delete_task and the id", async () => {
    mockCommandOnce(undefined);
    await deleteTask(3);
    expect(invoke).toHaveBeenCalledWith("delete_task", { id: 3 });
  });
});

describe("getTask", () => {
  it("calls invoke with get_task and the id", async () => {
    const withBlockers: TaskWithBlockers = { task: mockTask, block_reasons: [] };
    mockCommandOnce(withBlockers);
    const result = await getTask(1);
    expect(invoke).toHaveBeenCalledWith("get_task", { id: 1 });
    expect(result).toEqual(withBlockers);
  });
});

describe("listTaskDependencies", () => {
  it("calls invoke with list_task_dependencies and the taskId", async () => {
    const deps: Dependency[] = [{ type: "goal", id: 5 }];
    mockCommandOnce(deps);
    const result = await listTaskDependencies(1);
    expect(invoke).toHaveBeenCalledWith("list_task_dependencies", { taskId: 1 });
    expect(result).toEqual(deps);
  });
});

describe("addTaskDependency", () => {
  it("calls invoke with add_task_dependency, taskId, and dependency", async () => {
    mockCommandOnce(undefined);
    const dep: Dependency = { type: "task", id: 2 };
    await addTaskDependency(1, dep);
    expect(invoke).toHaveBeenCalledWith("add_task_dependency", { taskId: 1, dependency: dep });
  });
});

describe("removeTaskDependency", () => {
  it("calls invoke with remove_task_dependency, taskId, and dependency", async () => {
    mockCommandOnce(undefined);
    const dep: Dependency = { type: "task", id: 2 };
    await removeTaskDependency(1, dep);
    expect(invoke).toHaveBeenCalledWith("remove_task_dependency", { taskId: 1, dependency: dep });
  });
});

describe("addTagToTask", () => {
  it("calls invoke with add_tag_to_task, taskId, and tagId", async () => {
    mockCommandOnce(undefined);
    await addTagToTask(1, 99);
    expect(invoke).toHaveBeenCalledWith("add_tag_to_task", { taskId: 1, tagId: 99 });
  });
});

describe("removeTagFromTask", () => {
  it("calls invoke with remove_tag_from_task, taskId, and tagId", async () => {
    mockCommandOnce(undefined);
    await removeTagFromTask(1, 99);
    expect(invoke).toHaveBeenCalledWith("remove_tag_from_task", { taskId: 1, tagId: 99 });
  });
});

describe("reparentScopeConflicts", () => {
  it("calls invoke with reparent_scope_conflicts and the node + new parent", async () => {
    const result: ReparentConflicts = {
      ancestor_time_scope: { start_id: 3, end_id: 3 },
      conflicts: [{ node_type: "task", node_id: 8 }],
    };
    mockCommandOnce(result);
    const out = await reparentScopeConflicts("task", 8, "goal", 4);
    expect(invoke).toHaveBeenCalledWith("reparent_scope_conflicts", {
      nodeType: "task",
      nodeId: 8,
      newParentType: "goal",
      newParentId: 4,
    });
    expect(out).toEqual(result);
  });
});

describe("scopeContainmentConflicts", () => {
  it("calls invoke with scope_containment_conflicts and the node + candidate scope", async () => {
    const conflicts: ViolatingDescendant[] = [{ node_type: "task", node_id: 7 }];
    mockCommandOnce(conflicts);
    const timeScope: TimeScope = { start_id: 3, end_id: 3 };
    const result = await scopeContainmentConflicts("goal", 5, timeScope);
    expect(invoke).toHaveBeenCalledWith("scope_containment_conflicts", {
      nodeType: "goal",
      nodeId: 5,
      timeScope,
    });
    expect(result).toEqual(conflicts);
  });
});
