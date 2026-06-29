import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  getGoal, listGoals, createGoal, updateGoal, deleteGoal,
  addTagToGoal, removeTagFromGoal,
} from "./goals";
import type { Goal, CreateGoalRequest } from "./goals";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockGoal: Goal = {
  id: 1, title: "Ship MVP", parent_type: "domain", parent_id: 2,
  status: "active", blocked_reason: null, time_scope: null, tag_ids: [], position: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGoal", () => {
  it("calls invoke with get_goal and the id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockGoal);
    const result = await getGoal(1);
    expect(invoke).toHaveBeenCalledWith("get_goal", { id: 1 });
    expect(result).toEqual(mockGoal);
  });
});

describe("listGoals", () => {
  it("calls invoke with list_goals and returns the goal array", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([mockGoal]);
    const result = await listGoals();
    expect(invoke).toHaveBeenCalledWith("list_goals");
    expect(result).toEqual([mockGoal]);
  });
});

describe("createGoal", () => {
  it("calls invoke with create_goal and wraps the request", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockGoal);
    const req: CreateGoalRequest = { title: "Ship MVP", parent_type: "domain", parent_id: 2 };
    const result = await createGoal(req);
    expect(invoke).toHaveBeenCalledWith("create_goal", { request: req });
    expect(result).toEqual(mockGoal);
  });
});

describe("updateGoal", () => {
  it("calls invoke with update_goal, the id, and the partial request", async () => {
    const updated = { ...mockGoal, status: "achieved" };
    vi.mocked(invoke).mockResolvedValueOnce(updated);
    const result = await updateGoal(1, { status: "achieved" });
    expect(invoke).toHaveBeenCalledWith("update_goal", { id: 1, request: { status: "achieved" } });
    expect(result.status).toBe("achieved");
  });
});

describe("deleteGoal", () => {
  it("calls invoke with delete_goal and the id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteGoal(5);
    expect(invoke).toHaveBeenCalledWith("delete_goal", { id: 5 });
  });
});

describe("addTagToGoal", () => {
  it("calls invoke with add_tag_to_goal, goalId, and tagId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await addTagToGoal(1, 42);
    expect(invoke).toHaveBeenCalledWith("add_tag_to_goal", { goalId: 1, tagId: 42 });
  });
});

describe("removeTagFromGoal", () => {
  it("calls invoke with remove_tag_from_goal, goalId, and tagId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await removeTagFromGoal(1, 42);
    expect(invoke).toHaveBeenCalledWith("remove_tag_from_goal", { goalId: 1, tagId: 42 });
  });
});
