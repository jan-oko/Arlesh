import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  listTasks, createTask, updateTask, deleteTask,
  getTask, listTaskDependencies, addTaskDependency, removeTaskDependency,
  addTagToTask, removeTagFromTask,
} from "./tasks";
import type { Task, CreateTaskRequest, Dependency, TaskWithBlockers } from "./tasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockTask: Task = {
  id: 1, title: "Write tests", parent_type: "domain", parent_id: 2,
  status: "todo", blocked_reason: null, delegate_to: null, scope_id: null,
  tag_ids: [], position: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTasks", () => {
  it("calls invoke with list_tasks and returns the task array", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([mockTask]);
    const result = await listTasks();
    expect(invoke).toHaveBeenCalledWith("list_tasks");
    expect(result).toEqual([mockTask]);
  });
});

describe("createTask", () => {
  it("calls invoke with create_task and wraps the request", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockTask);
    const req: CreateTaskRequest = { title: "Write tests", parent_type: "domain", parent_id: 2 };
    const result = await createTask(req);
    expect(invoke).toHaveBeenCalledWith("create_task", { request: req });
    expect(result).toEqual(mockTask);
  });
});

describe("updateTask", () => {
  it("calls invoke with update_task, the id, and the partial request", async () => {
    const updated = { ...mockTask, status: "done" };
    vi.mocked(invoke).mockResolvedValueOnce(updated);
    const result = await updateTask(1, { status: "done" });
    expect(invoke).toHaveBeenCalledWith("update_task", { id: 1, request: { status: "done" } });
    expect(result.status).toBe("done");
  });
});

describe("deleteTask", () => {
  it("calls invoke with delete_task and the id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteTask(3);
    expect(invoke).toHaveBeenCalledWith("delete_task", { id: 3 });
  });
});

describe("getTask", () => {
  it("calls invoke with get_task and the id", async () => {
    const withBlockers: TaskWithBlockers = { task: mockTask, block_reasons: [] };
    vi.mocked(invoke).mockResolvedValueOnce(withBlockers);
    const result = await getTask(1);
    expect(invoke).toHaveBeenCalledWith("get_task", { id: 1 });
    expect(result).toEqual(withBlockers);
  });
});

describe("listTaskDependencies", () => {
  it("calls invoke with list_task_dependencies and the taskId", async () => {
    const deps: Dependency[] = [{ type: "goal", id: 5 }];
    vi.mocked(invoke).mockResolvedValueOnce(deps);
    const result = await listTaskDependencies(1);
    expect(invoke).toHaveBeenCalledWith("list_task_dependencies", { taskId: 1 });
    expect(result).toEqual(deps);
  });
});

describe("addTaskDependency", () => {
  it("calls invoke with add_task_dependency, taskId, and dependency", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const dep: Dependency = { type: "task", id: 2 };
    await addTaskDependency(1, dep);
    expect(invoke).toHaveBeenCalledWith("add_task_dependency", { taskId: 1, dependency: dep });
  });
});

describe("removeTaskDependency", () => {
  it("calls invoke with remove_task_dependency, taskId, and dependency", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const dep: Dependency = { type: "task", id: 2 };
    await removeTaskDependency(1, dep);
    expect(invoke).toHaveBeenCalledWith("remove_task_dependency", { taskId: 1, dependency: dep });
  });
});

describe("addTagToTask", () => {
  it("calls invoke with add_tag_to_task, taskId, and tagId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await addTagToTask(1, 99);
    expect(invoke).toHaveBeenCalledWith("add_tag_to_task", { taskId: 1, tagId: 99 });
  });
});

describe("removeTagFromTask", () => {
  it("calls invoke with remove_tag_from_task, taskId, and tagId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await removeTagFromTask(1, 99);
    expect(invoke).toHaveBeenCalledWith("remove_tag_from_task", { taskId: 1, tagId: 99 });
  });
});
