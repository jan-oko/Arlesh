import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { deferred, lane, patchedFields, settleLane } from "@/test/lane-helpers";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import { usePlanClampStore } from "@/stores/use-plan-clamp-store";
import { applyPendingWrites } from "@/utils/apply-pending-writes";
import { scopeKeyText } from "@/utils/scope-key";
import { fixtureRowId } from "@/test/node-fixture";
import type { ScopeKey } from "@/api/scopes";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import { usePlanMove } from "./use-plan-move";

// What the Plan View shows at once when work is planned, and what happens when the backend answers,
// refuses or asks. Which pane a row sits in is `effectivePlan`'s call (pinned by `plan-triage.json`),
// so these pin only that the row's own Plan is patched, in the lane, with the cue.
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const runGesture = vi.fn<(name: string, steps: Array<{ id: number; request: unknown }>) => Promise<unknown[]>>();
vi.mock("@/api/multi-node-gestures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/multi-node-gestures")>()),
  runGesture: (name: string, steps: Array<{ id: number; request: unknown }>) => runGesture(name, steps),
}));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  withAtomicGesture: (_name: string, run: () => Promise<unknown>) => run(),
}));
const conflicts = vi.fn();
vi.mock("@/api/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/tasks")>()),
  planContainmentConflicts: () => conflicts(),
}));

const WEEK: ScopeKey = { kind: "week", date: "2026-09-20" };
const PLAN = { start_id: WEEK, end_id: WEEK };
const WINDOW = { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" };

function task(id: string, extra: Partial<MindmapNode> = {}): TaskListRow {
  const node: MindmapNode = { id, ...fixtureRowId(id), kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
  return {
    node, ancestors: [], goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, isAgentic: false, isAsynchronous: false,
    heldByBlockedAncestor: false, hasPrivateAncestor: false, scopeTokens: [],
  };
}

function setup() {
  const showToast = vi.fn();
  const rendered = renderHook(() =>
    usePlanMove({
      targetScopeId: WEEK, targetWindow: WINDOW, targetLabel: "W39",
      windows: new Map([[scopeKeyText(WEEK), WINDOW]]), showToast,
    }),
  );
  return { ...rendered, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingWritesStore.getState().reset();
  usePendingWritesStore.getState().reportBoard({ read: 0, epoch: null, revision: null });
  usePlanClampStore.setState({ request: null });
  conflicts.mockResolvedValue([]);
});

describe("planning through the lane", () => {
  it("shows the plan at once, with the cue, before the write resolves", async () => {
    const held = deferred<unknown[]>();
    runGesture.mockReturnValue(held.promise);
    const { result } = setup();

    let moved: string[] = [];
    await act(async () => { moved = await result.current.planInto([task("task-1")]); });

    expect(moved).toEqual(["task-1"]);
    expect(patchedFields()).toEqual([{ plan: PLAN }]);
    const board: MindmapNode = { id: "root", kind: "goal", title: "r", position: 0, tagIds: [], children: [task("task-1").node] };
    const drawn = applyPendingWrites(board, { read: 0, epoch: null, revision: null }, lane(), new Map());
    expect(drawn.children[0]).toMatchObject({ plan: PLAN, pending: true });

    await act(async () => { held.resolve([{ id: 1 }]); await held.promise; });
    await settleLane();
    expect(lane()[0]?.answer?.fields).toEqual({ plan: PLAN });
  });

  it("takes work out the same way, clearing a Plan with none above", async () => {
    runGesture.mockResolvedValue([{ id: 2 }]);
    const { result } = setup();

    await act(async () => { await result.current.takeOut([task("task-2", { plan: PLAN })], { kind: "clear" }); });
    await settleLane();

    expect(patchedFields()).toEqual([{ plan: null }]);
    expect(runGesture).toHaveBeenCalledWith("plan-move", [expect.objectContaining({ id: 2, request: { plan: null } })]);
  });

  it("rolls back a refused step with one toast, and keeps the rest of its batch", async () => {
    runGesture.mockResolvedValue([{ id: 1 }, { refused: { kind: "invalid_request", message: "no" } }]);
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task("task-1"), task("task-2")]); });
    await settleLane();

    expect(runGesture).toHaveBeenCalledTimes(1);
    expect(lane().map((write) => write.nodeId)).toEqual(["task-1"]);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({ nodeId: "task-2", message: "planView:moveFailed" });
  });

  it("rolls everything back with one toast when the call itself is refused", async () => {
    runGesture.mockRejectedValue(new Error("locked"));
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task("task-1")]); });
    await settleLane();

    expect(lane()).toEqual([]);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("shows two quick swipes at once and sends them in order", async () => {
    const first = deferred<unknown[]>();
    runGesture.mockReturnValueOnce(first.promise).mockResolvedValueOnce([{ id: 2 }]);
    const { result } = setup();

    await act(async () => {
      await result.current.planInto([task("task-1")]);
      await result.current.planInto([task("task-2")]);
    });

    expect(patchedFields()).toEqual([{ plan: PLAN }, { plan: PLAN }]);
    expect(runGesture).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve([{ id: 1 }]); await first.promise; });
    await settleLane();
    expect(runGesture.mock.calls.map(([, steps]) => steps[0]?.id)).toEqual([1, 2]);
  });

  it("rolls back, asks the clamp prompt, and writes again acknowledged when Tasks below would be left outside", async () => {
    conflicts.mockResolvedValue([{ id: 9 }]);
    runGesture.mockResolvedValue([{ id: 1 }]);
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task("task-1")]); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await vi.waitFor(() => expect(usePlanClampStore.getState().request).not.toBeNull());

    // Held, not refused: nothing sent, nothing shown, no toast.
    expect(runGesture).not.toHaveBeenCalled();
    expect(lane()).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();

    await act(async () => { usePlanClampStore.getState().answer("clamp"); });
    expect(patchedFields()).toEqual([{ plan: PLAN }]);
    await settleLane();
    expect(runGesture).toHaveBeenCalledWith("plan-move", [
      expect.objectContaining({ id: 1, descendant_plans: "clamp" }),
    ]);
  });

  it("writes nothing when the clamp prompt is cancelled", async () => {
    conflicts.mockResolvedValue([{ id: 9 }]);
    const { result } = setup();

    await act(async () => { await result.current.planInto([task("task-1")]); });
    await vi.waitFor(() => expect(usePlanClampStore.getState().request).not.toBeNull());
    await act(async () => { usePlanClampStore.getState().answer(null); });

    expect(runGesture).not.toHaveBeenCalled();
    expect(lane()).toEqual([]);
  });
});
