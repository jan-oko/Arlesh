import { beforeEach, describe, it, expect, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  effectiveTimeScope, effectivePlan, partitionForScope, planRefusals, referencedScopeIds,
  timeScopeWindow,
} from "./plan-triage";
import type { ScopeWindows } from "./plan-triage";
import type { TaskListRow } from "./list-filter";
import type { MindmapNode, NodeKind } from "./tree-layout";
import { testKey } from "@/test/scope-key";
import { scopeKeyText } from "@/utils/scope-key";
import type { ScopeKey } from "@/api/scopes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Scope ids used throughout (as `testKey(n)`): 1 = the week being filled, 2 = a Tuesday inside it, 3 = next week,
// 4 = the month the week starts in, and so the week's parent; 5 = the season above that month.
const WINDOWS: ScopeWindows = new Map([
  [scopeKeyText(testKey(1)), { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" }],
  [scopeKeyText(testKey(2)), { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" }],
  [scopeKeyText(testKey(3)), { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" }],
  [scopeKeyText(testKey(4)), { start: "2026-09-01T00:00:00", end: "2026-10-01T00:00:00" }],
  [scopeKeyText(testKey(5)), { start: "2026-09-01T00:00:00", end: "2026-12-01T00:00:00" }],
  [scopeKeyText(testKey(6)), { start: "2026-10-01T00:00:00", end: "2026-11-01T00:00:00" }],
]);

// The partition and the refusal are the Rust rule, asked through a command (mocked here), so those
// tests use real keys: K1 the week of Sunday 20 September
// 2026, K2 the Tuesday inside it, K3 the following week (it straddles into October), K4 September,
// K5 the autumn season above it, K6 October.
const K1: ScopeKey = { kind: "week", date: "2026-09-20" };
const K2: ScopeKey = { kind: "day", date: "2026-09-22" };
const K3: ScopeKey = { kind: "week", date: "2026-09-27" };
const K4: ScopeKey = { kind: "month", date: "2026-09-01" };
const K5: ScopeKey = { kind: "season", date: "2026-09-01" };
const K6: ScopeKey = { kind: "month", date: "2026-10-01" };
const REAL = [K1, K1, K2, K3, K4, K5, K6] as const;

function real(id: number) {
  const key = REAL[id];
  if (key === undefined) throw new Error(`no real key for fixture ${id}`);
  return { start_id: key, end_id: key };
}

function scope(id: number) {
  return { start_id: testKey(id), end_id: testKey(id) };
}

function node(id: string, extra: Partial<MindmapNode> = {}, kind: NodeKind = "task"): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: node("task-1"),
    ancestors: [],
    goalRef: null,
    goalStatus: null,
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    isAgentic: false,
    isAsynchronous: false,
    heldByBlockedAncestor: false,
    hasPrivateAncestor: false,
    scopeTokens: [],
    ...over,
  };
}

describe("effectiveTimeScope", () => {
  it("is the task's own window when it has one", () => {
    const own = scope(2);
    expect(effectiveTimeScope(row({ node: node("task-1", { timeScope: own }) }))).toBe(own);
  });

  it("is the nearest scoped ancestor's when the task has none", () => {
    const near = scope(1);
    const far = scope(4);
    const result = effectiveTimeScope(row({
      ancestors: [node("goal-1", { timeScope: far }, "goal"), node("task-0", { timeScope: near })],
    }));
    expect(result).toBe(near);
  });

  it("is null when nothing in the chain is scoped", () => {
    expect(effectiveTimeScope(row({ ancestors: [node("goal-1", {}, "goal")] }))).toBeNull();
  });
});

describe("effectivePlan", () => {
  it("is the task's own Plan when it has one, over the one it inherits", () => {
    const own = scope(2);
    expect(effectivePlan(row({ node: node("task-1", { plan: own, inheritedPlan: scope(1) }) }))).toBe(own);
  });

  it("is the Plan it inherits when it has none of its own", () => {
    const inherited = scope(1);
    expect(effectivePlan(row({ node: node("task-1", { inheritedPlan: inherited }) }))).toBe(inherited);
  });

  it("is null when nothing above is planned either", () => {
    expect(effectivePlan(row())).toBeNull();
  });
});

describe("timeScopeWindow", () => {
  it("spans from the start boundary's start to the end boundary's end", () => {
    expect(timeScopeWindow({ start_id: testKey(1), end_id: testKey(3) }, WINDOWS)).toEqual({
      start: "2026-09-20T00:00:00",
      end: "2026-10-04T00:00:00",
    });
  });

  it("is null while an endpoint has not resolved", () => {
    expect(timeScopeWindow({ start_id: testKey(1), end_id: testKey(99) }, WINDOWS)).toBeNull();
  });
});

describe("referencedScopeIds", () => {
  it("collects the row's own boundaries and the Plan it inherits", () => {
    const ids = referencedScopeIds([
      row({
        node: node("task-1", { timeScope: { start_id: testKey(1), end_id: testKey(3) }, inheritedPlan: scope(4) }),
      }),
    ]);
    expect(ids.map(scopeKeyText).sort()).toEqual([testKey(1), testKey(3), testKey(4)].map(scopeKeyText));
  });
});

describe("partitionForScope", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("sends the rows in the rule's shape and answers the rows the ids name, in the answer's order", async () => {
    vi.mocked(invoke).mockResolvedValue({ unplanned: ["task-2", "task-1"], planned: ["task-3"], parentPlanned: [], refusals: {} });
    const rows = [
      row({ node: node("task-1", { timeScope: real(1) }) }),
      row({ node: node("task-2", { virtual: true }) }),
      row({ node: node("task-3", { plan: real(2) }) }),
    ];

    const panes = await partitionForScope(rows, K1, K4);

    expect(invoke).toHaveBeenCalledWith("plan_triage", {
      target: K1, parent: K4,
      rows: [
        expect.objectContaining({ id: "task-1", virtual: false, timeScope: real(1), plan: null }),
        expect.objectContaining({ id: "task-2", virtual: true }),
        expect.objectContaining({ id: "task-3", plan: real(2) }),
      ],
    });
    expect(panes.unplanned.map((r) => r.node.id)).toEqual(["task-2", "task-1"]);
    expect(panes.planned.map((r) => r.node.id)).toEqual(["task-3"]);
    expect(panes.parentPlanned).toEqual([]);
  });

  it("flags a row whose inherited Plan came to nothing, and the ancestors' own Time Scopes", async () => {
    vi.mocked(invoke).mockResolvedValue({ unplanned: [], planned: [], parentPlanned: [], refusals: {} });
    const inheritsNothing = row({
      node: node("task-1", { planConflict: "empty" }),
      ancestors: [node("goal-1", { timeScope: real(2) }, "goal")],
    });

    await partitionForScope([inheritsNothing], K1, null);

    expect(invoke).toHaveBeenCalledWith("plan_triage", {
      target: K1, parent: null,
      rows: [expect.objectContaining({ emptyPlan: true, ancestors: [{ timeScope: real(2) }] })],
    });
  });
});

describe("planRefusals", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("names the bound each refused row breaks and leaves the others out", async () => {
    vi.mocked(invoke).mockResolvedValue({ "task-1": "own_time_scope", "task-2": "parent_plan" });
    const rows = [row({ node: node("task-1") }), row({ node: node("task-2") }), row({ node: node("task-3") })];

    const refusals = await planRefusals(rows, K1);

    expect(invoke).toHaveBeenCalledWith("plan_refusals", { target: K1, rows: expect.any(Array) });
    expect(refusals.get("task-1")).toBe("ownTimeScope");
    expect(refusals.get("task-2")).toBe("parentPlan");
    expect(refusals.has("task-3")).toBe(false);
  });
});
