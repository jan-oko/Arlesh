import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { invokedCommands } from "@/test/command-mock";
import { renderHook, waitFor, act } from "@testing-library/react";
import { buildTree, useMindmapData, decorateIterationRoots } from "./use-mindmap-data";
import { occurrenceOrigin, occurrenceRow } from "@/test/occurrence";
import type { RowId } from "@/api/node-id";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { Task } from "@/api/tasks";
import type { Info } from "@/api/infos";
import type { Flow, FlowGoal, FlowTask } from "@/api/flows";
import type { MindmapLoad } from "@/api/mindmap";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import { useMindmapStore } from "@/stores/use-mindmap-store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// A stable object reference, matching the real hook's `useMemo` — an inline object literal would
// be a fresh reference every render, breaking the `useCallback([scopeLabels])` deps in the hook
// under test and looping its `useEffect(() => { void load(); }, [load])` forever.
const STUB_SCOPE_LABELS = {
  unscoped: "Unscoped",
  unplanned: "Unplanned",
  week: (n: number) => `W${n}`,
  month: (m: number) => ["Jan", "Feb", "Mar", "Apr", "May", "June"][m - 1] ?? "M",
  season: (name: string) => name,
  duration: (count: number, kind: string) => `${count} ${kind}`,
};

vi.mock("@/hooks/use-scope-labels", () => ({
  useScopeLabels: () => STUB_SCOPE_LABELS,
}));

// --- Fixture helpers ---

function mkDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: 1, title: "Domain", description: null, subtype: "aspect",
    parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false,
    ...overrides,
  };
}

function mkGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1, title: "Goal", parent_type: "domain", parent_id: 1,
    status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false,
    ...overrides,
  };
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, title: "Task", parent_type: "goal", parent_id: 1,
    status: "todo", delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
    ...overrides,
  };
}

function mkInfo(overrides: Partial<Info> = {}): Info {
  return {
    id: 1, body: "Note", details: null, parent_type: "task", parent_id: 1, position: 0, is_private: false,
    ...overrides,
  };
}

function mkFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: 1, title: "Flow", instance_type: "task", parent_type: "domain", parent_id: 1,
    target_type: null, target_id: null, flow_duration_n: 1, flow_duration_kind: "week",
    flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
    is_habit: false, root_plan_kind: null, root_plan_start: null, root_plan_end: null,
    verdict_window_n: null, verdict_window_kind: null,
    position: 0, is_private: false,
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

  // Node ids are frozen as spelled (Arlesh-z7n): tab state persisted before rowId existed —
  // selection, collapse, subtree root — names nodes by these strings and must still find them.
  it("keeps every id spelled as before, and carries the row it draws as rowId", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 4, parent_type: "domain", parent_id: 1 });
    const task = mkTask({ id: 9, parent_type: "goal", parent_id: 4 });
    const info = mkInfo({ id: 2, parent_type: "task", parent_id: 9 });
    const flow = mkFlow({ id: 3, parent_type: "domain", parent_id: 1 });
    const flowGoal = { id: 6, flow_id: 3, title: "M", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
    const flowTask = { id: 7, flow_id: 3, title: "S", parent_type: "flow_goal", parent_id: 6, position: 0, is_private: false };
    const root = buildTree([aspect], [goal], [task], [info], [], [flow], [flowGoal], [flowTask]);

    const drawn = new Map<string, RowId | undefined>();
    const visit = (node: MindmapNode): void => {
      drawn.set(node.id, node.rowId);
      node.children.forEach(visit);
    };
    visit(root);
    expect(Object.fromEntries(drawn)).toEqual({
      root: undefined,
      "domain-1": 1, "goal-4": 4, "task-9": 9, "info-2": 2,
      "flow-3": 3, "flowgoal-6": 6, "flowtask-7": 7,
    });
  });

  it("draws a Compound Task's derived block among its virtual blockers, never as a stored reason", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, parent_type: "domain", parent_id: 1, compound: true });
    const root = buildTree(
      [aspect], [], [task], [], [], [], [], [], [], [],
      [{ owner_type: "task", owner_id: 1, reason: "All open sub-items are blocked", position: 0, derived: "compound" }],
      [], [], [], (title) => title, (title) => title, "Sub-items all blocked",
    );
    const node = root.children[0]?.children.find((n) => n.id === "task-1");
    expect(node?.compoundBlocked).toBe(true);
    expect(node?.blockReasons).toEqual([]);
    expect(node?.virtualBlockers).toEqual(["Sub-items all blocked"]);
  });

  it("draws a Habit cooldown's derived block as a virtual blocker that names when it lifts", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 1, parent_type: "domain", parent_id: 1 });
    const root = buildTree(
      [aspect], [], [task], [], [], [], [], [], [], [],
      [{
        owner_type: "task", owner_id: 1, reason: "Cooling down until Mon 2026-10-05 02:00", position: 0,
        derived: "cooldown", until: "2026-10-05T02:00:00",
      }],
      [], [], [], (title) => title, (title) => title, "compound", "capacity", (until) => `cool ${until}`,
    );
    const node = root.children[0]?.children.find((n) => n.id === "task-1");
    expect(node?.coolingUntil).toBe("2026-10-05T02:00:00");
    expect(node?.blockReasons).toEqual([]);
    expect(node?.virtualBlockers).toEqual(["cool 2026-10-05T02:00:00"]);
  });

  it("carries a task's stored Backlog state onto its node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const aside = mkTask({ id: 1, parent_type: "domain", parent_id: 1, archival: "backlog" });
    const live = mkTask({ id: 2, parent_type: "domain", parent_id: 1, archival: "live" });
    const root = buildTree([aspect], [], [aside, live], []);
    const tasks = root.children[0]?.children ?? [];
    expect(tasks.find((n) => n.id === "task-1")?.backlogged).toBe(true);
    expect(tasks.find((n) => n.id === "task-2")?.backlogged).toBe(false);
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

  it("stores goal status and its ordered block reasons on the node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const goal = mkGoal({ id: 1, status: "frozen", parent_type: "domain", parent_id: 1 });
    const root = buildTree([aspect], [goal], [], [], [], [], [], [], [], [], [
      { owner_type: "goal", owner_id: 1, reason: "waiting on X", position: 0 },
      { owner_type: "goal", owner_id: 1, reason: "needs sign-off", position: 1 },
    ]);
    const goalNode = root.children[0]?.children[0];
    expect(goalNode?.status).toBe("frozen");
    expect(goalNode?.blockReasons).toEqual(["waiting on X", "needs sign-off"]);
  });

  it("names an unmet dependency by its short id, and carries the short id on its node", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const blocker = mkTask({ id: 2, title: "Dep", status: "in_progress", parent_type: "project", parent_id: 1 });
    const blocked = mkTask({ id: 3, title: "Waiter", parent_type: "project", parent_id: 1 });
    const root = buildTree(
      [aspect], [], [blocker, blocked], [], [], [], [], [], [], [], [],
      [{ task_id: 3, dependency_type: "task", dependency_id: 2 }],
      [], [], (title) => title, (title) => title, "compound", "capacity", (until) => until,
      { "task-2": "6f3", "task-3": "a1c" },
    );
    const tasks = root.children[0]?.children ?? [];
    expect(tasks.find((c) => c.id === "task-3")?.virtualBlockers).toEqual(["Blocked by task 6f3 (Dep)"]);
    expect(tasks.find((c) => c.id === "task-2")?.shortId).toBe("6f3");
  });

  it("derives virtual block reasons from unmet task dependencies", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const blocker = mkTask({ id: 2, title: "Dep", status: "in_progress", parent_type: "project", parent_id: 1 });
    const blocked = mkTask({ id: 3, title: "Waiter", parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [blocker, blocked], [], [], [], [], [], [], [], [], [
      { task_id: 3, dependency_type: "task", dependency_id: 2 },
    ]);
    const node = root.children[0]?.children.find((c) => c.id === "task-3");
    expect(node?.virtualBlockers).toEqual(["Blocked by task 2 (Dep)"]);
    // The unmet dependency's own node id, which Start's child-dependency rule reads.
    expect(node?.blockingDependencyIds).toEqual(["task-2"]);
  });

  it("draws the agent capacity lock's derived reason as a virtual blocker, in its own words", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const task = mkTask({ id: 3, title: "Agent work", parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [task], [], [], [], [], [], [], [], [
      { owner_type: "task", owner_id: 3, reason: "waiting on review", position: 0 },
      { owner_type: "task", owner_id: 3, reason: "Agents at capacity", position: 1, derived: "agent_capacity" },
    ], [], [], [], (title) => title, (title) => title, "COMPOUND", "LOCKED");
    const node = root.children[0]?.children.find((c) => c.id === "task-3");
    expect(node?.blockReasons).toEqual(["waiting on review"]);
    expect(node?.virtualBlockers).toEqual(["LOCKED"]);
    expect(node?.capacityBlocked).toBe(true);
    expect(node !== undefined && isNodeBlocked(node)).toBe(true);
  });

  it("omits a virtual block reason once the dependency is done", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const blocker = mkTask({ id: 2, title: "Dep", status: "done", parent_type: "project", parent_id: 1 });
    const blocked = mkTask({ id: 3, title: "Waiter", parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [blocker, blocked], [], [], [], [], [], [], [], [], [
      { task_id: 3, dependency_type: "task", dependency_id: 2 },
    ]);
    const node = root.children[0]?.children.find((c) => c.id === "task-3");
    expect(node?.virtualBlockers).toEqual([]);
    expect(node?.blockingDependencyIds).toBeUndefined();
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
    const flow = { id: 5, title: "Feature", instance_type: "task" as const, parent_type: "aspect", parent_id: 1, target_type: null, target_id: null, flow_duration_n: 2, flow_duration_kind: "week", flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null, is_habit: false, root_plan_kind: null, root_plan_start: null, root_plan_end: null, verdict_window_n: null, verdict_window_kind: null, position: 0, is_private: false };
    const specify = { id: 1, flow_id: 5, title: "Specify", parent_type: "flow", parent_id: 5, blocked_reason: null, position: 0, is_private: false };
    const implement = { id: 2, flow_id: 5, title: "Implement", parent_type: "flow", parent_id: 5, blocked_reason: null, position: 1, is_private: false };
    const cycle = { id: 1, flow_id: 5, item_type: "flow_task" as const, item_id: 1, scope_kind: "day", scope_index: 3, plan_kind: null, plan_start: null, plan_end: null, position: 0 };
    const dep = { id: 1, flow_id: 5, dependent_type: "flow_task" as const, dependent_id: 2, depends_on_type: "flow_task" as const, depends_on_id: 1 };

    const root = buildTree([aspect], [], [], [], [], [flow], [], [specify, implement], [cycle], [dep]);
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

// The hook makes exactly one fetch — `load_mindmap` — so the stub builds the whole envelope
// rather than answering thirteen list commands. `overrides` names the fields a test cares about;
// everything else is empty. (`habits` defaults to one loaded, empty entry per flow, which is what
// the backend returns for a flow with no recurrence.)
function mindmapEnvelope(overrides: Partial<MindmapLoad> = {}): MindmapLoad {
  const flows = overrides.flows ?? [];
  return {
    domains: [], goals: [], tasks: [], commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_cycles: [], flow_dependencies: [],
    block_reasons: [], task_dependencies: [], flow_instance_nodes: [], lifecycles: [],
    habits: flows.map((flow) => ({
      flow_id: flow.id,
      flow_title: flow.title,
      result: { outcome: "loaded" as const },
    })),
    ...overrides,
  };
}

/** The list a test supplied for `command`, or `fallback` when it did not name that command. */
function listExtra<T>(extras: Record<string, unknown>, command: string, fallback: T[]): T[] {
  const supplied = extras[command];
  return Array.isArray(supplied) ? supplied : fallback;
}

describe("useMindmapData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMindmapStore.getState().clearToast();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope());
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
      if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope({ domains: [aspect] }));
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

  it("fetches the whole mindmap in a single round trip, beside which nodes the MCP can see", async () => {
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // The Gesture the wrapper opens around it is protocol, not a round trip for data. The MCP
    // visibility is its own read, issued alongside rather than after, so the load still waits on
    // one round trip.
    expect(invokedCommands().sort()).toEqual(["list_mcp_access", "load_mindmap"]);
  });

  it("stamps the nodes the MCP can see with the root they are seen through", async () => {
    const aspect: Domain = mkDomain({ id: 1, subtype: "aspect", title: "Growth" });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope({ domains: [aspect] }));
      if (cmd === "list_mcp_access") {
        return Promise.resolve([{ node_kind: "domain", node_id: 1, root_kind: "domain", root_id: 1 }]);
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tree.children[0]?.mcpVisibleVia).toBe("Growth");
  });

  it("still loads the board when the MCP visibility cannot be read", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope());
      if (cmd === "list_mcp_access") return Promise.reject(new Error("no access table"));
      return Promise.resolve(undefined);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    warn.mockRestore();
  });

  it("surfaces the flow whose habit iterations failed as a load condition instead of silently emptying it", async () => {
    const flow = mkFlow({ id: 7, title: "Standup" });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") {
        return Promise.resolve(
          mindmapEnvelope({
            flows: [flow],
            habits: [
              {
                flow_id: 7,
                flow_title: "Standup",
                result: { outcome: "failed", message: "a habit requires a scoped flow" },
              },
            ],
          }),
        );
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The load still succeeds — one bad flow does not blank the mindmap.
    expect(result.current.error).toBeNull();
    // This is a load condition (background, node-agnostic), not a `pendingToast` (anchored,
    // user-caused) — a failed derivation means the tree is currently showing wrong data, which
    // calls for a persistent banner rather than a toast anchored on a node the user never touched.
    expect(useMindmapStore.getState().pendingToast).toBeNull();
    expect(result.current.loadCondition.failedFlows).toEqual([{ id: 7, title: "Standup" }]);
  });

  it("lists every failed flow, not just the first, when several fail", async () => {
    const flows = [mkFlow({ id: 7, title: "Standup" }), mkFlow({ id: 8, title: "Retro" })];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") {
        return Promise.resolve(
          mindmapEnvelope({
            flows,
            habits: flows.map((flow) => ({
              flow_id: flow.id,
              flow_title: flow.title,
              result: { outcome: "failed" as const, message: "nope" },
            })),
          }),
        );
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.loadCondition.failedFlows).toEqual([
      { id: 7, title: "Standup" },
      { id: 8, title: "Retro" },
    ]);
  });

  it("reports no load condition when every flow loads", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") {
        return Promise.resolve(mindmapEnvelope({ flows: [mkFlow({ id: 7, title: "Standup" })] }));
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.loadCondition.failedFlows).toEqual([]);
  });

  it("names a commitment habit whose template holds a goal item, whose iterations it cannot draw", async () => {
    // Its derivation did not fail — the backend has nothing to object to until someone starts it.
    // The frontend refuses to draw a Goal under a Commitment, so it says which habit went missing.
    const nightly = mkFlow({ id: 7, title: "Asleep by 23:00", instance_type: "commitment", is_habit: true });
    const milestone: FlowGoal = { id: 9, flow_id: 7, title: "Milestone", parent_type: "flow", parent_id: 7, position: 0, is_private: false };
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") {
        return Promise.resolve(mindmapEnvelope({ flows: [nightly], flow_goals: [milestone] }));
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.loadCondition.failedFlows).toEqual([]);
    expect(result.current.loadCondition.unrenderableCommitmentFlows).toEqual([
      { id: 7, title: "Asleep by 23:00" },
    ]);
  });

  it("clears a previously reported load condition once a subsequent load has no failures", async () => {
    const flow = mkFlow({ id: 7, title: "Standup" });
    let habits: MindmapLoad["habits"] = [
      { flow_id: 7, flow_title: "Standup", result: { outcome: "failed", message: "nope" } },
    ];
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope({ flows: [flow], habits }));
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadCondition.failedFlows).toEqual([{ id: 7, title: "Standup" }]);

    habits = [{ flow_id: 7, flow_title: "Standup", result: { outcome: "loaded" } }];
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.loadCondition.failedFlows).toEqual([]);
  });
});

// --- useMindmapData mutation tests ---

describe("useMindmapData — mutations", () => {
  const ASPECT = mkDomain({ id: 1, subtype: "aspect", title: "Work" });
  const GOAL = mkGoal({ id: 1, parent_type: "domain", parent_id: 1, title: "Ship MVP" });
  const TASK = mkTask({ id: 1, parent_type: "goal", parent_id: 1, title: "Write code", position: 0 });
  const TASK2 = mkTask({ id: 2, parent_type: "goal", parent_id: 1, title: "Review PR", position: 1 });

  /**
   * Stubs `invoke`. `extras` is still keyed by the command a test is thinking of — the thirteen
   * list commands now land in the single `load_mindmap` envelope rather than answering on their
   * own, and everything else (`create_goal`, `delete_domain`, …) is returned as before.
   */
  function setupInvoke(extras: Record<string, unknown> = {}) {
    const envelope = mindmapEnvelope({
      domains: listExtra(extras, "list_domains", [ASPECT]),
      goals: listExtra(extras, "list_goals", [GOAL]),
      tasks: listExtra(extras, "list_tasks", [TASK, TASK2]),
      infos: listExtra(extras, "list_infos", []),
      flows: listExtra(extras, "list_flows", []),
      flow_goals: listExtra(extras, "list_all_flow_goals", []),
      flow_tasks: listExtra(extras, "list_all_flow_tasks", []),
      flow_cycles: listExtra(extras, "list_all_flow_cycles", []),
      flow_dependencies: listExtra(extras, "list_all_flow_dependencies", []),
      block_reasons: listExtra(extras, "list_all_block_reasons", []),
      task_dependencies: listExtra(extras, "list_all_task_dependencies", []),
      flow_instance_nodes: listExtra(extras, "list_flow_instance_nodes", []),
      lifecycles: listExtra(extras, "derive_scope_lifecycles", []),
    });
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "load_mindmap") return Promise.resolve(envelope);
      if (Object.prototype.hasOwnProperty.call(extras, cmd)) return Promise.resolve(extras[cmd]);
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

  it("stamps a task's own Plan position from its lifecycle, and none on an unplanned one", async () => {
    setupInvoke({
      derive_scope_lifecycles: [
        { node_type: "task", node_id: 1, timing: "active", archival: "live", archival_conflict: false, plan_timing: "pending" },
        { node_type: "task", node_id: 2, timing: "active", archival: "live", archival_conflict: false },
      ],
    });
    const { result } = await loadedHook();
    const tasks = result.current.tree.children[0]?.children[0]?.children ?? [];
    expect(tasks.find((n) => n.id === "task-1")?.planTiming).toBe("pending");
    expect(tasks.find((n) => n.id === "task-2")).toBeDefined();
    expect(tasks.find((n) => n.id === "task-2")?.planTiming).toBeUndefined();
  });

  describe("reload", () => {
    // MindmapView early-returns a full-screen "Loading…" whenever isLoading is true, which
    // unmounts the whole canvas — losing pan, zoom and DOM focus. `reload` is what every
    // mutation calls afterwards (status toggles, edits, deletes, conversions), so it must
    // refresh in place and never raise the spinner. Only the initial mount may do that.
    it("refreshes without ever raising the loading spinner", async () => {
      setupInvoke();
      const { result } = await loadedHook();

      // The load has to be observably in-flight. With an instantly-resolving mock React batches
      // the spinner on and off into a single render and nothing can see it — but in the real app
      // load_mindmap takes real time, so the spinner renders and MindmapView unmounts the canvas.
      const passthrough = vi.mocked(invoke).getMockImplementation();
      if (passthrough === undefined) throw new Error("invoke mock has no implementation");
      let release = (): void => { throw new Error("gate never armed"); };
      const gate = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        if (cmd === "load_mindmap") await gate;
        return passthrough(cmd, args);
      });

      let pending: Promise<void> = Promise.resolve();
      act(() => { pending = result.current.reload(); });

      // The refresh is in flight right now. The canvas must still be mounted.
      expect(result.current.isLoading).toBe(false);

      await act(async () => { release(); await pending; });
    });

    it("still fetches the tree again", async () => {
      setupInvoke();
      const { result } = await loadedHook();
      const before = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "load_mindmap").length;

      await act(async () => { await result.current.reload(); });

      const after = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "load_mindmap").length;
      expect(after).toBe(before + 1);
    });
  });

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

    it("a habit occurrence takes its child like any parent, by its own row id", async () => {
      // The same gesture as anywhere else — Tab on the selected node — and the same command: the
      // occurrence is a row with a UUID id, and the backend hangs the child on that iteration.
      const occurrence = mkTask({
        id: "6f1c2d4e-0000-5000-8000-000000000003", title: "Groceries", parent_type: "goal", parent_id: 1,
        origin: occurrenceOrigin({ habitId: 3, itemType: "flow_root", itemId: 3 }),
      });
      const envelope = mindmapEnvelope({ domains: [ASPECT], goals: [GOAL], tasks: [occurrence] });
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "load_mindmap") return Promise.resolve(envelope);
        if (cmd === "create_task") return Promise.resolve(mkTask({ id: 42, title: "buy milk" }));
        return Promise.resolve(null);
      });
      const { result } = await loadedHook();

      let returned: { id: string; kind: string } | undefined;
      await act(async () => {
        returned = await result.current.createNode(`task-${String(occurrence.id)}`, "task", "task", "buy milk");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_task", {
        request: expect.objectContaining({ title: "buy milk", parent_type: "task", parent_id: occurrence.id }),
      });
      expect(returned?.id).toBe("task-42");
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

    it("info: calls update_info with the new parent and position", async () => {
      const INFO = mkInfo({ id: 5, parent_type: "goal", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], update_info: INFO });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("info-5", "info", "task-1", "task", 1);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_info", {
        id: 5, request: { parent_type: "task", parent_id: 1, position: 1 },
      });
    });

    // Regression: a flow had no branch of its own, so its database id was handed to
    // `update_domain` — reparenting whichever domain happened to share that id (here the
    // aspect, which is also id 1) while the flow itself never moved.
    it("flow: calls update_flow with the new parent and never touches a domain", async () => {
      const FLOW = mkFlow({ id: 1, parent_type: "domain", parent_id: 1 });
      setupInvoke({ list_flows: [FLOW], update_flow: FLOW });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flow-1", "flow", "domain-1", "aspect", 2);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow", {
        id: 1, request: { parent_type: "aspect", parent_id: 1, position: 2 },
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("update_domain", expect.anything());
    });

    it("flow: records a goal parent as parent_type \"goal\"", async () => {
      const FLOW = mkFlow({ id: 1, parent_type: "domain", parent_id: 1 });
      setupInvoke({ list_flows: [FLOW], update_flow: FLOW });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flow-1", "flow", "goal-1", "goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow", {
        id: 1, request: { parent_type: "goal", parent_id: 1, position: 0 },
      });
    });

    // Instances render under the Target Node, and a null target *means* "my parent", resolved when
    // the iterations are placed. So a move rewrites the parent and nothing else: the instances come
    // along by construction, with no inference in the move path.
    it("flow: writes no Target Node for a flow whose target is the derived parent", async () => {
      const FLOW = mkFlow({ id: 1, parent_type: "domain", parent_id: 1, target_type: null, target_id: null });
      setupInvoke({ list_flows: [FLOW], update_flow: FLOW });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flow-1", "flow", "goal-1", "goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow", {
        id: 1, request: { parent_type: "goal", parent_id: 1, position: 0 },
      });
    });

    it("flow: leaves a Target Node pointed somewhere other than its parent alone", async () => {
      const FLOW = mkFlow({ id: 1, parent_type: "domain", parent_id: 1, target_type: "goal", target_id: 1 });
      setupInvoke({ list_flows: [FLOW], update_flow: FLOW });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flow-1", "flow", "goal-1", "goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow", {
        id: 1, request: { parent_type: "goal", parent_id: 1, position: 0 },
      });
    });

    it("flow: refuses a parent a flow may not hang from", async () => {
      const FLOW = mkFlow({ id: 1, parent_type: "domain", parent_id: 1 });
      setupInvoke({ list_flows: [FLOW] });
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.moveNode("flow-1", "flow", "task-1", "task", 0);
        }),
      ).rejects.toThrow('Flows cannot hang from a node of kind "task"');
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("update_flow", expect.anything());
    });

    it("flow_goal: calls update_flow_goal with its in-flow parent", async () => {
      const FLOW = mkFlow({ id: 5 });
      const FLOW_GOAL: FlowGoal = { id: 3, flow_id: 5, title: "Milestone", parent_type: "flow", parent_id: 5, position: 0, is_private: false };
      setupInvoke({ list_flows: [FLOW], list_all_flow_goals: [FLOW_GOAL], update_flow_goal: FLOW_GOAL });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flowgoal-3", "flow_goal", "flow-5", "flow", 1);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow_goal", {
        id: 3, request: { parent_type: "flow", parent_id: 5, position: 1 },
      });
    });

    it("flow_task: calls update_flow_task with its in-flow parent", async () => {
      const FLOW = mkFlow({ id: 5 });
      const FLOW_GOAL: FlowGoal = { id: 3, flow_id: 5, title: "Milestone", parent_type: "flow", parent_id: 5, position: 0, is_private: false };
      const FLOW_TASK: FlowTask = { id: 4, flow_id: 5, title: "Step", parent_type: "flow", parent_id: 5, position: 1, is_private: false };
      setupInvoke({
        list_flows: [FLOW], list_all_flow_goals: [FLOW_GOAL], list_all_flow_tasks: [FLOW_TASK],
        update_flow_task: FLOW_TASK,
      });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("flowtask-4", "flow_task", "flowgoal-3", "flow_goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_flow_task", {
        id: 4, request: { parent_type: "flow_goal", parent_id: 3, position: 0 },
      });
    });

    it("tag: calls update_domain with the new parent and position", async () => {
      const TAG = mkDomain({ id: 7, subtype: "tag", parent_id: 1, title: "urgent" });
      setupInvoke({ list_domains: [ASPECT, TAG], update_domain: TAG });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.moveNode("domain-7", "tag", "domain-1", "aspect", 4);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("update_domain", {
        id: 7, request: { parent_id: 1, position: 4 },
      });
    });

    it("aspect: refuses the move rather than silently giving the aspect a parent", async () => {
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.moveNode("domain-1", "aspect", "domain-1", "aspect", 0);
        }),
      ).rejects.toThrow("Aspects are top level and cannot be moved");
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("update_domain", expect.anything());
    });
  });

  describe("duplicateNode", () => {
    /** Flow 1 under the aspect, holding goal item 3 with task item 4 beneath it. */
    const FLOW_TEMPLATE = {
      list_flows: [mkFlow()],
      list_all_flow_goals: [
        { id: 3, flow_id: 1, title: "Milestone", parent_type: "flow", parent_id: 1, position: 0, is_private: false },
      ],
      list_all_flow_tasks: [
        { id: 4, flow_id: 1, title: "Step", parent_type: "flow_goal", parent_id: 3, position: 0, is_private: false },
      ],
    };

    it("goal: calls duplicate_goal with the target and position", async () => {
      setupInvoke({ duplicate_goal: GOAL });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("goal-1", "goal", "domain-1", "aspect", 3);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_goal", {
        id: 1, targetType: "project", targetId: 1, position: 3,
      });
    });

    it("task: calls duplicate_task with the target and position", async () => {
      setupInvoke({ duplicate_task: TASK });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("task-1", "task", "goal-1", "goal", 0);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_task", {
        id: 1, targetType: "goal", targetId: 1, position: 0,
      });
    });

    it("info: calls duplicate_info with the target's own kind as parent type", async () => {
      const INFO = mkInfo({ id: 5, parent_type: "goal", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], duplicate_info: INFO });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("info-5", "info", "task-1", "task", 1);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_info", {
        id: 5, targetType: "task", targetId: 1, position: 1,
      });
    });

    it("project: calls duplicate_domain, which takes a target id and no target type", async () => {
      const PROJECT = mkDomain({ id: 5, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], duplicate_domain: PROJECT });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("domain-5", "project", "domain-1", "aspect", 2);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_domain", {
        id: 5, targetId: 1, position: 2,
      });
    });

    it("refuses an aspect rather than writing a second one", async () => {
      setupInvoke({});
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.duplicateNode("domain-1", "aspect", "domain-1", "aspect", 0);
        }),
      ).rejects.toThrow("Aspects are fixed and cannot be duplicated");
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("duplicate_domain", expect.anything());
    });

    it("flow: calls duplicate_flow with the parent the paste chose", async () => {
      setupInvoke({ list_flows: [mkFlow()], duplicate_flow: mkFlow({ id: 2 }) });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("flow-1", "flow", "domain-1", "aspect", 2);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_flow", {
        flowId: 1, parentType: "aspect", parentId: 1, position: 2,
      });
    });

    it("flow item: calls duplicate_flow_item with its in-flow parent", async () => {
      setupInvoke({ ...FLOW_TEMPLATE, duplicate_flow_item: 9 });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.duplicateNode("flowtask-4", "flow_task", "flowgoal-3", "flow_goal", 1);
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("duplicate_flow_item", {
        itemType: "flow_task", itemId: 4, parentType: "flow_goal", parentId: 3, position: 1,
      });
    });

    it("refuses a flow pasted onto a node no Flow can hang from", async () => {
      setupInvoke({ list_flows: [mkFlow()] });
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.duplicateNode("flow-1", "flow", "task-1", "task", 0);
        }),
      ).rejects.toThrow('Flows cannot hang from a node of kind "task"');
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("duplicate_flow", expect.anything());
    });

    it("refuses a flow item pasted onto a real node", async () => {
      setupInvoke(FLOW_TEMPLATE);
      const { result } = await loadedHook();

      await expect(
        act(async () => {
          await result.current.duplicateNode("flowtask-4", "flow_task", "goal-1", "goal", 0);
        }),
      ).rejects.toThrow('Flow items cannot hang from a node of kind "goal"');
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("duplicate_flow_item", expect.anything());
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

describe("decorateIterationRoots", () => {
  function mkHabit(overrides: Partial<Flow> = {}): Flow {
    return {
      id: 3, title: "Exercise", instance_type: "task",
      parent_type: "domain", parent_id: 1,
      target_type: "goal", target_id: 5,
      flow_duration_n: 1, flow_duration_kind: "week",
      flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
      is_habit: true, root_plan_kind: null, root_plan_start: null, root_plan_end: null,
      verdict_window_n: null, verdict_window_kind: null, position: 0, is_private: false, ...overrides,
    };
  }

  /** An iteration root as the board builds it from its row: a node carrying the row's `origin`. */
  function rootNode(kind: "task" | "goal" | "commitment", extra: Partial<MindmapNode> = {}): MindmapNode {
    return {
      id: `${kind}-root`, kind, title: "Exercise", position: 0, tagIds: [], children: [],
      ...occurrenceRow({
        habitId: 3, itemType: "flow_root", itemId: 3, index: 2,
        startDate: "2026-01-05", windowEnd: "2026-01-12T00:00:00",
      }),
      ...extra,
    };
  }

  const LABELS = useScopeLabels();
  const CARRIES = ({ title, scope, first }: { title: string; scope: string; first: string }): string =>
    `${title} ${scope} from ${first}`;

  it("draws a root carrying missed windows as `{title} {scope} from {first}`", () => {
    const root = rootNode("task");
    const habit = root.origin?.kind === "habit" ? root.origin : undefined;
    if (habit === undefined) throw new Error("an iteration root carries a habit origin");
    habit.iteration_scope.missed_from = "2025-12-22";
    decorateIterationRoots(root, [mkHabit()], LABELS, "2026-01-06T09:00:00", CARRIES);
    expect(root.title).toBe("Exercise W2 from W52");
    expect(root.rowTitle).toBe("Exercise");
  });

  it("draws the root as `{title} {start scope}` and keeps the row's own title for the editor", () => {
    const root = rootNode("task");
    decorateIterationRoots(root, [mkHabit()], LABELS, "2026-01-06T09:00:00", CARRIES);
    expect(root.title).toBe("Exercise W2");
    expect(root.rowTitle).toBe("Exercise");
  });

  it("reads where the window sits, whether it has passed and how it ended off the origin", () => {
    const open = rootNode("task", { status: "todo" });
    const done = rootNode("task", { id: "task-done", status: "done" });
    decorateIterationRoots(open, [mkHabit()], LABELS, "2026-01-06T09:00:00", CARRIES);
    decorateIterationRoots(done, [mkHabit()], LABELS, "2026-02-01T09:00:00", CARRIES);
    expect(open.habitIteration).toEqual({
      flowId: 3, flowTitle: "Exercise", index: 2, scopeKind: "week",
      anchorDate: "2026-01-05", windowEnd: "2026-01-12T00:00:00", passed: false, done: false,
    });
    expect(done.habitIteration?.passed).toBe(true);
    expect(done.habitIteration?.done).toBe(true);
  });

  it("marks an owed iteration so the fold leaves it in view", () => {
    const owed = rootNode("task", { status: "todo" });
    const habit = owed.origin?.kind === "habit" ? owed.origin : undefined;
    if (habit === undefined) throw new Error("an iteration root carries a habit origin");
    habit.iteration_scope.owed = true;
    const plain = rootNode("task", { id: "task-plain", status: "todo" });
    decorateIterationRoots(owed, [mkHabit()], LABELS, "2026-02-01T09:00:00", CARRIES);
    decorateIterationRoots(plain, [mkHabit()], LABELS, "2026-02-01T09:00:00", CARRIES);
    expect(owed.habitIteration?.owed).toBe(true);
    expect(plain.habitIteration?.owed).toBeUndefined();
  });

  it("counts a goal root done once achieved, and a commitment root only once kept", () => {
    const goal = rootNode("goal", { status: "achieved" });
    const broken = rootNode("commitment", { verdict: "broken" });
    const kept = rootNode("commitment", { id: "commitment-kept", verdict: "kept" });
    for (const node of [goal, broken, kept]) {
      decorateIterationRoots(node, [mkHabit()], LABELS, "2026-02-01T09:00:00", CARRIES);
    }
    expect(goal.habitIteration?.done).toBe(true);
    expect(broken.habitIteration?.done).toBe(false);
    expect(kept.habitIteration?.done).toBe(true);
  });

  it("falls back to the raw start date for a sub-day window, which has no scope label", () => {
    const root = rootNode("task");
    decorateIterationRoots(root, [mkHabit({ flow_duration_kind: "exact" })], LABELS, "2026-01-06T09:00:00", CARRIES);
    expect(root.title).toBe("Exercise 2026-01-05");
    expect(root.habitIteration?.scopeKind).toBeNull();
  });

  it("leaves an occurrence below the root, and every stored row, as it is", () => {
    const item: MindmapNode = {
      id: "task-item", kind: "task", title: "Stretch", position: 0, tagIds: [], children: [],
      ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }),
    };
    const stored: MindmapNode = { id: "task-1", rowId: 1, kind: "task", title: "Plain", position: 0, tagIds: [], children: [] };
    const parent: MindmapNode = { id: "root", kind: "domain", title: "", position: 0, tagIds: [], children: [item, stored] };
    decorateIterationRoots(parent, [mkHabit()], LABELS, "2026-01-06T09:00:00", CARRIES);
    expect(item.title).toBe("Stretch");
    expect(item.habitIteration).toBeUndefined();
    expect(stored.title).toBe("Plain");
    expect(stored.rowTitle).toBeUndefined();
  });
});
