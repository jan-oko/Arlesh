import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { BoardRevision } from "@/api/board";
import type { Domain } from "@/api/domains";
import type { Goal } from "@/api/goals";
import type { MindmapLoad } from "@/api/mindmap";
import type { Task } from "@/api/tasks";
import { SETTLE_MS } from "@/hooks/use-board-changed";
import { useBoardRevisionStore } from "@/stores/board-revision-store";
import { useMindmapData } from "./use-mindmap-data";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// The change stream, held by the test: `emit` is the server's `board-changed` as the shell relays it.
let emit: (change: BoardRevision | null) => void = () => undefined;
vi.mock("@/api/board", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/board")>()),
  onBoardChanged: vi.fn((handler: (change: BoardRevision | null) => void) => {
    emit = handler;
    return Promise.resolve(() => undefined);
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

function emptyBoard(revision: BoardRevision | undefined): MindmapLoad {
  return {
    ...(revision === undefined ? {} : { revision }),
    ...ROWS,
    commitments: [], expectations: [], infos: [], flows: [],
    flow_goals: [], flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [],
    flow_dependencies: [], block_reasons: [], task_dependencies: [], flow_instance_nodes: [],
    lifecycles: [], habits: [],
  };
}

/**
 * A server the app is a client of: it counts writes, stamps each board it serves with the count
 * as it stood when the request arrived, and counts the boards it served.
 */
function fakeServer(stamped = true) {
  const server = { revision: 0, boardFetches: 0, epoch: EPOCH };
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "load_mindmap") {
      server.boardFetches += 1;
      const at = { epoch: server.epoch, revision: server.revision };
      return Promise.resolve(emptyBoard(stamped ? at : undefined));
    }
    if (command === "update_task") {
      server.revision += 1;
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
  return server;
}

async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(SETTLE_MS + 50); });
}

describe("a write and the server's echo of it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useBoardRevisionStore.setState({ held: null, inFlight: 0 });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function mounted(revision = 0) {
    const hook = renderHook(() => useMindmapData());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await waitFor(() => expect(useBoardRevisionStore.getState().held?.revision).toBe(revision));
    return hook;
  }

  it("costs one board fetch when the echo arrives after the write's own reload", async () => {
    const server = fakeServer();
    const { result } = await mounted();
    const before = server.boardFetches;

    await act(async () => { await result.current.renameNode("task-1", "task", "Renamed"); });
    emit({ epoch: EPOCH, revision: server.revision });
    await settle();

    expect(server.boardFetches - before).toBe(1);
  });

  it("costs one board fetch when the echo beats the write's response", async () => {
    const server = fakeServer();
    const { result } = await mounted();
    const before = server.boardFetches;

    // The server commits and the echo reaches the window before the write has answered.
    let write: Promise<void> = Promise.resolve();
    act(() => { write = result.current.renameNode("task-1", "task", "Renamed"); });
    emit({ epoch: EPOCH, revision: 1 });
    await act(async () => { await write; });
    await settle();

    expect(server.boardFetches - before).toBe(1);
  });

  it("still reloads for a change another device made", async () => {
    const server = fakeServer();
    await mounted();
    const before = server.boardFetches;

    server.revision += 1;
    emit({ epoch: EPOCH, revision: 1 });
    await settle();

    expect(server.boardFetches - before).toBe(1);
  });

  it("does not reload for a revision the board it holds already has", async () => {
    const server = fakeServer();
    server.revision = 4;
    await mounted(4);
    const before = server.boardFetches;

    emit({ epoch: EPOCH, revision: 3 });
    emit({ epoch: EPOCH, revision: 4 });
    await settle();

    expect(server.boardFetches - before).toBe(0);
  });

  it("always reloads when the server has restarted, whatever its revision says", async () => {
    const server = fakeServer();
    server.revision = 9;
    await mounted(9);
    const before = server.boardFetches;

    server.epoch = "run2";
    server.revision = 0;
    emit({ epoch: "run2", revision: 0 });
    await settle();

    expect(server.boardFetches - before).toBe(1);
  });

  it("reloads for an announcement that carries no revision, as Standalone's do", async () => {
    const server = fakeServer(false);
    renderHook(() => useMindmapData());
    await waitFor(() => expect(server.boardFetches).toBe(1));

    emit(null);
    await waitFor(() => expect(server.boardFetches).toBe(2));
  });
});
