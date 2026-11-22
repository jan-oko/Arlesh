import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { BoardChange } from "@/api/board";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useStatusCycle } from "@/hooks/use-status-cycle";
import type { MindmapNode } from "@/utils/tree-layout";
import { useMindmapData } from "./use-mindmap-data";
import { currentBoard } from "@/test/current-board";
import { storedRowId } from "@/test/stored-id";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// The change stream, held by the test: `emit` is the server's `board-changed` as the shell relays it.
const listeners = new Set<(change: BoardChange | null) => void>();
function emit(change: BoardChange | null): void {
  for (const listener of [...listeners]) listener(change);
}
vi.mock("@/api/board", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/board")>()),
  onBoardChanged: vi.fn((handler: (change: BoardChange | null) => void) => {
    listeners.add(handler);
    return Promise.resolve(() => { listeners.delete(handler); });
  }),
}));

const SCOPE_LABELS = {
  unscoped: "Unscoped", unplanned: "Unplanned", week: (n: number) => `W${n}`, month: () => "M",
  season: (name: string) => name, duration: (count: number, kind: string) => `${count} ${kind}`,
};
vi.mock("@/hooks/use-scope-labels", () => ({ useScopeLabels: () => SCOPE_LABELS }));

// One Aspect, a Goal and a Task to rename.
function mkDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: storedRowId(1), title: "Domain", description: null, subtype: "aspect",
    parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false,
    ...overrides,
  };
}

function mkGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: storedRowId(1), title: "Goal", parent_type: "domain", parent_id: storedRowId(1),
    status: "active", time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false,
    ...overrides,
  };
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: storedRowId(1), title: "Task", parent_type: "goal", parent_id: storedRowId(1),
    status: { kind: "ordinary", status: "todo" }, delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null, plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
    ...overrides,
  };
}

const ROWS = {
  domains: [mkDomain({ id: storedRowId(1), subtype: "aspect", title: "Work" })],
  goals: [mkGoal({ id: storedRowId(1), parent_type: "domain", parent_id: storedRowId(1) })],
  tasks: [mkTask({ id: storedRowId(1), parent_type: "goal", parent_id: storedRowId(1), title: "Write code" })],
};




function find(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = find(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The server: every Task it holds, and the writes it was sent, in order. */
let serverTasks: Task[];
let calls: Array<[string, unknown]>;
let refuseCreate: string | null;
let nextId: number;
/** The writes the server has committed: its revision, and the publication the board is at. */
let revision: number;
let seq: number;
const EPOCH = "run1";

/** The server publishes what it has committed: the window is told to take the board in. */
async function published(): Promise<void> {
  await act(async () => { emit({ epoch: EPOCH, seq, revision, reload: true }); });
}

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
  useMindmapStore.setState({ selectedNodeId: null, selectedNodeIds: new Set(), collapsedNodeIds: new Set(), pendingToast: null });
  serverTasks = [];
  calls = [];
  refuseCreate = null;
  nextId = 10;
  revision = 0;
  seq = 1;
  listeners.clear();
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command === "load_mindmap") return Promise.resolve(currentBoard(board(), { epoch: EPOCH, seq, revision }));
    if (command === "board_fence") return Promise.resolve({ epoch: EPOCH, revision });
    calls.push([command, args]);
    if (["create_task", "update_task", "step_task_status"].includes(command)) { revision += 1; seq += 1; }
    if (command === "create_task") return createTask(args);
    if (command === "step_task_status") {
      const { id } = args as { id: string };
      const task = serverTasks.find((t) => t.id === id);
      if (task === undefined) return Promise.reject({ kind: "not_found", message: "no such task" });
      task.status = { kind: "ordinary", status: "in_progress" };
      return Promise.resolve({ outcome: "written", task, backlog_cleared: null });
    }
    if (command === "update_task") {
      const { id, request } = args as { id: string; request: { title: string } };
      const task = serverTasks.find((t) => t.id === id);
      if (task !== undefined) task.title = request.title;
      return Promise.resolve(task ?? mkTask({ id }));
    }
    return Promise.resolve(null);
  });
});

function createTask(args: unknown): Promise<Task> {
  if (refuseCreate !== null) return Promise.reject({ kind: "invalid", message: refuseCreate });
  const request = (args as { request: { title: string; parent_type: string; parent_id: string } }).request;
  nextId += 1;
  const task = mkTask({ id: storedRowId(nextId), title: request.title, parent_type: request.parent_type as Task["parent_type"], parent_id: request.parent_id });
  serverTasks.push(task);
  return Promise.resolve(task);
}

async function mounted() {
  const hook = renderHook(() => useMindmapData());
  await waitFor(() => expect(find(hook.result.current.tree, `task-${storedRowId(1)}`)).toBeDefined());
  return hook;
}

const names = () => calls.map(([command]) => command).filter((command) => command.endsWith("_task"));

/** One create: the server commits it and publishes, and the call resolves once the window holds the node. */
async function create(
  result: { current: ReturnType<typeof useMindmapData> },
  parentId: string, parentKind: "goal" | "task", title: string,
): Promise<MindmapNode> {
  const before = calls.length;
  const pending = result.current.createNode(parentId, parentKind, "task", title);
  await waitFor(() => expect(calls.length).toBeGreaterThan(before));
  await published();
  return pending;
}

describe("creating is one awaited call", () => {
  it("answers with the real node, and the board holds it once the call resolves", async () => {
    const { result } = await mounted();

    const created = await create(result, `goal-${storedRowId(1)}`, "goal", "Buy milk");

    expect(created.id).toBe(`task-${storedRowId(11)}`);
    expect(created.rowId).toBe(storedRowId(11));
    expect(find(result.current.tree, created.id)).toMatchObject({ title: "Buy milk" });
    expect(find(result.current.tree, created.id)).not.toHaveProperty("pending");
  });

  it("names the real id of a new node to the next write: a rename, then a child under it", async () => {
    const { result } = await mounted();

    const first = await create(result, `goal-${storedRowId(1)}`, "goal", "");
    await act(async () => { await result.current.renameNode(first.id, "task", "Buy milk"); });
    await published();
    const second = await create(result, first.id, "task", "");

    expect(calls.filter(([command]) => command.endsWith("_task"))).toEqual([
      ["create_task", { request: { title: "", parent_type: "goal", parent_id: storedRowId(1) } }],
      ["update_task", { id: storedRowId(11), request: { title: "Buy milk" } }],
      ["create_task", { request: { title: "", parent_type: "task", parent_id: storedRowId(11) } }],
    ]);
    expect(second.id).toBe(`task-${storedRowId(12)}`);
    expect(find(result.current.tree, first.id)?.children.map((c) => c.id)).toEqual([second.id]);
  });

  it("lets the caller select the new node at once: the board already holds it", async () => {
    const { result } = await mounted();

    const created = await create(result, `goal-${storedRowId(1)}`, "goal", "");
    act(() => { useMindmapStore.getState().selectNode(created.id); });

    expect(useMindmapStore.getState().selectedNodeId).toBe(`task-${storedRowId(11)}`);
    expect(find(result.current.tree, useMindmapStore.getState().selectedNodeId ?? "")).toBeDefined();
  });

  it("a refused create rejects, changes nothing on the board and sends nothing more", async () => {
    const { result } = await mounted();
    refuseCreate = "No window above";

    await expect(act(async () => { await result.current.createNode(`goal-${storedRowId(1)}`, "goal", "task", ""); }))
      .rejects.toMatchObject({ message: "No window above" });

    expect(names()).toEqual(["create_task"]);
    expect(find(result.current.tree, `goal-${storedRowId(1)}`)?.children.map((c) => c.id)).toEqual([`task-${storedRowId(1)}`]);
  });

  it("refuses a kind the parent may not hold before anything is sent", async () => {
    const { result } = await mounted();
    await expect(result.current.createNode(`task-${storedRowId(1)}`, "task", "domain", "x")).rejects.toThrow();
    expect(names()).toEqual([]);
  });

  it("a status step on a new node is sent with the real row", async () => {
    const { result } = await mounted();
    const created = await create(result, `goal-${storedRowId(1)}`, "goal", "");
    const cycle = renderHook(() => useStatusCycle({ findNode: (nodeId) => find(result.current.tree, nodeId), showToast: vi.fn() }));

    act(() => { cycle.result.current.cycleStatus(created.id); });

    await waitFor(() => expect(calls.filter(([command]) => command === "step_task_status")).toEqual([
      ["step_task_status", { id: storedRowId(11), step: "advance", confirmed: undefined }],
    ]));
  });
});
