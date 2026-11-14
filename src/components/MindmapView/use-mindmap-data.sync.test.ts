import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { BoardChange, BoardHead } from "@/api/board";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { SETTLE_TIMEOUT_MS } from "@/stores/use-board-store";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { HEAD_CHECK_MS, IDLE_HEAD_CHECK_MS } from "@/stores/watch-board-changes";
import { currentBoard } from "@/test/current-board";
import { indexBoard } from "@/utils/board-changes";
import { useMindmapData } from "./use-mindmap-data";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// The change stream, held by the test: `emit` is the server's `board-changed` as the shell relays it.
// The window listens once, however many views it has.
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

const EPOCH = "run1";

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

function emptyBoard(taskTitle = "Write code"): MindmapLoad {
  return {
    ...ROWS,
    tasks: [mkTask({ id: 1, parent_type: "goal", parent_id: 1, title: taskTitle })],
    commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [],
    flow_dependencies: [], block_reasons: [], task_dependencies: [], flow_instance_nodes: [],
    lifecycles: [], habits: [],
  };
}

/**
 * The producer the window is a client of, as far as the window can tell: it publishes boards with a
 * sequence number, a revision and a hash, answers `board_fence` and `board_head`, and counts the
 * boards it served whole.
 */
function fakeServer(published = true) {
  const server = {
    revision: 0, seq: 1, boardFetches: 0, epoch: EPOCH, taskTitle: "Write code",
    /** What `board_fence` answers: the newest revision a write reached. */
    fence: null as { epoch: string; revision: number } | null,
    /** Lies about the head's hash, to make the window disagree. */
    headHash: null as number | null,
    divergences: [] as unknown[],
    head: (): BoardHead => ({
      epoch: server.epoch, seq: server.seq, revision: server.revision,
      hash: server.headHash ?? indexBoard(emptyBoard(server.taskTitle)).digests.total, sums: {},
    }),
    /** A publication that renames the Task, as the event the stream sends for it. */
    publish(title: string, hash?: number): BoardChange {
      server.seq += 1;
      server.revision += 1;
      server.taskTitle = title;
      return {
        epoch: server.epoch, seq: server.seq, revision: server.revision, now: "2026-11-13T12:00:00",
        hash: hash ?? indexBoard(emptyBoard(title)).digests.total,
        changes: { tasks: { set: [["task-1", mkTask({ id: 1, parent_type: "goal", parent_id: 1, title })]], del: [] } },
      };
    },
  };
  vi.mocked(invoke).mockImplementation((command: string, args?: InvokeArgs) => {
    if (command === "load_mindmap") {
      server.boardFetches += 1;
      const load = emptyBoard(server.taskTitle);
      return Promise.resolve(
        published ? currentBoard(load, { epoch: server.epoch, seq: server.seq, revision: server.revision }) : currentBoard(load),
      );
    }
    if (command === "board_fence") return Promise.resolve(server.fence);
    if (command === "board_head") return Promise.resolve(server.head());
    if (command === "report_board_divergence") {
      server.divergences.push(args);
      return Promise.resolve(null);
    }
    if (command === "update_task") {
      server.revision += 1;
      server.taskTitle = "Renamed";
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
  return server;
}

/** Lets the timers the window runs (its checks of the head) elapse. */
async function elapse(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function taskTitle(hook: { result: { current: { tree: { children: Array<{ children: Array<{ children: Array<{ title: string }> }> }> } } } }): string {
  return hook.result.current.tree.children[0]?.children[0]?.children[0]?.title ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  listeners.clear();
  usePendingWritesStore.getState().reset();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function views(count: number) {
  const hooks = Array.from({ length: count }, () => renderHook(() => useMindmapData()));
  for (const hook of hooks) await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hooks;
}

describe("a write and the event it brings about", () => {
  it("makes no second load: the writer settles on the event for its revision", async () => {
    const server = fakeServer();
    const [hook] = await views(1);
    const before = server.boardFetches;

    let write: Promise<void> = Promise.resolve();
    act(() => { write = hook?.result.current.renameNode("task-1", "task", "Renamed") ?? Promise.resolve(); });
    await act(async () => { await write; });
    server.fence = { epoch: EPOCH, revision: 1 };
    let settled = false;
    act(() => { void hook?.result.current.settle().then(() => { settled = true; }); });
    await act(async () => { await Promise.resolve(); });
    expect(settled).toBe(false);

    act(() => emit(server.publish("Renamed")));
    await waitFor(() => expect(settled).toBe(true));

    expect(server.boardFetches).toBe(before);
    expect(hook === undefined ? "" : taskTitle(hook)).toBe("Renamed");
  });

  it("falls back to one full load, and says so, when the event never comes", async () => {
    const server = fakeServer();
    const [hook] = await views(1);
    const before = server.boardFetches;
    server.fence = { epoch: EPOCH, revision: 9 };

    let settled = false;
    act(() => { void hook?.result.current.settle().then(() => { settled = true; }); });
    await elapse(SETTLE_TIMEOUT_MS + 100);
    await waitFor(() => expect(settled).toBe(true));

    expect(server.boardFetches - before).toBe(1);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("another device's change", () => {
  it("applies from the event alone, to every view, with no load", async () => {
    const server = fakeServer();
    const hooks = await views(3);
    await waitFor(() => expect(listeners.size).toBe(1));
    const before = server.boardFetches;

    act(() => emit(server.publish("Changed elsewhere")));

    expect(server.boardFetches).toBe(before);
    expect(hooks.map(taskTitle)).toEqual(Array(3).fill("Changed elsewhere"));
  });

  it("is skipped when the window already holds its sequence number", async () => {
    const server = fakeServer();
    const [hook] = await views(1);
    const change = server.publish("Changed elsewhere");
    act(() => emit(change));
    const before = server.boardFetches;

    act(() => emit(change));

    expect(server.boardFetches).toBe(before);
    expect(hook === undefined ? "" : taskTitle(hook)).toBe("Changed elsewhere");
  });
});

describe("a dropped event is repaired", () => {
  it("loads the board when a sequence number is missed", async () => {
    const server = fakeServer();
    const [hook] = await views(1);
    const before = server.boardFetches;
    server.publish("Missed");

    act(() => emit(server.publish("Seen")));
    await waitFor(() => expect(server.boardFetches).toBe(before + 1));

    expect(hook === undefined ? "" : taskTitle(hook)).toBe("Seen");
  });

  it("loads the board when the server has restarted, whatever its sequence says", async () => {
    const server = fakeServer();
    server.seq = 9;
    const [hook] = await views(1);
    const before = server.boardFetches;

    server.epoch = "run2";
    server.seq = 1;
    server.taskTitle = "After restart";
    act(() => emit({ epoch: "run2", seq: 1, revision: 0 }));
    await waitFor(() => expect(server.boardFetches).toBe(before + 1));

    expect(hook === undefined ? "" : taskTitle(hook)).toBe("After restart");
  });

  it("loads the board for an event that says reload", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;
    server.seq += 1;

    act(() => emit({ epoch: EPOCH, seq: server.seq, revision: 0, reload: true }));
    await waitFor(() => expect(server.boardFetches).toBe(before + 1));
  });

  it("loads the board for an event with no sequence number, as an older server's", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;

    act(() => emit({ epoch: EPOCH, revision: 1 }));
    await waitFor(() => expect(server.boardFetches).toBe(before + 1));
    act(() => emit(null));
    await waitFor(() => expect(server.boardFetches).toBe(before + 2));
  });

  it("loads the board when the head has been ahead for two checks ten seconds apart", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;
    // The server published something this window was never sent.
    server.seq += 1;

    await elapse(HEAD_CHECK_MS);
    expect(server.boardFetches).toBe(before);
    await elapse(HEAD_CHECK_MS);

    expect(server.boardFetches).toBe(before + 1);
  });

  it("raises no alarm for a head one sequence ahead at one check and caught up by an event before the next", async () => {
    const server = fakeServer();
    const [hook] = await views(1);
    const before = server.boardFetches;
    // A tick publishes at a minute boundary: the head is ahead until the event arrives.
    const change = server.publish("Overdue now");
    await elapse(HEAD_CHECK_MS);
    act(() => emit(change));
    await elapse(HEAD_CHECK_MS);

    expect(server.boardFetches).toBe(before);
    expect(server.divergences).toEqual([]);
    expect(hook === undefined ? "" : taskTitle(hook)).toBe("Overdue now");
  });

  it("checks the head five seconds after the last event it applied", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;
    act(() => emit(server.publish("Seen")));
    server.epoch = "run2";

    await elapse(IDLE_HEAD_CHECK_MS + 100);

    await waitFor(() => expect(server.boardFetches).toBe(before + 1));
  });
});

describe("the board hash", () => {
  it("loads the board and reports a bug when the head says another hash at the same sequence number", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;
    server.headHash = 12345;

    await elapse(HEAD_CHECK_MS);

    await waitFor(() => expect(server.boardFetches).toBe(before + 1));
    expect(server.divergences).toHaveLength(1);
  });

  it("loads the board and reports a bug when an event's hash disagrees after it is applied", async () => {
    const server = fakeServer();
    await views(1);
    const before = server.boardFetches;

    act(() => emit(server.publish("Seen", 777)));
    await waitFor(() => expect(server.boardFetches).toBe(before + 1));

    expect(server.divergences).toHaveLength(1);
  });

  it("reports a disagreement right after a load once, and stops comparing hashes", async () => {
    const server = fakeServer();
    const load = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation((command: string, args?: InvokeArgs) => {
      if (command === "load_mindmap") {
        server.boardFetches += 1;
        return Promise.resolve({ ...currentBoard(emptyBoard(server.taskTitle), { epoch: EPOCH, seq: server.seq, revision: 0 }), hash: 1 });
      }
      return load?.(command, args) ?? Promise.resolve(null);
    });
    await views(1);
    expect(server.divergences).toHaveLength(1);
    const before = server.boardFetches;

    // The producer's hash is not the window's, for a reason no reload can mend: neither the head
    // nor an event may make a loop of it.
    server.headHash = 5;
    await elapse(HEAD_CHECK_MS);
    act(() => emit(server.publish("Seen", 6)));

    expect(server.boardFetches).toBe(before);
    expect(server.divergences).toHaveLength(1);
  });
});
