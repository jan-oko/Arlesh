import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import { buildTree, useMindmapData } from "./use-mindmap-data";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { Task } from "@/api/tasks";
import type { Info } from "@/api/infos";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// --- Fixture helpers ---

function mkDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: 1, title: "Domain", description: null, subtype: "aspect",
    parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0,
    ...overrides,
  };
}

function mkGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1, title: "Goal", parent_type: "domain", parent_id: 1,
    status: "active", blocked_reason: null, time_scope: null, tag_ids: [], position: 0,
    ...overrides,
  };
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, title: "Task", parent_type: "goal", parent_id: 1,
    status: "todo", blocked_reason: null, delegate_to: null, time_scope: null, plan: null, tag_ids: [], position: 0,
    ...overrides,
  };
}

function mkInfo(overrides: Partial<Info> = {}): Info {
  return {
    id: 1, body: "Note", parent_type: "task", parent_id: 1, position: 0,
    ...overrides,
  };
}

// --- buildTree unit tests ---

describe("buildTree", () => {
  it("returns virtual root with no children when all inputs are empty", () => {
    const root = buildTree([], [], [], []);
    expect(root.id).toBe("root");
    expect(root.title).toBe("Arlesh");
    expect(root.children).toHaveLength(0);
  });

  it("places aspect-subtype domains as direct children of root", () => {
    const root = buildTree([mkDomain({ subtype: "aspect" })], [], [], []);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.id).toBe("domain-1");
    expect(root.children[0]?.kind).toBe("aspect");
  });

  it("does not place non-aspect root domains as children of virtual root", () => {
    const domain = mkDomain({ subtype: "domain", parent_id: null });
    const root = buildTree([domain], [], [], []);
    // Only aspects are listed as root children
    expect(root.children).toHaveLength(0);
  });

  it("wires a child domain to its parent domain", () => {
    const parent = mkDomain({ id: 1, subtype: "aspect", parent_id: null });
    const child = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Child" });
    const root = buildTree([parent, child], [], [], []);
    expect(root.children[0]?.children[0]?.id).toBe("domain-2");
    expect(root.children[0]?.children[0]?.kind).toBe("project");
  });

  it("wires a goal to its domain parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, parent_type: "domain", parent_id: 1 });
    const root = buildTree([aspect], [goal], [], []);
    expect(root.children[0]?.children[0]?.id).toBe("goal-1");
    expect(root.children[0]?.children[0]?.kind).toBe("goal");
  });

  it("wires a goal to a goal parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const parentGoal = mkGoal({ id: 1, parent_type: "domain", parent_id: 1 });
    const childGoal = mkGoal({ id: 2, title: "Sub-goal", parent_type: "goal", parent_id: 1 });
    const root = buildTree([aspect], [parentGoal, childGoal], [], []);
    const goalNode = root.children[0]?.children[0];
    expect(goalNode?.id).toBe("goal-1");
    expect(goalNode?.children[0]?.id).toBe("goal-2");
  });

  it("wires a task to its goal parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, parent_type: "domain", parent_id: 1 });
    const task = mkTask({ id: 1, parent_type: "goal", parent_id: 1 });
    const root = buildTree([aspect], [goal], [task], []);
    expect(root.children[0]?.children[0]?.children[0]?.id).toBe("task-1");
  });

  it("wires a task to its domain parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [task], []);
    expect(root.children[0]?.children[0]?.id).toBe("task-1");
  });

  it("wires a task to a task parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const parentTask = mkTask({ id: 1, parent_type: "project", parent_id: 1 });
    const childTask = mkTask({ id: 2, parent_type: "task", parent_id: 1 });
    const root = buildTree([aspect], [], [parentTask, childTask], []);
    const taskNode = root.children[0]?.children[0];
    expect(taskNode?.id).toBe("task-1");
    expect(taskNode?.children[0]?.id).toBe("task-2");
  });

  it("wires an info node to its task parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, parent_type: "project", parent_id: 1 });
    const info = mkInfo({ id: 1, parent_type: "task", parent_id: 1 });
    const root = buildTree([aspect], [], [task], [info]);
    const taskNode = root.children[0]?.children[0];
    expect(taskNode?.children[0]?.id).toBe("info-1");
    expect(taskNode?.children[0]?.kind).toBe("info");
  });

  it("wires an info node to its goal parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, parent_type: "domain", parent_id: 1 });
    const info = mkInfo({ id: 1, parent_type: "goal", parent_id: 1 });
    const root = buildTree([aspect], [goal], [], [info]);
    const goalNode = root.children[0]?.children[0];
    expect(goalNode?.children[0]?.id).toBe("info-1");
  });

  it("wires an info node to another info node parent", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, parent_type: "project", parent_id: 1 });
    const parentInfo = mkInfo({ id: 1, parent_type: "task", parent_id: 1 });
    const childInfo = mkInfo({ id: 2, parent_type: "info", parent_id: 1, body: "Child note" });
    const root = buildTree([aspect], [], [task], [parentInfo, childInfo]);
    const taskNode = root.children[0]?.children[0];
    const infoNode = taskNode?.children[0];
    expect(infoNode?.id).toBe("info-1");
    expect(infoNode?.children[0]?.id).toBe("info-2");
  });

  it("wires an info node to a domain parent (aspect/domain/project)", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const info = mkInfo({ id: 1, parent_type: "aspect", parent_id: 1 });
    const root = buildTree([aspect], [], [], [info]);
    expect(root.children[0]?.children[0]?.id).toBe("info-1");
  });

  it("sets title of info nodes from their body field", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const info = mkInfo({ id: 1, body: "My note text", parent_type: "aspect", parent_id: 1 });
    const root = buildTree([aspect], [], [], [info]);
    expect(root.children[0]?.children[0]?.title).toBe("My note text");
  });

  it("stores goal status and blocked reason on the node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, status: "frozen", blocked_reason: "waiting on X", parent_type: "domain", parent_id: 1 });
    const root = buildTree([aspect], [goal], [], []);
    const goalNode = root.children[0]?.children[0];
    expect(goalNode?.status).toBe("frozen");
    expect(goalNode?.blockedReason).toBe("waiting on X");
  });

  it("stores task tag_ids on the node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, tag_ids: [3, 7], parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [task], []);
    expect(root.children[0]?.children[0]?.tagIds).toEqual([3, 7]);
  });

  it("sorts children by position so mixed-type siblings respect insertion order", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, parent_type: "domain", parent_id: 1, position: 2 });
    const task = mkTask({ id: 1, parent_type: "project", parent_id: 1, position: 0 });
    const root = buildTree([aspect], [goal], [task], []);
    const children = root.children[0]?.children ?? [];
    expect(children[0]?.id).toBe("task-1");
    expect(children[1]?.id).toBe("goal-1");
  });

  it("sorts aspect root children by position", () => {
    const a1 = mkDomain({ id: 1, subtype: "aspect", position: 5 });
    const a2 = mkDomain({ id: 2, subtype: "aspect", title: "Second", position: 1 });
    const root = buildTree([a1, a2], [], [], []);
    expect(root.children[0]?.id).toBe("domain-2");
    expect(root.children[1]?.id).toBe("domain-1");
  });

  it("propagates aspect color to non-aspect domain children", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect", color: "#3af" });
    const child = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Project" });
    const root = buildTree([aspect, child], [], [], []);
    const childNode = root.children[0]?.children[0];
    expect(childNode?.color).toBe("#3af");
  });

  it("keeps the aspect node's own color (propagation does not overwrite the source)", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect", color: "#3af" });
    const root = buildTree([aspect], [], [], []);
    expect(root.children[0]?.color).toBe("#3af");
  });

  it("maps tag subtype to tag kind on the node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const tag = mkDomain({ id: 2, subtype: "tag", parent_id: 1, title: "Tag", color: null });
    const root = buildTree([aspect, tag], [], [], []);
    const tagNode = root.children[0]?.children[0];
    expect(tagNode?.kind).toBe("tag");
  });

  it("wires flow items under their flow with cycles, deps, and the flow's scope", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const flow = { id: 5, title: "Feature", instance_type: "task" as const, parent_type: "aspect", parent_id: 1, target_type: null, target_id: null, flow_duration_n: 2, flow_duration_kind: "week", position: 0 };
    const specify = { id: 1, flow_id: 5, title: "Specify", parent_type: "flow", parent_id: 5, blocked_reason: null, position: 0 };
    const implement = { id: 2, flow_id: 5, title: "Implement", parent_type: "flow", parent_id: 5, blocked_reason: null, position: 1 };
    const cycle = { id: 1, flow_id: 5, item_type: "flow_task" as const, item_id: 1, scope_kind: "day", scope_index: 3, plan_kind: null, plan_start: null, plan_end: null, position: 0 };
    const dep = { id: 1, flow_id: 5, dependent_type: "flow_task" as const, dependent_id: 2, depends_on_type: "flow_task" as const, depends_on_id: 1 };

    const root = buildTree([aspect], [], [], [], [flow], [], [specify, implement], [cycle], [dep]);
    const flowNode = root.children[0]?.children[0];
    expect(flowNode?.kind).toBe("flow");
    const items = flowNode?.children ?? [];
    expect(items.map((n) => n.id)).toEqual(["flowtask-1", "flowtask-2"]);

    const specifyNode = items.find((n) => n.id === "flowtask-1");
    expect(specifyNode?.flowItem?.flowScopeKind).toBe("week");
    expect(specifyNode?.flowItem?.cycles).toEqual([
      { scopeKind: "day", scopeIndex: 3, planKind: null, planStart: null, planEnd: null },
    ]);

    const implementNode = items.find((n) => n.id === "flowtask-2");
    expect(implementNode?.flowItem?.dependsOn).toEqual([{ type: "flow_task", id: 1 }]);
  });
});

// --- useMindmapData hook integration ---

describe("useMindmapData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_domains") return Promise.resolve([]);
      if (cmd === "list_goals") return Promise.resolve([]);
      if (cmd === "list_tasks") return Promise.resolve([]);
      if (cmd === "list_infos") return Promise.resolve([]);
      if (cmd === "list_flows") return Promise.resolve([]);
      if (cmd === "list_all_flow_goals") return Promise.resolve([]);
      if (cmd === "list_all_flow_tasks") return Promise.resolve([]);
      if (cmd === "list_all_flow_cycles") return Promise.resolve([]);
      if (cmd === "list_all_flow_dependencies") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("starts in loading state and resolves to the built tree", async () => {
    const { result } = renderHook(() => useMindmapData());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.tree.id).toBe("root");
  });

  it("populates the tree from API data on mount", async () => {
    const aspect: Domain = mkDomain({ id: 1, subtype: "aspect", title: "Work" });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "list_domains") return Promise.resolve([aspect]);
      if (cmd === "list_goals") return Promise.resolve([]);
      if (cmd === "list_tasks") return Promise.resolve([]);
      if (cmd === "list_infos") return Promise.resolve([]);
      if (cmd === "list_flows") return Promise.resolve([]);
      if (cmd === "list_all_flow_goals") return Promise.resolve([]);
      if (cmd === "list_all_flow_tasks") return Promise.resolve([]);
      if (cmd === "list_all_flow_cycles") return Promise.resolve([]);
      if (cmd === "list_all_flow_dependencies") return Promise.resolve([]);
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tree.children[0]?.title).toBe("Work");
  });

  it("sets error when an API call fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("backend down"));
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("backend down");
  });
});

// --- useMindmapData mutation tests ---

describe("useMindmapData — mutations", () => {
  const ASPECT = mkDomain({ id: 1, subtype: "aspect", title: "Work" });
  const GOAL = mkGoal({ id: 1, parent_type: "domain", parent_id: 1, title: "Ship MVP" });
  const TASK = mkTask({ id: 1, parent_type: "goal", parent_id: 1, title: "Write code", position: 0 });
  const TASK2 = mkTask({ id: 2, parent_type: "goal", parent_id: 1, title: "Review PR", position: 1 });

  function setupInvoke(extras: Record<string, unknown> = {}) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (Object.prototype.hasOwnProperty.call(extras, cmd)) return Promise.resolve(extras[cmd]);
      if (cmd === "list_domains") return Promise.resolve([ASPECT]);
      if (cmd === "list_goals") return Promise.resolve([GOAL]);
      if (cmd === "list_tasks") return Promise.resolve([TASK, TASK2]);
      if (cmd === "list_infos") return Promise.resolve([]);
      if (cmd === "list_flows") return Promise.resolve([]);
      if (cmd === "list_all_flow_goals") return Promise.resolve([]);
      if (cmd === "list_all_flow_tasks") return Promise.resolve([]);
      if (cmd === "list_all_flow_cycles") return Promise.resolve([]);
      if (cmd === "list_all_flow_dependencies") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupInvoke();
  });

  async function loadedHook() {
    const hook = renderHook(() => useMindmapData());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }

  describe("createNode", () => {
    it("domain child kind: calls create_domain with the correct subtype and parent_id", async () => {
      const newDomain = mkDomain({ id: 10, subtype: "project", title: "Ops", parent_id: 1 });
      setupInvoke({ create_domain: newDomain });
      const { result } = await loadedHook();

      let returned: { id: string; kind: string } | undefined;
      await act(async () => {
        returned = await result.current.createNode("domain-1", "aspect", "project", "Ops");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_domain", {
        request: { title: "Ops", description: null, subtype: "project", parent_id: 1, status: null, knowledge_base_directory: null },
      });
      expect(returned?.id).toBe("domain-10");
      expect(returned?.kind).toBe("project");
    });

    it("goal child kind: calls create_goal with kindToParentType of the parent", async () => {
      const newGoal = mkGoal({ id: 20, title: "New Goal" });
      setupInvoke({ create_goal: newGoal });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.createNode("domain-1", "aspect", "goal", "New Goal");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_goal", {
        request: { title: "New Goal", parent_type: "project", parent_id: 1 },
      });
    });

    it("task child kind: calls create_task with the parent_type", async () => {
      const newTask = mkTask({ id: 30, title: "New Task" });
      setupInvoke({ create_task: newTask });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.createNode("goal-1", "goal", "task", "New Task");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", {
        request: { title: "New Task", parent_type: "goal", parent_id: 1 },
      });
    });

    it("info child kind: calls create_info with the parent_type and next position", async () => {
      const newInfo = { id: 40, body: "My note", parent_type: "goal", parent_id: 1, position: 0 };
      setupInvoke({ create_info: newInfo });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.createNode("goal-1", "goal", "info", "My note");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_info", {
        request: expect.objectContaining({ body: "My note", parent_type: "goal", parent_id: 1 }),
      });
    });

    it("throws for an invalid child kind", async () => {
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.createNode("domain-1", "aspect", "aspect" as "domain", "X");
        }),
      ).rejects.toThrow('Cannot create a node of kind "aspect"');
    });
  });

  describe("renameNode", () => {
    it("goal: calls update_goal with the new title", async () => {
      setupInvoke({ update_goal: { ...GOAL, title: "Renamed" } });
      const { result } = await loadedHook();

      await act(async () => { await result.current.renameNode("goal-1", "goal", "Renamed"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_goal", { id: 1, request: { title: "Renamed" } });
    });

    it("task: calls update_task with the new title", async () => {
      setupInvoke({ update_task: { ...TASK, title: "Renamed" } });
      const { result } = await loadedHook();

      await act(async () => { await result.current.renameNode("task-1", "task", "Renamed"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", { id: 1, request: { title: "Renamed" } });
    });

    it("info: calls update_info with body as title", async () => {
      const INFO = mkInfo({ id: 5, parent_type: "goal", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], update_info: { ...INFO, body: "Updated" } });
      const { result } = await loadedHook();

      await act(async () => { await result.current.renameNode("info-5", "info", "Updated"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_info", { id: 5, request: { body: "Updated" } });
    });

    it("domain/aspect/project: calls update_domain with the new title", async () => {
      setupInvoke({ update_domain: { ...ASPECT, title: "Renamed" } });
      const { result } = await loadedHook();

      await act(async () => { await result.current.renameNode("domain-1", "aspect", "Renamed"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_domain", { id: 1, request: { title: "Renamed" } });
    });
  });

  describe("moveNode", () => {
    it("goal: calls update_goal with the new parent and position", async () => {
      setupInvoke({ update_goal: GOAL });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("goal-1", "goal", "domain-1", "aspect", 3);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_goal", {
        id: 1, request: { parent_type: "project", parent_id: 1, position: 3 },
      });
    });

    it("task: calls update_task with the new parent and position", async () => {
      setupInvoke({ update_task: TASK });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("task-1", "task", "goal-1", "goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", {
        id: 1, request: { parent_type: "goal", parent_id: 1, position: 0 },
      });
    });
  });

  describe("removeNode", () => {
    it("goal: calls delete_goal with the db id", async () => {
      setupInvoke({ delete_goal: undefined });
      const { result } = await loadedHook();

      await act(async () => { await result.current.removeNode([{ id: "goal-1", kind: "goal" }]); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_goal", { id: 1 });
    });

    it("task: calls delete_task with the db id", async () => {
      setupInvoke({ delete_task: undefined });
      const { result } = await loadedHook();

      await act(async () => { await result.current.removeNode([{ id: "task-1", kind: "task" }]); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_task", { id: 1 });
    });

    it("domain/project: calls delete_domain with the db id", async () => {
      setupInvoke({ delete_domain: undefined });
      const { result } = await loadedHook();

      // Wire a project under the aspect so it can be deleted
      const PROJECT = mkDomain({ id: 5, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], delete_domain: undefined });
      await act(async () => { await result.current.reload(); });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => { await result.current.removeNode([{ id: "domain-5", kind: "project" }]); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_domain", { id: 5 });
    });

    it("aspect: skips deletion (aspects are immutable)", async () => {
      const { result } = await loadedHook();

      await act(async () => { await result.current.removeNode([{ id: "domain-1", kind: "aspect" }]); });

      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_domain", expect.anything());
    });
  });

  describe("reorderNode", () => {
    it("swaps positions of a task with the next sibling", async () => {
      setupInvoke({ update_task: TASK });
      const { result } = await loadedHook();

      await act(async () => { await result.current.reorderNode("task-1", 1); });

      // task-1 gets task-2's position (1), task-2 gets task-1's position (0)
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", { id: 1, request: { position: 1 } });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_task", { id: 2, request: { position: 0 } });
    });

    it("does nothing when the node has no next sibling in the given direction", async () => {
      const { result } = await loadedHook();
      const callCountAfterLoad = vi.mocked(invoke).mock.calls.length;

      await act(async () => { await result.current.reorderNode("task-2", 1); });

      expect(vi.mocked(invoke).mock.calls.length).toBe(callCountAfterLoad);
    });
  });

  describe("createChild", () => {
    it("creates a goal child when parent is a goal", async () => {
      const newGoal = mkGoal({ id: 50, title: "" });
      setupInvoke({ create_goal: newGoal });
      const { result } = await loadedHook();

      await act(async () => { await result.current.createChild("goal-1", "goal", "Sub-goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_goal", {
        request: { title: "Sub-goal", parent_type: "goal", parent_id: 1 },
      });
    });

    it("creates a task child when parent is a task", async () => {
      const newTask = mkTask({ id: 50, title: "" });
      setupInvoke({ create_task: newTask });
      // Wire a task under the goal so createChild has a task node to act on
      const { result } = renderHook(() => useMindmapData());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => { await result.current.createChild("task-1", "task", "Sub-task"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", {
        request: { title: "Sub-task", parent_type: "task", parent_id: 1 },
      });
    });
  });

  describe("retypeNode", () => {
    it("same-table project→domain: calls update_domain with the new subtype", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], update_domain: { ...PROJECT, subtype: "domain" } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_domain", {
        id: 2, request: { subtype: "domain" },
      });
      expect(newId).toBeNull();
    });

    it("domain→goal: creates goal, re-parents children, deletes domain", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      const newGoal = mkGoal({ id: 99, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], create_goal: newGoal, delete_domain: undefined, update_goal: newGoal });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_goal", {
        request: { title: "Ops", parent_type: "project", parent_id: 1 },
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_domain", { id: 2 });
      expect(newId).toBe("goal-99");
    });

    it("goal→task: maps status, creates task, deletes goal", async () => {
      const newTask = mkTask({ id: 99, title: "Ship MVP" });
      setupInvoke({ create_task: newTask, delete_goal: undefined, update_task: newTask });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("goal-1", "goal", "task"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", {
        request: { title: "Ship MVP", parent_type: "project", parent_id: 1, status: "todo" },
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_goal", { id: 1 });
      expect(newId).toBe("task-99");
    });

    it("task→goal: maps status, creates goal, deletes task", async () => {
      const newGoal = mkGoal({ id: 99, title: "Write code" });
      setupInvoke({ create_goal: newGoal, delete_task: undefined, update_goal: newGoal });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("task-1", "task", "goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_goal", {
        request: { title: "Write code", parent_type: "goal", parent_id: 1, status: "active" },
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_task", { id: 1 });
      expect(newId).toBe("goal-99");
    });

    it("returns null when the node has no parent (e.g. an aspect with no retype path)", async () => {
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      // aspect→goal is blocked because aspect has no meaningful parent in the domain table
      await act(async () => { newId = await result.current.retypeNode("domain-1", "aspect", "goal"); });

      expect(newId).toBeNull();
    });

    it("domain→task: creates task, deletes domain, returns task-id", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      const newTask = mkTask({ id: 99, title: "Ops", parent_type: "project", parent_id: 1 });
      setupInvoke({ list_domains: [ASPECT, PROJECT], create_task: newTask, delete_domain: undefined, update_task: newTask });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "task"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", {
        request: { title: "Ops", parent_type: "project", parent_id: 1 },
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_domain", { id: 2 });
      expect(newId).toBe("task-99");
    });

    it("goal→domain: creates domain, deletes goal, returns domain-id", async () => {
      const newDomain = mkDomain({ id: 99, subtype: "domain", parent_id: 1, title: "Ship MVP" });
      setupInvoke({ create_domain: newDomain, delete_goal: undefined, update_domain: newDomain });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("goal-1", "goal", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_domain", {
        request: expect.objectContaining({ title: "Ship MVP", subtype: "domain", parent_id: 1 }),
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_goal", { id: 1 });
      expect(newId).toBe("domain-99");
    });

    it("task→domain: creates domain, deletes task, returns domain-id", async () => {
      const newDomain = mkDomain({ id: 99, subtype: "domain", parent_id: 1, title: "Write code" });
      setupInvoke({ create_domain: newDomain, delete_task: undefined, update_domain: newDomain });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("task-1", "task", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_domain", {
        request: expect.objectContaining({ title: "Write code", subtype: "domain" }),
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_task", { id: 1 });
      expect(newId).toBe("domain-99");
    });

    it("domain→info: creates info, deletes domain, returns info-id", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      const newInfo = mkInfo({ id: 10, body: "Ops", parent_type: "aspect", parent_id: 1, position: 0 });
      setupInvoke({ list_domains: [ASPECT, PROJECT], create_info: newInfo, delete_domain: undefined });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "info"); });

      // Parent of domain-2 is ASPECT (kind="aspect"), so parent_type is "aspect"
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_info", {
        request: expect.objectContaining({ body: "Ops", parent_type: "aspect", parent_id: 1 }),
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_domain", { id: 2 });
      expect(newId).toBe("info-10");
    });

    it("info→goal: creates goal, deletes info, returns goal-id", async () => {
      const INFO = mkInfo({ id: 5, body: "My note", parent_type: "task", parent_id: 1 });
      const newGoal = mkGoal({ id: 99, title: "My note", parent_type: "goal", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], create_goal: newGoal, delete_info: undefined, update_goal: newGoal });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("info-5", "info", "goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_goal", {
        request: expect.objectContaining({ title: "My note" }),
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_info", { id: 5 });
      expect(newId).toBe("goal-99");
    });

    it("info→domain: creates domain, deletes info, returns domain-id", async () => {
      const INFO = mkInfo({ id: 5, body: "My note", parent_type: "task", parent_id: 1 });
      const newDomain = mkDomain({ id: 99, subtype: "domain", parent_id: 1, title: "My note" });
      setupInvoke({ list_infos: [INFO], create_domain: newDomain, delete_info: undefined, update_domain: newDomain });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("info-5", "info", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_domain", {
        request: expect.objectContaining({ title: "My note", subtype: "domain" }),
      });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_info", { id: 5 });
      expect(newId).toBe("domain-99");
    });

    it("flow_goal→flow_task: converts via convert_flow_item", async () => {
      const FLOW = { id: 5, title: "Feature", instance_type: "task", parent_type: "aspect", parent_id: 1, target_type: null, target_id: null, flow_duration_n: null, flow_duration_kind: null, position: 0 };
      const FLOW_GOAL = { id: 1, flow_id: 5, title: "Milestone", parent_type: "flow", parent_id: 5, blocked_reason: null, position: 0 };
      setupInvoke({ list_flows: [FLOW], list_all_flow_goals: [FLOW_GOAL], convert_flow_item: 42 });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("flowgoal-1", "flow_goal", "flow_task"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("convert_flow_item", {
        fromType: "flow_goal", id: 1, toType: "flow_task",
      });
      expect(newId).toBe("flowtask-42");
    });
  });

  describe("moveNode — domain variant", () => {
    it("domain/project kind: calls update_domain via dynamic import with parent_id and position", async () => {
      const PROJECT = mkDomain({ id: 5, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], update_domain: PROJECT });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("domain-5", "project", "domain-1", "aspect", 2);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_domain", {
        id: 5, request: { parent_id: 1, position: 2 },
      });
    });
  });
});
