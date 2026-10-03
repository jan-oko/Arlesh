import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useQuickDependency } from "./use-quick-dependency";
import type { Dependency } from "@/api/tasks";
import { useDisplayStore } from "@/stores/use-display-store";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { fixtureRowId } from "@/test/node-fixture";

/**
 * Nothing between the hook and Tauri is stubbed: the candidates and the write go through the real
 * `src/api/` wrappers and the real Gesture door, so "one `Ctrl+Z`" is checked where it is decided.
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key} ${JSON.stringify(options)}`,
  }),
}));

interface Write {
  command: string;
  args: unknown;
  gesture: string | null;
}

interface Backend {
  /** What the backend offers as prerequisites — by default every other node the board holds. */
  candidates?: Dependency[];
  refuseCandidates?: string;
  refuseWrite?: string;
}

/** Every node of {@link board} but `task-1`, as the backend names them. */
const EVERY_OTHER: Dependency[] = [
  { type: "task", id: 2 }, { type: "task", id: 3 }, { type: "expectation", id: 7 }, { type: "goal", id: 4 },
];

/** A backend that serves the candidates and journals every write with its Gesture. */
function installBackend({ candidates = EVERY_OTHER, refuseCandidates, refuseWrite }: Backend = {}): { writes: Write[]; gestures: () => number } {
  const writes: Write[] = [];
  let depth = 0;
  let started = 0;
  let current: string | null = null;
  vi.mocked(tauriInvoke).mockImplementation((command: string, args?: unknown) => {
    if (command === "open_gesture") {
      depth += 1;
      if (depth === 1) { started += 1; current = `gesture-${started}`; }
      return Promise.resolve(current);
    }
    if (command === "close_gesture") {
      depth -= 1;
      if (depth === 0) current = null;
      return Promise.resolve(null);
    }
    if (command === "dependency_candidates") {
      return refuseCandidates === undefined ? Promise.resolve(candidates) : Promise.reject(new Error(refuseCandidates));
    }
    if (refuseWrite !== undefined) return Promise.reject(new Error(refuseWrite));
    writes.push({ command, args, gesture: current });
    return Promise.resolve(null);
  });
  return { writes, gestures: () => started };
}

function node(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function board(): MindmapNode {
  return node("root", "domain", {
    children: [
      node("task-1", "task", { title: "Ship it" }),
      node("task-2", "task", { title: "Write the tests" }),
      node("task-3", "task", { title: "Old tests", archived: true }),
      node("expectation-7", "expectation", { title: "Tests from Dana" }),
      node("goal-4", "goal"),
    ],
  });
}

function setup(tree: MindmapNode = board()) {
  const reload = vi.fn(() => Promise.resolve());
  const showToast = vi.fn();
  const rendered = renderHook(() => useQuickDependency({ tree, findNode: (id) => findNode(tree, id), reload, showToast }));
  return { ...rendered, reload, showToast };
}

/** The last toast's message, or undefined. */
function lastToast(showToast: ReturnType<typeof vi.fn>): string | undefined {
  const call = showToast.mock.calls[showToast.mock.calls.length - 1];
  const toast: unknown = call?.[0];
  if (typeof toast !== "object" || toast === null || !("message" in toast)) return undefined;
  return typeof toast.message === "string" ? toast.message : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDisplayStore.setState({ searchIncludesArchived: false });
});

describe("useQuickDependency — opening", () => {
  it("opens on a Task and offers the other Tasks, the Goals and the stored waits, archived ones left out", async () => {
    installBackend();
    const { result } = setup();
    act(() => { result.current.open(["task-1"]); });
    expect(result.current.target).toMatchObject({ anchorId: "task-1", candidates: null });
    await waitFor(() => expect(result.current.target?.candidates).not.toBeNull());
    expect(result.current.target?.candidates?.map((c) => c.id)).toEqual(["task-2", "expectation-7", "goal-4"]);
  });

  it("offers archived nodes too when Settings says search includes them", async () => {
    installBackend();
    useDisplayStore.setState({ searchIncludesArchived: true });
    const { result } = setup();
    act(() => { result.current.open(["task-1"]); });
    await waitFor(() => expect(result.current.target?.candidates).not.toBeNull());
    expect(result.current.target?.candidates?.map((c) => c.id)).toEqual(["task-2", "task-3", "expectation-7", "goal-4"]);
  });

  it("offers only what the backend offers for the Task", async () => {
    // Leaving out what it already depends on and what depends on it is the backend's
    // (`tasks::rules::dependencies::candidates`); the picker offers what comes back.
    installBackend({ candidates: [{ type: "goal", id: 4 }] });
    const { result } = setup();
    act(() => { result.current.open(["task-1"]); });
    await waitFor(() => expect(result.current.target?.candidates).not.toBeNull());
    expect(result.current.target?.candidates?.map((c) => c.id)).toEqual(["goal-4"]);
    expect(tauriInvoke).toHaveBeenCalledWith("dependency_candidates", { id: 1 });
  });

  it("refuses a node that holds no dependencies, by name", () => {
    installBackend();
    const { result, showToast } = setup();
    act(() => { result.current.open(["goal-4"]); });
    expect(result.current.target).toBeNull();
    expect(lastToast(showToast)).toContain("warnings:quickDependencyNotTask");
    expect(lastToast(showToast)).toContain("goal-4");
  });

  it("asks a multi-selection to narrow to one Task", () => {
    installBackend();
    const { result, showToast } = setup();
    act(() => { result.current.open(["task-1", "task-2"]); });
    expect(result.current.target).toBeNull();
    expect(lastToast(showToast)).toBe("warnings:quickDependencyOneAtATime");
  });

  it("closes and says so when the candidates cannot be read", async () => {
    installBackend({ refuseCandidates: "database is locked" });
    const { result, showToast } = setup();
    act(() => { result.current.open(["task-1"]); });
    await waitFor(() => expect(result.current.target).toBeNull());
    expect(lastToast(showToast)).toContain("database is locked");
  });
});

describe("useQuickDependency — adding", () => {
  it("writes the edge in one Gesture and reloads the board", async () => {
    const backend = installBackend();
    const { result, reload } = setup();
    act(() => { result.current.open(["task-1"]); });
    await waitFor(() => expect(result.current.target?.candidates).not.toBeNull());
    const wait = result.current.target?.candidates?.find((c) => c.id === "expectation-7");
    if (wait === undefined) throw new Error("the wait was not offered");

    // Every call through the api door opens a Gesture of its own — the edge read included — so
    // count only what the add opens.
    const before = backend.gestures();
    await act(async () => { await result.current.apply(wait); });
    expect(backend.writes).toEqual([{
      command: "add_task_dependency",
      args: { taskId: 1, dependency: { type: "expectation", id: 7 } },
      gesture: `gesture-${before + 1}`,
    }]);
    expect(backend.gestures()).toBe(before + 1);
    expect(result.current.target).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the backend's refusal — a cycle it could see and the search could not — as a toast", async () => {
    installBackend({ refuseWrite: "adding this dependency would create a cycle" });
    const { result, reload, showToast } = setup();
    act(() => { result.current.open(["task-1"]); });
    await waitFor(() => expect(result.current.target?.candidates).not.toBeNull());
    const other = result.current.target?.candidates?.find((c) => c.id === "task-2");
    if (other === undefined) throw new Error("task-2 was not offered");

    await act(async () => { await result.current.apply(other); });
    expect(reload).not.toHaveBeenCalled();
    const message = lastToast(showToast);
    expect(message).toContain("warnings:quickDependencyFailed");
    expect(message).toContain("would create a cycle");
    expect(message).toContain("Write the tests");
  });

  it("closes without a write", async () => {
    const backend = installBackend();
    const { result } = setup();
    act(() => { result.current.open(["task-1"]); });
    act(() => { result.current.close(); });
    await Promise.resolve();
    expect(result.current.target).toBeNull();
    expect(backend.writes).toEqual([]);
  });
});
