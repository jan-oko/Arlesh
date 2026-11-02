import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { useBoardRevisionStore } from "@/stores/board-revision-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useStatusCycle } from "@/hooks/use-status-cycle";
import { settleLane } from "@/test/lane-helpers";
import type { MindmapNode } from "@/utils/tree-layout";
import { useMindmapData } from "./use-mindmap-data";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/api/board", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/board")>()),
  onBoardChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));

const SCOPE_LABELS = {
  unscoped: "Unscoped", unplanned: "Unplanned", week: (n: number) => `W${n}`, month: () => "M",
  season: (name: string) => name, duration: (count: number, kind: string) => `${count} ${kind}`,
};
vi.mock("@/hooks/use-scope-labels", () => ({ useScopeLabels: () => SCOPE_LABELS }));

// One Aspect, a Goal and a Task to rename.
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
    status: { kind: "ordinary", status: "todo" }, delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
    ...overrides,
  };
}

const ROWS = {
  domains: [mkDomain({ id: 1, subtype: "aspect", title: "Work" })],
  goals: [mkGoal({ id: 1, parent_type: "domain", parent_id: 1 })],
  tasks: [mkTask({ id: 1, parent_type: "goal", parent_id: 1, title: "Write code" })],
};




function find(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = find(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

const store = () => usePendingWritesStore.getState();

/** The server: every Task it holds, and the writes it was sent, in order. */
let serverTasks: Task[];
let calls: Array<[string, unknown]>;
let refuseCreate: string | null;
let nextId: number;
/** While set, the server holds every create until the test opens the gate. */
let gate: Promise<void> | null;

function board(): MindmapLoad {
  return {
    ...ROWS,
    tasks: [...ROWS.tasks, ...serverTasks],
    commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [],
    flow_dependencies: [], block_reasons: [], task_dependencies: [], flow_instance_nodes: [],
    lifecycles: [], habits: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store().reset();
  useMindmapStore.setState({ selectedNodeId: null, selectedNodeIds: new Set(), collapsedNodeIds: new Set(), pendingToast: null });
  useBoardRevisionStore.setState({ held: null, inFlight: 0 });
  serverTasks = [];
  calls = [];
  refuseCreate = null;
  nextId = 10;
  gate = null;
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command === "load_mindmap") return Promise.resolve(board());
    calls.push([command, args]);
    if (command === "create_task") return (gate ?? Promise.resolve()).then(() => createTask(args));
    if (command === "step_task_status") {
      const { id } = args as { id: number };
      const task = serverTasks.find((t) => t.id === id);
      if (task === undefined) return Promise.reject({ kind: "not_found", message: "no such task" });
      task.status = { kind: "ordinary", status: "in_progress" };
      return Promise.resolve({ outcome: "written", task, backlog_cleared: null });
    }
    if (command === "update_task") {
      const { id, request } = args as { id: number; request: { title: string } };
      const task = serverTasks.find((t) => t.id === id);
      if (task !== undefined) task.title = request.title;
      return Promise.resolve(task ?? mkTask({ id }));
    }
    return Promise.resolve(null);
  });
});

function createTask(args: unknown): Promise<Task> {
  if (refuseCreate !== null) return Promise.reject({ kind: "invalid", message: refuseCreate });
  const request = (args as { request: { title: string; parent_type: string; parent_id: number } }).request;
  nextId += 1;
  const task = mkTask({ id: nextId, title: request.title, parent_type: request.parent_type as Task["parent_type"], parent_id: request.parent_id });
  serverTasks.push(task);
  return Promise.resolve(task);
}

async function mounted() {
  const hook = renderHook(() => useMindmapData());
  await waitFor(() => expect(find(hook.result.current.tree, "task-1")).toBeDefined());
  return hook;
}

const names = () => calls.map(([command]) => command).filter((command) => command.endsWith("_task"));

describe("creating through the lane", () => {
  it("Child, a title typed at once, then Child again: two nested placeholders, three writes in order, the real ids named", async () => {
    const { result } = await mounted();
    let open: () => void = () => undefined;
    gate = new Promise<void>((resolve) => { open = resolve; });
    let first: MindmapNode | undefined;
    let second: MindmapNode | undefined;
    await act(async () => {
      first = await result.current.createNode("goal-1", "goal", "task", "");
      await result.current.renameNode(first.id, "task", "Buy milk");
      second = await result.current.createNode(first.id, "task", "task", "");
    });
    if (first === undefined || second === undefined) throw new Error("no placeholders");
    expect(first.id).toMatch(/^tmp:/);
    const outer = find(result.current.tree, first.id);
    expect(outer).toMatchObject({ title: "Buy milk", pending: true });
    expect(outer?.children.map((c) => c.id)).toEqual([second.id]);

    expect(names()).toEqual(["create_task"]);
    open();
    await settleLane();
    await waitFor(() => expect(store().writes).toHaveLength(0));

    expect(calls.filter(([command]) => command.endsWith("_task"))).toEqual([
      ["create_task", { request: { title: "", parent_type: "goal", parent_id: 1 } }],
      ["update_task", { id: 11, request: { title: "Buy milk" } }],
      ["create_task", { request: { title: "", parent_type: "task", parent_id: 11 } }],
    ]);
    const board = result.current.tree;
    expect(find(board, "task-11")?.children.map((c) => c.id)).toEqual(["task-12"]);
    expect(find(board, "task-11")?.title).toBe("Buy milk");
    // No duplicate: the placeholders are gone, the real nodes are the only ones.
    expect(find(board, first.id)).toBeUndefined();
    expect(find(board, second.id)).toBeUndefined();
  });

  it("rewrites the selection and the collapsed nodes to the real id when the create is answered", async () => {
    const { result } = await mounted();
    let placeholder: MindmapNode | undefined;
    await act(async () => {
      placeholder = await result.current.createNode("goal-1", "goal", "task", "");
      useMindmapStore.getState().selectNode(placeholder.id);
      useMindmapStore.getState().toggleCollapsed(placeholder.id);
    });
    await settleLane();
    expect(useMindmapStore.getState().selectedNodeId).toBe("task-11");
    expect([...useMindmapStore.getState().selectedNodeIds]).toEqual(["task-11"]);
    expect([...useMindmapStore.getState().collapsedNodeIds]).toEqual(["task-11"]);
  });

  it("a refused create removes the placeholder and what hangs under it, sends nothing more, and toasts once", async () => {
    const { result } = await mounted();
    refuseCreate = "No window above";
    await act(async () => {
      const first = await result.current.createNode("goal-1", "goal", "task", "");
      await result.current.renameNode(first.id, "task", "Lost");
      await result.current.createNode(first.id, "task", "task", "");
    });
    await settleLane();

    expect(names()).toEqual(["create_task"]);
    expect(store().writes).toHaveLength(0);
    expect(find(result.current.tree, "goal-1")?.children.map((c) => c.id)).toEqual(["task-1"]);
    expect(useMindmapStore.getState().pendingToast).toMatchObject({ nodeId: "goal-1" });
  });

  it("an undo of a still-queued create takes the placeholder off and calls nothing", async () => {
    const { result } = await mounted();
    let release: () => void = () => undefined;
    store().enqueue({
      nodeId: "task-1", label: "rename", patch: { kind: "fields", fields: { title: "Held" } },
      send: () => new Promise((resolve) => {
        release = () => resolve({ outcome: "written", response: { epoch: null, revision: null, fields: null, createdId: null } });
      }),
      showToast: vi.fn(), unreachableMessage: "unreachable",
    });
    let placeholder: MindmapNode | undefined;
    await act(async () => { placeholder = await result.current.createNode("goal-1", "goal", "task", ""); });
    if (placeholder === undefined) throw new Error("no placeholder");
    expect(find(result.current.tree, placeholder.id)).toBeDefined();

    act(() => { store().cancelTail(); });
    expect(find(result.current.tree, placeholder.id)).toBeUndefined();
    await act(async () => { release(); await store().whenDrained(); });
    expect(names()).toEqual([]);
  });

  it("refuses a kind the parent may not hold before any patch", async () => {
    const { result } = await mounted();
    await expect(result.current.createNode("task-1", "task", "domain", "x")).rejects.toThrow();
    expect(store().writes).toHaveLength(0);
    expect(names()).toEqual([]);
  });

  it("a quick status step on a new node waits for its create and is sent with the real row", async () => {
    const { result } = await mounted();
    let open: () => void = () => undefined;
    gate = new Promise<void>((resolve) => { open = resolve; });
    let placeholder: MindmapNode | undefined;
    await act(async () => { placeholder = await result.current.createNode("goal-1", "goal", "task", ""); });
    if (placeholder === undefined) throw new Error("no placeholder");
    const id = placeholder.id;
    const cycle = renderHook(() => useStatusCycle({ findNode: (nodeId) => find(result.current.tree, nodeId), showToast: vi.fn() }));
    act(() => { cycle.result.current.cycleStatus(id); });
    expect(store().writes.map((write) => write.nodeId)).toEqual([id, id]);

    open();
    await settleLane();
    await waitFor(() => expect(store().writes).toHaveLength(0));
    expect(calls.filter(([command]) => command === "step_task_status")).toEqual([
      ["step_task_status", { id: 11, step: "advance", confirmed: undefined }],
    ]);
    expect(find(result.current.tree, "task-11")?.taskStatus).toEqual({ kind: "ordinary", status: "in_progress" });
  });
});
