import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useQuickPlan } from "./use-quick-plan";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { TimeScope } from "@/api/time-scope";
import { fixtureRowId } from "@/test/node-fixture";
import { occurrenceRow } from "@/test/occurrence";

/**
 * Nothing between the hook and Tauri is stubbed: `updateTask` is the real `src/api/` wrapper, going
 * through the real Gesture door, so "one `Ctrl+Z`" is checked where it is decided — every write
 * landing in the same Gesture — rather than by counting the hook's own calls.
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

/** A backend that journals every write with the Gesture it landed in, and refuses where told to. */
function installBackend(refuse: (args: unknown) => string | null = () => null): { writes: Write[]; gestures: () => number } {
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
    const refusal = refuse(args);
    if (refusal !== null) return Promise.reject(new Error(refusal));
    writes.push({ command, args, gesture: current });
    return Promise.resolve({ id: 1 });
  });
  return { writes, gestures: () => started };
}

function node(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

const JUNE: TimeScope = { start_id: { kind: "month", date: "2026-06-01" }, end_id: { kind: "month", date: "2026-06-01" } };
const JUNE_3: TimeScope = { start_id: { kind: "day", date: "2026-06-03" }, end_id: { kind: "day", date: "2026-06-03" } };

function setup(nodes: MindmapNode[]) {
  const reload = vi.fn(() => Promise.resolve());
  const showToast = vi.fn();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = renderHook(() => useQuickPlan({ findNode: (id) => byId.get(id), reload, showToast }));
  return { ...rendered, reload, showToast };
}

/** The last toast's message, or undefined. */
function lastToast(showToast: ReturnType<typeof vi.fn>): string | undefined {
  const call = showToast.mock.calls[showToast.mock.calls.length - 1];
  const toast: unknown = call?.[0];
  if (typeof toast !== "object" || toast === null || !("message" in toast)) return undefined;
  return typeof toast.message === "string" ? toast.message : undefined;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("useQuickPlan — opening", () => {
  it("opens on a Task, bound to its Time Scope and holding its Plan", () => {
    const { result } = setup([node("task-5", "task", { timeScope: JUNE, plan: JUNE_3 })]);
    act(() => { result.current.open(["task-5"]); });
    expect(result.current.target).toMatchObject({ anchorId: "task-5", value: JUNE_3, timeScope: JUNE, skipped: 0 });
  });

  it("lifts the Time Scope bound for an Overdue Task, as the editor does", () => {
    const { result } = setup([node("task-5", "task", { timeScope: JUNE, resolution: "overdue", status: "todo" })]);
    act(() => { result.current.open(["task-5"]); });
    expect(result.current.target?.timeScope).toBeNull();
  });

  it("refuses a node that holds no Plan by name, and opens nothing", () => {
    const { result, showToast } = setup([node("goal-2", "goal", { title: "Ship v1" })]);
    act(() => { result.current.open(["goal-2"]); });
    expect(result.current.target).toBeNull();
    expect(lastToast(showToast)).toBe('warnings:quickPlanNotTask {"title":"Ship v1"}');
  });

  it("refuses a wait's drawn check task, which has no row to plan", () => {
    const { result, showToast } = setup([node("task-check", "task", { virtual: true, title: "Check" })]);
    act(() => { result.current.open(["task-check"]); });
    expect(result.current.target).toBeNull();
    expect(lastToast(showToast)).toBe('warnings:quickPlanNotTask {"title":"Check"}');
  });

  it("refuses a selection with no Task in it at all", () => {
    const { result, showToast } = setup([node("goal-2", "goal"), node("domain-3", "domain")]);
    act(() => { result.current.open(["goal-2", "domain-3"]); });
    expect(result.current.target).toBeNull();
    expect(lastToast(showToast)).toBe("warnings:quickPlanNoTasks");
  });

  it("Escape — closing — writes nothing", () => {
    const backend = installBackend();
    const { result } = setup([node("task-5", "task")]);
    act(() => { result.current.open(["task-5"]); });
    act(() => { result.current.close(); });
    expect(result.current.target).toBeNull();
    expect(backend.writes).toEqual([]);
  });
});

describe("useQuickPlan — writing", () => {
  it("sets the Plan through update_task, the editor's own write, and reloads", async () => {
    const backend = installBackend();
    const { result, reload, showToast } = setup([node("task-5", "task")]);
    act(() => { result.current.open(["task-5"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes).toEqual([{ command: "update_task", args: { id: 5, request: { plan: JUNE_3 } }, gesture: "gesture-1" }]);
    expect(reload).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.target).toBeNull();
  });

  it("clears the Plan with null", async () => {
    const backend = installBackend();
    const { result } = setup([node("task-5", "task", { plan: JUNE_3 })]);
    act(() => { result.current.open(["task-5"]); });
    await act(async () => { await result.current.apply(null); });
    expect(backend.writes.map((w) => w.args)).toEqual([{ id: 5, request: { plan: null } }]);
  });

  it("plans a Habit occurrence on its own row id — the backend writes its overlay", async () => {
    const backend = installBackend();
    const occurrence = { ...node("task-occ", "task"), ...occurrenceRow({ index: 2 }) };
    const { result } = setup([occurrence]);
    act(() => { result.current.open(["task-occ"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes.map((w) => w.args)).toEqual([{ id: occurrence.rowId, request: { plan: JUNE_3 } }]);
  });

  it("says a backlogged Task came out of the Backlog", async () => {
    installBackend();
    const { result, showToast } = setup([node("task-5", "task", { backlogged: true })]);
    act(() => { result.current.open(["task-5"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(lastToast(showToast)).toBe("warnings:backlogClearedByPlan");
  });

  it("shows the backend's refusal — a Plan outside the Task's Time Scope — and writes nothing", async () => {
    const backend = installBackend(() => "plan must fall within the task's time scope");
    const { result, reload, showToast } = setup([node("task-5", "task", { title: "Ship it", timeScope: JUNE })]);
    act(() => { result.current.open(["task-5"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(lastToast(showToast)).toBe(
      `warnings:quickPlanFailed {"title":"Ship it","message":"plan must fall within the task's time scope"}`,
    );
  });
});

describe("useQuickPlan — a multi-selection", () => {
  it("plans every Task in it as one Gesture — one Ctrl+Z", async () => {
    const backend = installBackend();
    const { result } = setup([node("task-1", "task"), node("task-2", "task"), node("task-3", "task")]);
    act(() => { result.current.open(["task-2", "task-1", "task-3"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes.map((w) => w.args)).toEqual([
      { id: 2, request: { plan: JUNE_3 } },
      { id: 1, request: { plan: JUNE_3 } },
      { id: 3, request: { plan: JUNE_3 } },
    ]);
    expect(new Set(backend.writes.map((w) => w.gesture))).toEqual(new Set(["gesture-1"]));
    expect(backend.gestures()).toBe(1);
  });

  it("plans the Tasks and names the nodes it left alone, never dropping them in silence", async () => {
    const backend = installBackend();
    const { result, showToast } = setup([node("task-1", "task"), node("goal-2", "goal")]);
    act(() => { result.current.open(["goal-2", "task-1"]); });
    expect(result.current.target).toMatchObject({ anchorId: "goal-2", skipped: 1 });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes.map((w) => w.args)).toEqual([{ id: 1, request: { plan: JUNE_3 } }]);
    expect(lastToast(showToast)).toBe('warnings:quickPlanSkippedNotTask {"count":1}');
  });

  it("keeps the Tasks the backend accepted when it refuses one, and counts the refusal", async () => {
    const backend = installBackend((args) => (JSON.stringify(args).includes('"id":2') ? "outside its parent's plan" : null));
    const { result, showToast } = setup([node("task-1", "task"), node("task-2", "task", { title: "Two" })]);
    act(() => { result.current.open(["task-1", "task-2"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(backend.writes.map((w) => w.args)).toEqual([{ id: 1, request: { plan: JUNE_3 } }]);
    expect(lastToast(showToast)).toBe(
      `warnings:quickPlanFailedSome {"title":"Two","message":"outside its parent's plan","count":1,"total":2}`,
    );
  });

  it("counts every Task a batch took out of the Backlog", async () => {
    installBackend();
    const { result, showToast } = setup([
      node("task-1", "task", { backlogged: true }), node("task-2", "task", { backlogged: true }),
    ]);
    act(() => { result.current.open(["task-1", "task-2"]); });
    await act(async () => { await result.current.apply(JUNE_3); });
    expect(lastToast(showToast)).toBe('warnings:backlogClearedByPlanMany {"count":2}');
  });
});
