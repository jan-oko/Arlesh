import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { invokedCommands } from "@/test/command-mock";
import { renderHook, waitFor, act } from "@testing-library/react";
import { buildTree, useMindmapData, injectHabitInstances } from "./use-mindmap-data";
import type { HabitInstanceChild } from "@/api/flows";
import { useScopeLabels } from "@/hooks/use-scope-labels";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { Task } from "@/api/tasks";
import type { Info } from "@/api/infos";
import type {
  Flow, FlowGoal, FlowItemType, FlowTask, HabitInstance, HabitIteration, HabitItemStatus,
} from "@/api/flows";
import { NO_CYCLE } from "@/api/flows";
import type { MindmapLoad } from "@/api/mindmap";
import type { MindmapNode } from "@/utils/tree-layout";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { testKey } from "@/test/scope-key";
import type { ScopeKey } from "@/api/scopes";

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

    const drawn = new Map<string, number | undefined>();
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

  it("derives virtual block reasons from unmet task dependencies", () => {
    const aspect = mkDomain({ id: 1, subtype: "aspect" });
    const blocker = mkTask({ id: 2, title: "Dep", status: "in_progress", parent_type: "project", parent_id: 1 });
    const blocked = mkTask({ id: 3, title: "Waiter", parent_type: "project", parent_id: 1 });
    const root = buildTree([aspect], [], [blocker, blocked], [], [], [], [], [], [], [], [], [
      { task_id: 3, dependency_type: "task", dependency_id: 2 },
    ]);
    const node = root.children[0]?.children.find((c) => c.id === "task-3");
    expect(node?.virtualBlockers).toEqual(["Blocked by task 2 (Dep)"]);
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
    domains: [], goals: [], tasks: [], commitments: [], expectations: [], expectation_checks: [],
    spawned_waits: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_cycles: [], flow_dependencies: [],
    block_reasons: [], task_dependencies: [], flow_instance_nodes: [], lifecycles: [],
    habit_instance_children: [],
    habits: flows.map((flow) => ({
      flow_id: flow.id,
      flow_title: flow.title,
      result: { outcome: "loaded" as const, iterations: [], statuses: [] },
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

    habits = [{ flow_id: 7, flow_title: "Standup", result: { outcome: "loaded", iterations: [], statuses: [] } }];
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

    it("a habit occurrence takes its child through the attachment path, not a parent link", async () => {
      // The same gesture as anywhere else — Tab on the selected node — but the parent is virtual,
      // so there is no row id for `create_task` to hang it from.
      const flow = {
        id: 3, title: "Groceries", instance_type: "task" as const,
        parent_type: "domain", parent_id: 1, target_type: "goal", target_id: 1,
        flow_duration_n: 1, flow_duration_kind: "day",
        flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
        is_habit: true, root_plan_kind: null, root_plan_start: null, root_plan_end: null,
        verdict_window_n: null, verdict_window_kind: null, position: 0, is_private: false,
      };
      const envelope = mindmapEnvelope({
        domains: [ASPECT], goals: [GOAL], flows: [flow],
        habits: [{
          flow_id: 3,
          flow_title: "Groceries",
          result: {
            outcome: "loaded" as const,
            iterations: [{
              index: 0, anchor_scope_id: testKey(100), anchor_date: "2026-01-05",
              window_end: "2026-01-06T00:00:00", status: "active" as const, instances: [],
            }],
            statuses: [],
          },
        }],
      });
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "load_mindmap") return Promise.resolve(envelope);
        if (cmd === "create_habit_instance_child") {
          return Promise.resolve({ node_type: "task", node_id: 42 });
        }
        return Promise.resolve(null);
      });
      const { result } = await loadedHook();

      let returned: { id: string; kind: string } | undefined;
      await act(async () => {
        returned = await result.current.createNode("habit-3-0-virtual", "task", "task", "buy milk");
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("create_habit_instance_child", {
        flowId: 3,
        instance: { item_type: "flow_root", item_id: 3, iteration_scope_id: testKey(100), cycle_id: 0 },
        childType: "task",
        title: "buy milk",
      });
      expect(returned?.id).toBe("task-42");
      expect(returned?.kind).toBe("task");
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

  describe("retypeNode", () => {
    // Everything between the goals, tasks and domains tables is one atomic `retype_node` call.
    // These tests used to assert the create/reparent/delete sequence the hook issued by hand,
    // which meant they encoded the field, tag and dependency drops as expected behaviour rather
    // than catching them.
    it("goal→task: one retype_node call, and no create/delete of its own", async () => {
      setupInvoke({ retype_node: { kind: "task", id: 99 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("goal-1", "goal", "task"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "goal", nodeId: 1, targetType: "task", strandedChildren: null, timeScope: null,
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("create_task", expect.anything());
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_goal", expect.anything());
      expect(newId).toBe("task-99");
    });

    it("task→goal: one call, and the new goal's node id comes back", async () => {
      setupInvoke({ retype_node: { kind: "goal", id: 99 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("task-1", "task", "goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "task", nodeId: 1, targetType: "goal", strandedChildren: null, timeScope: null,
      });
      expect(newId).toBe("goal-99");
    });

    it("same-table project→domain: one call, and the id is unchanged", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], retype_node: { kind: "domain", id: 2 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "project", nodeId: 2, targetType: "domain", strandedChildren: null, timeScope: null,
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("update_domain", expect.anything());
      expect(newId).toBe("domain-2");
    });

    it("goal→project: a domain-table target comes back as a domain- node id", async () => {
      setupInvoke({ retype_node: { kind: "project", id: 99 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("goal-1", "goal", "project"); });

      expect(newId).toBe("domain-99");
    });

    it("passes the caller's choice for stranded children through as the acknowledgement", async () => {
      setupInvoke({ retype_node: { kind: "task", id: 99 } });
      const { result } = await loadedHook();

      await act(async () => {
        await result.current.retypeNode("goal-1", "goal", "task", { strandedChildren: "delete" });
      });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "goal", nodeId: 1, targetType: "task", strandedChildren: "delete", timeScope: null,
      });
    });

    it("lets a rejection through rather than swallowing it", async () => {
      setupInvoke({});
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "retype_node") {
          return Promise.reject({ kind: "needs_confirmation", message: "would lose 1 child", details: {} });
        }
        if (cmd === "load_mindmap") return Promise.resolve(mindmapEnvelope({ domains: [ASPECT], goals: [GOAL] }));
        return Promise.resolve(undefined);
      });
      const { result } = await loadedHook();

      await expect(result.current.retypeNode("goal-1", "goal", "task")).rejects.toMatchObject({
        kind: "needs_confirmation",
      });
    });

    it("returns null when the node has no parent (e.g. an aspect with no retype path)", async () => {
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      // aspect→goal is blocked because aspect has no meaningful parent in the domain table
      await act(async () => { newId = await result.current.retypeNode("domain-1", "aspect", "goal"); });

      expect(newId).toBeNull();
    });

    // Infos go through `retype_node` too. These three used to assert the hand-rolled
    // create/reparent/delete sequence, which encoded three defects as expected behaviour: the
    // `details` and `is_private` drop, the duplicate node left behind when the final delete
    // failed, and the mislabelled `parent_type` written for a node nested under an info.
    it("domain→info: one retype_node call, and no create/delete of its own", async () => {
      const PROJECT = mkDomain({ id: 2, subtype: "project", parent_id: 1, title: "Ops" });
      setupInvoke({ list_domains: [ASPECT, PROJECT], retype_node: { kind: "info", id: 10 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("domain-2", "project", "info"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "project", nodeId: 2, targetType: "info", strandedChildren: null, timeScope: null,
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("create_info", expect.anything());
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_domain", expect.anything());
      expect(newId).toBe("info-10");
    });

    it("info→goal: one call, and the new goal's node id comes back", async () => {
      const INFO = mkInfo({ id: 5, body: "My note", parent_type: "task", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], retype_node: { kind: "goal", id: 99 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("info-5", "info", "goal"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "info", nodeId: 5, targetType: "goal", strandedChildren: null, timeScope: null,
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("create_goal", expect.anything());
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("delete_info", expect.anything());
      expect(newId).toBe("goal-99");
    });

    it("info→domain: one call, and no separate position update", async () => {
      const INFO = mkInfo({ id: 5, body: "My note", parent_type: "task", parent_id: 1 });
      setupInvoke({ list_infos: [INFO], retype_node: { kind: "domain", id: 99 } });
      const { result } = await loadedHook();

      let newId: string | null | undefined;
      await act(async () => { newId = await result.current.retypeNode("info-5", "info", "domain"); });

      expect(vi.mocked(invoke)).toHaveBeenCalledWith("retype_node", {
        nodeType: "info", nodeId: 5, targetType: "domain", strandedChildren: null, timeScope: null,
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("create_domain", expect.anything());
      // The old path set `position` in a second call, so a crash between the two left the node
      // at position 0. There is no second call now.
      expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("update_domain", expect.anything());
      expect(newId).toBe("domain-99");
    });

    it("flow_goal→flow_task: converts via convert_flow_item", async () => {
      const FLOW = { id: 5, title: "Feature", instance_type: "task", parent_type: "aspect", parent_id: 1, target_type: null, target_id: null, flow_duration_n: null, flow_duration_kind: null, flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null, is_habit: false, root_plan_kind: null, root_plan_start: null, root_plan_end: null, position: 0 };
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

describe("injectHabitInstances", () => {
  function mkFlow(overrides: Partial<Flow> = {}): Flow {
    return {
      id: 3, title: "Exercise", instance_type: "task",
      parent_type: "domain", parent_id: 1,
      target_type: "goal", target_id: 5,
      flow_duration_n: 1, flow_duration_kind: "week",
      flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
      is_habit: false, root_plan_kind: null, root_plan_start: null, root_plan_end: null,
      verdict_window_n: null, verdict_window_kind: null, position: 0, is_private: false, ...overrides,
    };
  }
  function iter(
    index: number,
    status: HabitIteration["status"],
    instances: HabitInstance[] = [],
  ): HabitIteration {
    const day = index + 1;
    return {
      index,
      anchor_scope_id: testKey(100 + index),
      anchor_date: `2026-01-${String(day).padStart(2, "0")}`,
      // Day-long windows, so each one ends at the next midnight.
      window_end: `2026-01-${String(day + 1).padStart(2, "0")}T00:00:00`,
      status,
      instances,
    };
  }

  /** The reference instant the injection is read at — late enough that every `iter()` has passed. */
  const NOW = "2026-06-01T00:00:00";
  /** One occurrence of a flow item, unpaired and inside its window unless overridden. */
  function inst(
    itemType: FlowItemType,
    itemId: number,
    overrides: Partial<HabitInstance> = {},
  ): HabitInstance {
    return {
      item_type: itemType, item_id: itemId, cycle_id: NO_CYCLE,
      time_scope: null, plan: null, timing: "active", ...overrides,
    };
  }
  /** A stored status Modification for one occurrence. */
  function mod(
    itemType: HabitItemStatus["item_type"],
    itemId: number,
    scopeId: ScopeKey,
    status: string,
    cycleId: number = NO_CYCLE,
  ): HabitItemStatus {
    return { item_type: itemType, item_id: itemId, iteration_scope_id: scopeId, cycle_id: cycleId, status };
  }

  const LABELS = useScopeLabels();

  it("adds a virtual, read-only child per iteration under the flow's target", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    // The root of iteration 0 (scope 100) is completed; its own status drives the node's glyph.
    injectHabitInstances(
      root,
      [mkFlow()],
      [[iter(0, "done"), iter(1, "active"), iter(2, "lapsed")]],
      LABELS, NOW,
      [], [],
      [[mod("flow_root", 3, testKey(100), "done")]],
    );

    const target = root.children[0]?.children[0]; // aspect → goal 5
    expect(target?.id).toBe("goal-5");
    const virtuals = target?.children ?? [];
    expect(virtuals).toHaveLength(3);
    expect(virtuals.every((n) => n.virtual === true)).toBe(true);
    // The flow's Duration kind is "week" — the anchor renders as a formatted scope, not a raw date.
    expect(virtuals[0]?.title).toBe("Exercise W1");
    expect(virtuals[0]?.status).toBe("done"); // its root instance is completed
    expect(virtuals[0]?.habitItem).toEqual({ flowId: 3, itemType: "flow_root", itemId: 3, scopeId: testKey(100), cycleId: NO_CYCLE });
    expect(virtuals[1]?.status).toBe("todo"); // no root completion
    expect(virtuals[2]?.timing).toBe("lapsed"); // lapsed + uncompleted iterations are dimmed
    expect(virtuals[2]?.resolution).toBe("missed");
    expect(virtuals[2]?.archived).toBe(true);
    expect(virtuals[2]?.id).toBe("habit-3-2-virtual");
    // No row behind any of them, so `rowIdOf` refuses them — nothing DB-backed can be aimed at one.
    expect(virtuals.map((n) => n.rowId)).toEqual([undefined, undefined, undefined]);
  });

  it("tells each iteration node whether its window has passed, and how it ended", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    // iter(0) closed on the 2nd and iter(1) on the 3rd; "now" is the 2nd at noon, so only the
    // first has gone. Its root instance is completed, which is what makes it a Done in the tally.
    injectHabitInstances(
      root,
      [mkFlow()],
      [[iter(0, "done"), iter(1, "active")]],
      LABELS, "2026-01-02T12:00:00",
      [], [],
      [[mod("flow_root", 3, testKey(100), "done")]],
    );

    const virtuals = root.children[0]?.children[0]?.children ?? [];
    expect(virtuals[0]?.habitIteration).toEqual({
      flowId: 3, flowTitle: "Exercise", index: 0, scopeKind: "week", anchorDate: "2026-01-01",
      windowEnd: "2026-01-02T00:00:00", passed: true, done: true,
    });
    expect(virtuals[1]?.habitIteration?.passed).toBe(false);
  });

  it("counts a commitment iteration as done only once it was kept", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    injectHabitInstances(
      root,
      [mkFlow({ instance_type: "commitment" })],
      [[iter(0, "done"), iter(1, "done"), iter(2, "active")]],
      LABELS, NOW,
      [], [],
      [[mod("flow_root", 3, testKey(100), "kept"), mod("flow_root", 3, testKey(101), "broken")]],
    );

    const virtuals = root.children[0]?.children[0]?.children ?? [];
    expect(virtuals[0]?.habitIteration?.done).toBe(true);
    expect(virtuals[1]?.habitIteration?.done).toBe(false);
  });

  it("archives a commitment Habit's expired iteration without ever calling it missed", () => {
    // The Verdict Window ran out with no verdict recorded. The chance to say has gone, so the
    // iteration archives — but nothing concludes an outcome, which is the whole point of the kind:
    // an unjudged commitment may well have been kept.
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    injectHabitInstances(
      root,
      [mkFlow({ instance_type: "commitment", verdict_window_n: 2, verdict_window_kind: "day" })],
      [[iter(0, "expired"), iter(1, "active")]],
      LABELS, NOW,
    );

    const virtuals = root.children[0]?.children[0]?.children ?? [];
    expect(virtuals[0]?.archived).toBe(true);
    expect(virtuals[0]?.timing).toBe("lapsed");
    expect(virtuals[0]?.resolution).toBeUndefined();
    expect(virtuals[1]?.timing).toBe("active");
    expect(virtuals[1]?.archived).toBeUndefined();
  });

  it("falls back to the raw anchor date for a sub-day (Phase) window, which has no scope label", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    injectHabitInstances(root, [mkFlow({ flow_duration_kind: "exact" })], [[iter(0, "active")]], LABELS, NOW);
    const virtuals = root.children[0]?.children[0]?.children ?? [];
    expect(virtuals[0]?.title).toBe("Exercise 2026-01-01");
  });

  it("attaches iterations under a domain-table (project) target keyed domain-<id>", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: "#e74c3c", status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    injectHabitInstances(root, [mkFlow({ target_type: "project", target_id: 96 })], [[iter(0, "active")]], LABELS, NOW);

    const project = root.children[0]?.children[0]; // aspect → project 96
    expect(project?.id).toBe("domain-96");
    expect(project?.children).toHaveLength(1);
    expect(project?.children[0]?.virtual).toBe(true);
    expect(project?.children[0]?.color).toBe("#e74c3c"); // inherits the aspect colour like any node
  });

  // A flow with no explicit Target Node renders its iterations under its parent, derived here
  // rather than snapshotted into the row at creation — which is what makes a move carry them along.
  it("falls back to the flow's own parent when it has no Target Node", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "domain", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    injectHabitInstances(
      root,
      [mkFlow({ parent_type: "domain", parent_id: 96, target_type: null, target_id: null })],
      [[iter(0, "active")]],
      LABELS, NOW,
    );

    const parent = root.children[0]?.children[0]; // aspect → domain 96
    expect(parent?.id).toBe("domain-96");
    expect(parent?.children).toHaveLength(1);
    expect(parent?.children[0]?.virtual).toBe(true);
  });

  // Domains, projects and tags share one table, so a flow can carry `parent_type: "project"` for a
  // row the tree keys `domain-<id>`. Building the id from the stored type would miss it entirely.
  it("derives a domain-table parent through its normalised node id", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "domain", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    injectHabitInstances(
      root,
      [mkFlow({ parent_type: "project", parent_id: 96, target_type: null, target_id: null })],
      [[iter(0, "active")]],
      LABELS, NOW,
    );

    expect(root.children[0]?.children[0]?.children).toHaveLength(1);
  });

  // An explicit target is deliberate, so it wins over the parent — that is what "explicit" buys.
  it("prefers an explicit Target Node over the flow's parent", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "domain", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    injectHabitInstances(
      root,
      [mkFlow({ parent_type: "domain", parent_id: 96, target_type: "goal", target_id: 5 })],
      [[iter(0, "active")]],
      LABELS, NOW,
    );

    expect(root.children[0]?.children.find((n) => n.id === "domain-96")?.children).toHaveLength(0);
    expect(root.children[0]?.children.find((n) => n.id === "goal-5")?.children).toHaveLength(1);
  });

  // Last resort, not a meaning of null: the derived parent can be filtered out of the rendered tree,
  // and the iterations then hang off the flow node itself rather than vanishing.
  it("falls back to the flow node when the derived parent is not in the rendered tree", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [], [], [],
    );
    const aspect = root.children[0];
    aspect?.children.push({ id: "flow-3", kind: "flow", title: "Exercise", position: 0, tagIds: [], children: [] });

    injectHabitInstances(
      root,
      [mkFlow({ parent_type: "domain", parent_id: 404, target_type: null, target_id: null })],
      [[iter(0, "active")]],
      LABELS, NOW,
    );

    expect(aspect?.children[0]?.children).toHaveLength(1);
    expect(aspect?.children[0]?.children[0]?.virtual).toBe(true);
  });

  it("renders the flow's items as per-item-completable children of each iteration", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: "#0af", status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    const breakfast: FlowTask = { id: 4, flow_id: 3, title: "Breakfast", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
    const dinner: FlowTask = { id: 5, flow_id: 3, title: "Dinner", parent_type: "flow", parent_id: 3, position: 1, is_private: false };
    injectHabitInstances(
      root,
      [mkFlow({ target_type: "project", target_id: 96 })],
      [[iter(0, "active", [inst("flow_task", 4), inst("flow_task", 5)])]], // anchor_scope_id = 100
      LABELS, NOW,
      [],
      [breakfast, dinner],
      [[mod("flow_task", 4, testKey(100), "done")]], // breakfast done
    );

    const iteration = root.children[0]?.children[0]?.children[0]; // aspect → project → iteration root
    const items = iteration?.children ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Breakfast");
    expect(items[0]?.status).toBe("done"); // has a completion
    expect(items[0]?.color).toBe("#0af"); // inherits the aspect colour
    expect(items[0]?.id).toBe("habititem-flow_task-4-0-0-virtual");
    expect(items[0]?.rowId).toBeUndefined();
    expect(items[0]?.habitItem).toEqual({ flowId: 3, itemType: "flow_task", itemId: 4, scopeId: testKey(100), cycleId: NO_CYCLE });
    expect(items[1]?.title).toBe("Dinner");
    expect(items[1]?.status).toBe("todo"); // no completion
  });

  it("archives a past-window iteration's items regardless of done-ness (the original bug report)", () => {
    // Previously only the undone item lapsed; a done-but-past-window item (and the done root) never
    // archived at all, so e.g. a "לאכול ארוחות נורמליות" instance with 2/3 done meals stayed visible.
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    const breakfast: FlowTask = { id: 4, flow_id: 3, title: "Breakfast", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
    const dinner: FlowTask = { id: 5, flow_id: 3, title: "Dinner", parent_type: "flow", parent_id: 3, position: 1, is_private: false };
    injectHabitInstances(
      root,
      [mkFlow({ target_type: "project", target_id: 96 })],
      // anchor_scope_id = 100 — the whole iteration's window has passed, and its occurrences with it
      [[iter(0, "lapsed", [
        inst("flow_task", 4, { timing: "lapsed" }),
        inst("flow_task", 5, { timing: "lapsed" }),
      ])]],
      LABELS, NOW,
      [],
      [breakfast, dinner],
      [[mod("flow_task", 4, testKey(100), "done")]], // breakfast done, root+dinner not
    );

    const iterationRoot = root.children[0]?.children[0]?.children[0]; // aspect → project → iteration root
    expect(iterationRoot?.timing).toBe("lapsed");
    expect(iterationRoot?.resolution).toBe("missed"); // root itself was never completed
    expect(iterationRoot?.archived).toBe(true);

    const items = iterationRoot?.children ?? [];
    const breakfastNode = items.find((n) => n.title === "Breakfast");
    const dinnerNode = items.find((n) => n.title === "Dinner");
    expect(breakfastNode?.status).toBe("done");
    expect(breakfastNode?.resolution).toBe("completed"); // done AND past-window
    expect(breakfastNode?.archived).toBe(true); // archived even though completed, not missed
    expect(dinnerNode?.status).toBe("todo");
    expect(dinnerNode?.resolution).toBe("missed");
    expect(dinnerNode?.archived).toBe(true);
  });

  it("marks completed goal instances as achieved and open ones as active", () => {
    const root = buildTree(
      [
        { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        { id: 96, title: "LOOK", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
      ],
      [], [], [],
    );
    const done: FlowGoal = { id: 9, flow_id: 3, title: "Milestone", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
    const open: FlowGoal = { id: 10, flow_id: 3, title: "Stretch", parent_type: "flow", parent_id: 3, position: 1, is_private: false };
    injectHabitInstances(
      root,
      [mkFlow({ target_type: "project", target_id: 96, instance_type: "goal" })],
      [[iter(0, "active", [inst("flow_goal", 9), inst("flow_goal", 10)])]], // scope 100
      LABELS, NOW,
      [done, open],
      [],
      [[mod("flow_root", 3, testKey(100), "done"), mod("flow_goal", 9, testKey(100), "done")]],
    );

    const iteration = root.children[0]?.children[0]?.children[0]; // root goal instance
    expect(iteration?.kind).toBe("goal");
    expect(iteration?.status).toBe("achieved"); // root completed → achieved (not "done")
    const items = iteration?.children ?? [];
    expect(items.find((n) => n.title === "Milestone")?.status).toBe("achieved");
    expect(items.find((n) => n.title === "Stretch")?.status).toBe("active"); // open → active (not "todo")
  });

  it("nests a flow item under its parent item's instance for the same iteration", () => {
    const root = buildTree(
      [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
      [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
      [], [],
    );
    const routine: FlowGoal = { id: 7, flow_id: 3, title: "Routine", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
    const pushups: FlowTask = { id: 8, flow_id: 3, title: "Push-ups", parent_type: "flow_goal", parent_id: 7, position: 0, is_private: false };
    injectHabitInstances(
      root, [mkFlow()],
      [[iter(0, "active", [inst("flow_goal", 7), inst("flow_task", 8)])]],
      LABELS, NOW, [routine], [pushups], [],
    );

    const iteration = root.children[0]?.children[0]?.children[0]; // aspect → goal 5 → iteration root
    expect(iteration?.children).toHaveLength(1); // only the goal is a direct child
    const goalInstance = iteration?.children[0];
    expect(goalInstance?.title).toBe("Routine");
    expect(goalInstance?.children[0]?.title).toBe("Push-ups"); // nested under its parent instance
  });

  it("skips flows with no iterations, and flows whose target, parent and flow node are all absent", () => {
    const root = buildTree([], [], [], []);
    injectHabitInstances(root, [mkFlow(), mkFlow({ id: 9, target_type: null, target_id: null })], [[], [iter(0, "active")]], LABELS, NOW);
    expect(root.children).toHaveLength(0); // nowhere to hang them; nothing injected
  });

  describe("a flow item's Cycle Scope", () => {
    function projectRoot(): MindmapNode {
      return buildTree(
        [
          { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
          { id: 96, title: "Days", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        ],
        [], [], [],
      );
    }
    const DAILY = mkFlow({ target_type: "project", target_id: 96, flow_duration_kind: "day" });
    const stretch: FlowTask = { id: 4, flow_id: 3, title: "Stretch", parent_type: "flow", parent_id: 3, position: 0, is_private: false };

    function inject(iteration: HabitIteration, statuses: HabitItemStatus[] = []): MindmapNode | undefined {
      const root = projectRoot();
      injectHabitInstances(root, [DAILY], [[iteration]], LABELS, NOW, [], [stretch], [statuses]);
      return root.children[0]?.children[0]?.children[0];
    }

    it("reads Lapsed once its own window has passed, while the iteration is still Active", () => {
      // The bug: `timing` was hard-coded from the iteration, so a Morning item read Active all day.
      const iteration = inject(iter(0, "active", [
        inst("flow_task", 4, { cycle_id: 11, time_scope: { start_id: testKey(70), end_id: testKey(70) }, timing: "lapsed" }),
      ]));
      expect(iteration?.timing).toBe("active"); // the day has not passed
      const item = iteration?.children[0];
      expect(item?.timing).toBe("lapsed"); // but the morning has
      expect(item?.resolution).toBe("missed");
      expect(item?.archived).toBe(true);
      expect(item?.timeScope).toEqual({ start_id: testKey(70), end_id: testKey(70) }); // stamped like any other node's
    });

    it("stays Active inside its window even when the iteration around it is much longer", () => {
      const item = inject(iter(0, "active", [
        inst("flow_task", 4, { cycle_id: 11, time_scope: { start_id: testKey(70), end_id: testKey(70) } }),
      ]))?.children[0];
      expect(item?.timing).toBe("active");
      expect(item?.archived).not.toBe(true);
    });

    it("stamps an occurrence whose window has not opened yet as Pending", () => {
      // The bug: an unopened occurrence was dropped during generation, so no preset could show it
      // — All included. It is drawn now, and Pending is what says its window has not come.
      const iteration = inject(iter(0, "active", [
        inst("flow_task", 4, { cycle_id: 11, time_scope: { start_id: testKey(73), end_id: testKey(73) }, timing: "pending" }),
      ]));
      expect(iteration?.timing).toBe("active"); // the iteration itself is unaffected
      const item = iteration?.children[0];
      expect(item?.timing).toBe("pending");
      expect(item?.resolution).toBeUndefined(); // nothing has happened to it yet
      expect(item?.archived).not.toBe(true);
    });

    it("draws one node per cycle pair, each with its own window and its own status", () => {
      // SPEC: "a flow item with N pairs produces N items" — which starting the flow has always
      // obeyed and the virtual path did not.
      const iteration = inject(
        iter(0, "active", [
          inst("flow_task", 4, { cycle_id: 11, time_scope: { start_id: testKey(70), end_id: testKey(70) }, timing: "lapsed" }),
          inst("flow_task", 4, { cycle_id: 12, time_scope: { start_id: testKey(73), end_id: testKey(73) }, plan: { start_id: testKey(90), end_id: testKey(91) } }),
        ]),
        // Only the morning occurrence is done; the evening one is untouched.
        [mod("flow_task", 4, testKey(100), "done", 11)],
      );
      const items = iteration?.children ?? [];
      expect(items).toHaveLength(2);
      expect(items.map((n) => n.id)).toEqual([
        "habititem-flow_task-4-11-0-virtual",
        "habititem-flow_task-4-12-0-virtual",
      ]);
      expect(items[0]?.status).toBe("done");
      expect(items[0]?.habitItem?.cycleId).toBe(11);
      expect(items[1]?.status).toBe("todo"); // the evening one is still to do
      expect(items[1]?.habitItem?.cycleId).toBe(12);
      expect(items[1]?.timeScope).toEqual({ start_id: testKey(73), end_id: testKey(73) });
      expect(items[1]?.plan).toEqual({ start_id: testKey(90), end_id: testKey(91) });
    });

    it("nests a child item under its parent's first occurrence, and withholds it with the parent", () => {
      const routine: FlowGoal = { id: 7, flow_id: 3, title: "Routine", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
      const pushups: FlowTask = { id: 8, flow_id: 3, title: "Push-ups", parent_type: "flow_goal", parent_id: 7, position: 0, is_private: false };
      const root = projectRoot();
      injectHabitInstances(
        root,
        [mkFlow({ target_type: "project", target_id: 96, instance_type: "goal" })],
        [[iter(0, "active", [
          inst("flow_goal", 7, { cycle_id: 11 }),
          inst("flow_goal", 7, { cycle_id: 12 }),
          inst("flow_task", 8, { cycle_id: 13 }),
        ])]],
        LABELS, NOW, [routine], [pushups], [[]],
      );
      const iteration = root.children[0]?.children[0]?.children[0];
      expect(iteration?.children.map((n) => n.title)).toEqual(["Routine", "Routine"]);
      expect(iteration?.children[0]?.children.map((n) => n.title)).toEqual(["Push-ups"]);
      expect(iteration?.children[1]?.children).toHaveLength(0);

      // With the parent's window still shut, the step under it waits too rather than being hoisted.
      const withheld = projectRoot();
      injectHabitInstances(
        withheld,
        [mkFlow({ target_type: "project", target_id: 96, instance_type: "goal" })],
        [[iter(0, "active", [inst("flow_task", 8, { cycle_id: 13 })])]],
        LABELS, NOW, [routine], [pushups], [[]],
      );
      expect(withheld.children[0]?.children[0]?.children[0]?.children).toHaveLength(0);
    });
  });

  describe("added children", () => {
    /** An aspect holding the goal a flow targets, plus one real task parented on that goal. */
    function boardWithTask(): MindmapNode {
      return buildTree(
        [{ id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false }],
        [{ id: 5, title: "Fitness", parent_type: "domain", parent_id: 1, status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false }],
        [{ id: 12, title: "Buy milk", parent_type: "goal", parent_id: 5, status: "todo", time_scope: null, plan: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false, archival: "live", agentic: null, asynchronous: false, delegate_to: null }],
        [],
      );
    }

    function attachment(overrides: Partial<HabitInstanceChild> = {}): HabitInstanceChild {
      return {
        flow_id: 3, item_type: "flow_root", item_id: 3, iteration_scope_id: testKey(100),
        cycle_id: NO_CYCLE, child_type: "task", child_id: 12, ...overrides,
      };
    }

    it("moves an added child out of the host and under the occurrence it hangs on", () => {
      const root = boardWithTask();
      const target = root.children[0]?.children[0];
      expect(target?.children.map((n) => n.id)).toEqual(["task-12"]);

      injectHabitInstances(
        root, [mkFlow()], [[iter(0, "active"), iter(1, "active")]], LABELS, NOW,
        [], [], [[]], [attachment()],
      );

      const iterations = target?.children.filter((n) => n.virtual === true) ?? [];
      expect(iterations[0]?.children.map((n) => n.id)).toEqual(["task-12"]);
      expect(iterations[1]?.children).toHaveLength(0);
      expect(
        target?.children.some((n) => n.id === "task-12"),
        "the child is moved, not copied — it appears under the occurrence and nowhere else",
      ).toBe(false);
    });

    it("leaves the child a real, editable node rather than a virtual one", () => {
      const root = boardWithTask();
      injectHabitInstances(
        root, [mkFlow()], [[iter(0, "active")]], LABELS, NOW, [], [], [[]], [attachment()],
      );
      const child = root.children[0]?.children[0]?.children[0]?.children[0];
      expect(child?.id).toBe("task-12");
      expect(child?.virtual).toBeUndefined();
      expect(child?.habitItem).toBeUndefined();
    });

    it("hangs a child on the one occurrence named, cycle pair and all", () => {
      const root = boardWithTask();
      injectHabitInstances(
        root,
        [mkFlow()],
        [[iter(0, "active", [inst("flow_task", 4, { cycle_id: 7 }), inst("flow_task", 4, { cycle_id: 8 })])]],
        LABELS, NOW,
        [],
        [{ id: 4, flow_id: 3, title: "Stretch", parent_type: "flow", parent_id: 3, position: 0, is_private: false }],
        [[]],
        [attachment({ item_type: "flow_task", item_id: 4, cycle_id: 8 })],
      );
      const occurrences = root.children[0]?.children[0]?.children[0]?.children ?? [];
      expect(occurrences).toHaveLength(2);
      expect(occurrences[0]?.children).toHaveLength(0);
      expect(occurrences[1]?.children.map((n) => n.id)).toEqual(["task-12"]);
    });

    it("skips an attachment whose node is not in the tree rather than inventing one", () => {
      const root = boardWithTask();
      injectHabitInstances(
        root, [mkFlow()], [[iter(0, "active")]], LABELS, NOW, [], [], [[]],
        [attachment({ child_id: 999 })],
      );
      expect(root.children[0]?.children[0]?.children[0]?.children).toHaveLength(0);
    });
  });

  describe("a commitment habit's iterations", () => {
    function commitmentRoot(): MindmapNode {
      return buildTree(
        [
          { id: 1, title: "Aspect", description: null, subtype: "aspect", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
          { id: 96, title: "Nights", description: null, subtype: "project", parent_id: 1, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false },
        ],
        [], [], [],
      );
    }
    const NIGHTLY = mkFlow({ title: "Asleep by 23:00", instance_type: "commitment", target_type: "project", target_id: 96, flow_duration_kind: "day" });
    function inject(
      root: MindmapNode,
      iterations: HabitIteration[],
      statuses: HabitItemStatus[] = [],
      items: { goals?: FlowGoal[]; tasks?: FlowTask[] } = {},
    ): MindmapNode | undefined {
      injectHabitInstances(root, [NIGHTLY], [iterations], LABELS, NOW, items.goals ?? [], items.tasks ?? [], [statuses]);
      return root.children[0]?.children[0]?.children[0];
    }

    it("draws the iteration root as a Commitment, not as a task or a goal", () => {
      const iteration = inject(commitmentRoot(), [iter(0, "active")]);
      expect(iteration?.kind).toBe("commitment");
      // No status at all: a Commitment resolves to a Verdict, so there is nothing to cycle.
      expect(iteration?.status).toBeUndefined();
      expect(iteration?.verdict).toBe("unresolved");
    });

    it("reads this iteration's verdict off the slot its Modification stores it in", () => {
      const kept = inject(commitmentRoot(), [iter(0, "active")], [mod("flow_root", 3, testKey(100), "kept")]);
      expect(kept?.verdict).toBe("kept");
      const broken = inject(commitmentRoot(), [iter(0, "active")], [mod("flow_root", 3, testKey(100), "broken")]);
      expect(broken?.verdict).toBe("broken");
    });

    it("never reads a task status as a verdict", () => {
      // `done` is not `kept`. A stale row from before the flow became a commitment habit reads as
      // what it is — nothing said — rather than being translated into a judgement nobody made.
      const iteration = inject(commitmentRoot(), [iter(0, "active")], [mod("flow_root", 3, testKey(100), "done")]);
      expect(iteration?.verdict).toBe("unresolved");
    });

    it("leaves a past unjudged iteration live and unmissed — nothing concludes a commitment was broken", () => {
      const iteration = inject(commitmentRoot(), [iter(0, "lapsed")]);
      expect(iteration?.timing).toBe("lapsed");
      expect(iteration?.resolution).toBeUndefined(); // a Commitment has no Resolution to derive
      expect(iteration?.archived).not.toBe(true); // the answer is still owed
    });

    it("archives an unjudged iteration once its Verdict Window has run out, still unresolved", () => {
      // Where "the answer is still owed" stops being true. The backend derives `expired` from the
      // Habit's own Verdict Window, and it wins over the past-and-unjudged rule above — but it
      // still derives no Resolution and does not touch the Verdict: not having judged something
      // is part of the record, and it is never a Missed.
      const iteration = inject(commitmentRoot(), [iter(0, "expired")]);
      expect(iteration?.archived).toBe(true);
      expect(iteration?.timing).toBe("lapsed");
      expect(iteration?.resolution).toBeUndefined();
      expect(iteration?.verdict).toBe("unresolved");
    });

    it("archives the steps under an expired iteration with it, and calls none of them missed", () => {
      // An expired iteration is not `past` — under the Accumulating + Overlapping Consumption a
      // commitment Habit is fixed to, an unanswered iteration classifies Active until it expires —
      // so its steps would otherwise read as live work under an archived rule.
      const charger: FlowTask = { id: 4, flow_id: 3, title: "Phone on charger", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
      const iteration = inject(commitmentRoot(), [iter(0, "expired", [inst("flow_task", 4)])], [], { tasks: [charger] });
      const item = iteration?.children[0];
      expect(item?.archived).toBe(true);
      expect(item?.resolution).toBeUndefined();
    });

    it("archives a past iteration once its verdict is in — that one is settled", () => {
      const iteration = inject(commitmentRoot(), [iter(0, "lapsed")], [mod("flow_root", 3, testKey(100), "broken")]);
      expect(iteration?.archived).toBe(true);
      expect(iteration?.verdict).toBe("broken");
    });

    it("carries the flow's task items as ordinary tasks beneath it", () => {
      const charger: FlowTask = { id: 4, flow_id: 3, title: "Phone on charger", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
      const iteration = inject(commitmentRoot(), [iter(0, "active", [inst("flow_task", 4)])], [], { tasks: [charger] });
      const item = iteration?.children[0];
      expect(item?.kind).toBe("task"); // a Commitment holds Tasks — the supporting steps
      expect(item?.status).toBe("todo");
      expect(item?.verdict).toBeUndefined(); // only the commitment itself carries one
    });


    it("draws no iterations at all for a template holding a goal item, which a Commitment cannot hold", () => {
      const milestone: FlowGoal = { id: 9, flow_id: 3, title: "Milestone", parent_type: "flow", parent_id: 3, position: 0, is_private: false };
      const root = commitmentRoot();
      injectHabitInstances(root, [NIGHTLY], [[iter(0, "active", [inst("flow_goal", 9)])]], LABELS, NOW, [milestone], [], [[]]);
      expect(root.children[0]?.children[0]?.children).toHaveLength(0);
    });
  });
});
