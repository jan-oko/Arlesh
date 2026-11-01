import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { useBoardRevisionStore } from "@/stores/board-revision-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
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



const EPOCH = "run1";

/** The board as the server serves it, with the Task titled `title`, read at `revision`. */
function board(title: string, revision: number | undefined): MindmapLoad {
  return {
    ...(revision === undefined ? {} : { revision: { epoch: EPOCH, revision } }),
    ...ROWS,
    tasks: [mkTask({ id: 1, parent_type: "goal", parent_id: 1, title })],
    commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [],
    flow_dependencies: [], block_reasons: [], task_dependencies: [], flow_instance_nodes: [],
    lifecycles: [], habits: [],
  };
}

function find(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = find(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

const store = () => usePendingWritesStore.getState();

/** A send held open until the test answers it. */
function heldSend() {
  let answer: (response: { epoch: string | null; revision: number | null }) => void = () => undefined;
  const send = () => new Promise<{ outcome: "written"; response: { epoch: string | null; revision: number | null; fields: null; createdId: null } }>((resolve) => {
    answer = (response) => resolve({ outcome: "written", response: { ...response, fields: null, createdId: null } });
  });
  return { send, answer: (response: { epoch: string | null; revision: number | null }) => answer(response) };
}

function enqueueRename(title: string, send: () => ReturnType<ReturnType<typeof heldSend>["send"]>) {
  store().enqueue({
    nodeId: "task-1", label: "rename", patch: { kind: "fields", fields: { title } },
    send, showToast: vi.fn(), unreachableMessage: "unreachable",
  });
}

let fetches: number;
let served: () => MindmapLoad;

beforeEach(() => {
  vi.clearAllMocks();
  store().reset();
  useBoardRevisionStore.setState({ held: null, inFlight: 0 });
  fetches = 0;
  served = () => board("Write code", 5);
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "load_mindmap") {
      fetches += 1;
      return Promise.resolve(served());
    }
    return Promise.resolve(null);
  });
});

async function mounted() {
  const hook = renderHook(() => useMindmapData());
  await waitFor(() => expect(find(hook.result.current.tree, "task-1")).toBeDefined());
  return hook;
}

describe("useMindmapData with pending writes", () => {
  it("draws an unanswered patch over a fresh board", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed", pending: true });

    await act(() => result.current.reload());
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed", pending: true });
  });

  it("reloads once on an answer the board does not reflect, and then shows the server's board", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    const before = fetches;
    served = () => board("Renamed", 6);
    await act(async () => held.answer({ epoch: EPOCH, revision: 6 }));
    await waitFor(() => expect(store().writes).toHaveLength(0));
    expect(fetches).toBe(before + 1);
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed" });
    expect(find(result.current.tree, "task-1")?.pending).toBeUndefined();
  });

  it("does not reload for an answer the board on screen already reflects", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    const before = fetches;
    await act(async () => held.answer({ epoch: EPOCH, revision: 5 }));
    await waitFor(() => expect(store().writes).toHaveLength(0));
    expect(fetches).toBe(before);
    expect(find(result.current.tree, "task-1")?.title).toBe("Write code");
  });

  it("coalesces the reloads that several answers ask for", async () => {
    const { result } = await mounted();
    const first = heldSend();
    const second = heldSend();
    act(() => { enqueueRename("One", first.send); enqueueRename("Two", second.send); });
    const before = fetches;
    served = () => board("Two", 8);
    await act(async () => first.answer({ epoch: EPOCH, revision: 7 }));
    await act(async () => second.answer({ epoch: EPOCH, revision: 8 }));
    await waitFor(() => expect(store().writes).toHaveLength(0));
    expect(fetches - before).toBeLessThanOrEqual(2);
    expect(find(result.current.tree, "task-1")?.title).toBe("Two");
  });

  it("discards an older read that returns after a newer one", async () => {
    const { result } = await mounted();
    let release: (load: MindmapLoad) => void = () => undefined;
    const slow = new Promise<MindmapLoad>((resolve) => { release = resolve; });
    vi.mocked(invoke).mockImplementationOnce(() => slow);
    let older: Promise<void> = Promise.resolve();
    act(() => { older = result.current.reload(); });
    served = () => board("Newer", 7);
    await act(() => result.current.reload());
    expect(find(result.current.tree, "task-1")?.title).toBe("Newer");
    await act(async () => { release(board("Older", 6)); await older; });
    expect(find(result.current.tree, "task-1")?.title).toBe("Newer");
  });
});
