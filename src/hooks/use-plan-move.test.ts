import { storedRowId } from "@/test/stored-id";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePlanClampStore } from "@/stores/use-plan-clamp-store";
import { fixtureRowId } from "@/test/node-fixture";
import type { ScopeKey } from "@/api/scopes";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import { usePlanMove } from "./use-plan-move";

// What happens when work is planned and the backend answers, refuses or asks. Which pane a row sits
// in is `effectivePlan`'s call (pinned by `plan-triage.json`), so these pin only the call made.
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
// Which bounds a move breaks is Rust's (`plan_refusals`, pinned by `plan-triage.json`): none here.
vi.mock("@/api/rules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/rules")>()),
  fetchPlanRefusals: () => Promise.resolve({}),
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
      showToast,
    }),
  );
  return { ...rendered, showToast };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlanClampStore.setState({ request: null });
  conflicts.mockResolvedValue([]);
});

describe("planning is one awaited gesture", () => {
  it("writes the plan of every row in one request and answers the rows it was sent for", async () => {
    runGesture.mockResolvedValue([{ id: storedRowId(1) }, { id: storedRowId(2) }]);
    const { result } = setup();

    let moved: string[] = [];
    await act(async () => {
      moved = await result.current.planInto([task(`task-${storedRowId(1)}`), task(`task-${storedRowId(2)}`)]);
    });

    expect(moved).toEqual([`task-${storedRowId(1)}`, `task-${storedRowId(2)}`]);
    expect(runGesture).toHaveBeenCalledTimes(1);
    expect(runGesture).toHaveBeenCalledWith("plan-move", [
      expect.objectContaining({ id: storedRowId(1), request: { plan: PLAN } }),
      expect.objectContaining({ id: storedRowId(2), request: { plan: PLAN } }),
    ]);
  });

  it("takes work out the same way, clearing a Plan with none above", async () => {
    runGesture.mockResolvedValue([{ id: storedRowId(2) }]);
    const { result } = setup();

    await act(async () => { await result.current.takeOut([task(`task-${storedRowId(2)}`, { plan: PLAN })], { kind: "clear" }); });

    expect(runGesture).toHaveBeenCalledWith("plan-move", [expect.objectContaining({ id: storedRowId(2), request: { plan: null } })]);
  });

  it("says one toast for a refused step", async () => {
    runGesture.mockResolvedValue([{ id: storedRowId(1) }, { refused: { kind: "invalid_request", message: "no" } }]);
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task(`task-${storedRowId(1)}`), task(`task-${storedRowId(2)}`)]); });

    expect(runGesture).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({ nodeId: `task-${storedRowId(2)}`, message: "planView:moveFailed" });
  });

  it("says one toast when the call itself is refused", async () => {
    runGesture.mockRejectedValue(new Error("locked"));
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task(`task-${storedRowId(1)}`)]); });

    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("asks the clamp prompt, and writes again acknowledged, when Tasks below would be left outside", async () => {
    conflicts.mockResolvedValue([{ id: storedRowId(9) }]);
    runGesture.mockResolvedValue([{ id: storedRowId(1) }]);
    const { result, showToast } = setup();

    await act(async () => { await result.current.planInto([task(`task-${storedRowId(1)}`)]); });
    await vi.waitFor(() => expect(usePlanClampStore.getState().request).not.toBeNull());

    // Held, not refused: nothing sent, no toast.
    expect(runGesture).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();

    await act(async () => { usePlanClampStore.getState().answer("clamp"); });
    await vi.waitFor(() => expect(runGesture).toHaveBeenCalledWith("plan-move", [
      expect.objectContaining({ id: storedRowId(1), descendant_plans: "clamp" }),
    ]));
  });

  it("writes nothing when the clamp prompt is cancelled", async () => {
    conflicts.mockResolvedValue([{ id: storedRowId(9) }]);
    const { result } = setup();

    await act(async () => { await result.current.planInto([task(`task-${storedRowId(1)}`)]); });
    await vi.waitFor(() => expect(usePlanClampStore.getState().request).not.toBeNull());
    await act(async () => { usePlanClampStore.getState().answer(null); });

    expect(runGesture).not.toHaveBeenCalled();
  });
});
