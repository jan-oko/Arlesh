import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { BoardChange } from "@/api/board";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { currentBoard } from "@/test/current-board";
import { applyBoardChanges, indexBoard } from "@/utils/board-changes";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { MindmapNode } from "@/utils/tree-layout";
import { useMindmapData } from "./use-mindmap-data";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// The change stream, held by the test: `emit` is a `board-changed` as the shell relays it.
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

/** The board as the server publishes it, with the Task titled `title`. */
function board(title: string): MindmapLoad {
  return {
    ...ROWS,
    tasks: [mkTask({ id: 1, parent_type: "goal", parent_id: 1, title })],
    commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [],
    flow_dependencies: [], block_reasons: [], task_dependencies: [], flow_instance_nodes: [],
    lifecycles: [], habits: [],
  };
}

/** What the server says when the Task is renamed: publication `seq`, at `revision`, with the hash it carries. */
function renamed(title: string, seq: number, revision: number): BoardChange {
  const changes = { tasks: { set: [["task-1", mkTask({ id: 1, parent_type: "goal", parent_id: 1, title })] as const], del: [] } };
  const after = applyBoardChanges(indexBoard(board("Write code")), changes);
  return { epoch: EPOCH, seq, revision, now: "2026-11-13T12:00:00", hash: after.digests.total, changes };
}

/** An event as a server sends it before it carries a hash, so a window has nothing to compare. */
function withoutHash(change: BoardChange): BoardChange {
  const { epoch, seq, revision, now, changes } = change;
  return { epoch, revision, ...(seq === undefined ? {} : { seq }), ...(now === undefined ? {} : { now }), ...(changes === undefined ? {} : { changes }) };
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
let fence: { epoch: string; revision: number } | null;

beforeEach(() => {
  vi.clearAllMocks();
  store().reset();
  listeners.clear();
  fetches = 0;
  fence = null;
  served = () => board("Write code");
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "load_mindmap") {
      fetches += 1;
      return Promise.resolve(currentBoard(served(), { epoch: EPOCH, seq: 1, revision: 5 }));
    }
    if (command === "board_fence") return Promise.resolve(fence);
    return Promise.resolve(null);
  });
});

async function mounted() {
  const seen: Array<string | undefined> = [];
  const hook = renderHook(() => {
    const data = useMindmapData();
    seen.push(find(data.tree, "task-1")?.title);
    return data;
  });
  await waitFor(() => expect(find(hook.result.current.tree, "task-1")).toBeDefined());
  return { ...hook, seen };
}

describe("useMindmapData with pending writes", () => {
  it("draws an unanswered patch over a fresh board", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed", pending: true });

    fence = { epoch: EPOCH, revision: 5 };
    await act(() => result.current.settle());
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed", pending: true });
  });

  it("makes no second load for a write: the event brings the server's value and the patch goes in the same update", async () => {
    const { result, seen } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    const before = fetches;
    fence = { epoch: EPOCH, revision: 6 };
    await act(async () => held.answer({ epoch: null, revision: null }));
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed" });
    expect(store().writes).toHaveLength(1);

    seen.length = 0;
    act(() => emit(renamed("Renamed", 2, 6)));

    expect(store().writes).toHaveLength(0);
    expect(fetches).toBe(before);
    expect(find(result.current.tree, "task-1")).toMatchObject({ title: "Renamed" });
    expect(find(result.current.tree, "task-1")?.pending).toBeUndefined();
    // No flicker: the board never drew the old title between the patch and the server's value.
    expect(seen.every((title) => title === "Renamed")).toBe(true);
  });

  it("settles on the event for the write's revision, and a load is never made for it", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    fence = { epoch: EPOCH, revision: 6 };
    await act(async () => held.answer({ epoch: null, revision: null }));
    const before = fetches;

    let done = false;
    act(() => { void result.current.settle().then(() => { done = true; }); });
    await act(async () => { await Promise.resolve(); });
    expect(done).toBe(false);
    act(() => emit(renamed("Renamed", 2, 6)));
    await waitFor(() => expect(done).toBe(true));

    expect(fetches).toBe(before);
  });

  it("does not wait for an answer the board on screen already reflects", async () => {
    const { result } = await mounted();
    const held = heldSend();
    act(() => enqueueRename("Renamed", held.send));
    const before = fetches;
    fence = { epoch: EPOCH, revision: 5 };
    await act(async () => held.answer({ epoch: null, revision: null }));
    await waitFor(() => expect(store().writes).toHaveLength(0));
    expect(fetches).toBe(before);
    expect(find(result.current.tree, "task-1")?.title).toBe("Write code");
  });

  it("keeps the patches of two answered writes until the board reaches each one's revision", async () => {
    const { result } = await mounted();
    const first = heldSend();
    const second = heldSend();
    act(() => { enqueueRename("One", first.send); enqueueRename("Two", second.send); });
    fence = { epoch: EPOCH, revision: 6 };
    await act(async () => first.answer({ epoch: null, revision: null }));
    fence = { epoch: EPOCH, revision: 7 };
    await act(async () => second.answer({ epoch: null, revision: null }));
    expect(store().writes).toHaveLength(2);

    act(() => emit(renamed("One", 2, 6)));
    expect(store().writes).toHaveLength(1);
    act(() => emit(withoutHash(renamed("Two", 3, 7))));

    expect(store().writes).toHaveLength(0);
    expect(find(result.current.tree, "task-1")?.title).toBe("Two");
  });

  it("never lets an older read land after a newer one: a settle asked during a read waits for it", async () => {
    const { result } = await mounted();
    let release: (load: MindmapLoad) => void = () => undefined;
    const slow = new Promise<MindmapLoad>((resolve) => { release = resolve; });
    let slowOnce = true;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "load_mindmap") {
        if (slowOnce) {
          slowOnce = false;
          return slow.then((load) => currentBoard(load));
        }
        return Promise.resolve(currentBoard(served()));
      }
      return Promise.resolve(null);
    });
    let older: Promise<void> = Promise.resolve();
    let newer: Promise<void> = Promise.resolve();
    act(() => { older = result.current.settle(); });
    served = () => board("Newer");
    act(() => { newer = result.current.settle(); });
    await act(async () => { release(board("Older")); await Promise.all([older, newer]); });
    expect(find(result.current.tree, "task-1")?.title).toBe("Newer");
  });
});
