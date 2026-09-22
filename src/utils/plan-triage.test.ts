import { describe, it, expect } from "vitest";
import {
  effectiveTimeScope, nearestPlannedAncestor, partitionForScope, planRefusal, referencedScopeIds,
} from "./plan-triage";
import { timeScopeWindow } from "./scope-match";
import type { ScopeWindows } from "./scope-interval";
import type { TaskListRow } from "./list-filter";
import type { MindmapNode, NodeKind } from "./tree-layout";

// Scope ids used throughout: 1 = the week being filled, 2 = a Tuesday inside it, 3 = next week,
// 4 = the month the week starts in.
const WINDOWS: ScopeWindows = new Map([
  [1, { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" }],
  [2, { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" }],
  [3, { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" }],
  [4, { start: "2026-09-01T00:00:00", end: "2026-10-01T00:00:00" }],
]);

const WEEK = { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" };

function scope(id: number) {
  return { start_id: id, end_id: id };
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
    hasBlockedAncestor: false,
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

describe("nearestPlannedAncestor", () => {
  it("is the closest planned ancestor, not the highest", () => {
    const result = nearestPlannedAncestor(row({
      ancestors: [node("task-a", { plan: scope(4) }), node("task-b", { plan: scope(1) })],
    }));
    expect(result?.id).toBe("task-b");
  });

  it("is null when no ancestor is planned", () => {
    expect(nearestPlannedAncestor(row({ ancestors: [node("task-a")] }))).toBeNull();
  });
});

describe("timeScopeWindow", () => {
  it("spans from the start boundary's start to the end boundary's end", () => {
    expect(timeScopeWindow({ start_id: 1, end_id: 3 }, WINDOWS)).toEqual({
      start: "2026-09-20T00:00:00",
      end: "2026-10-04T00:00:00",
    });
  });

  it("is null while an endpoint has not resolved", () => {
    expect(timeScopeWindow({ start_id: 1, end_id: 99 }, WINDOWS)).toBeNull();
  });
});

describe("referencedScopeIds", () => {
  it("collects the row's own boundaries and its ancestors'", () => {
    const ids = referencedScopeIds([
      row({
        node: node("task-1", { timeScope: { start_id: 1, end_id: 3 } }),
        ancestors: [node("task-0", { plan: scope(4) })],
      }),
    ]);
    expect([...ids].sort()).toEqual([1, 3, 4]);
  });
});

describe("partitionForScope", () => {
  it("offers an unplanned task whose own window is the scope", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(1) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS);
    expect(panes.candidates.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.planned).toEqual([]);
  });

  it("offers an unplanned task whose window merely overlaps the scope", () => {
    const rows = [row({ node: node("task-1", { timeScope: { start_id: 2, end_id: 3 } }) })];
    expect(partitionForScope(rows, WEEK, WINDOWS).candidates).toHaveLength(1);
  });

  it("offers an Unscoped task, which is always relevant", () => {
    expect(partitionForScope([row()], WEEK, WINDOWS).candidates).toHaveLength(1);
  });

  it("offers a task relevant only through an inherited window", () => {
    const rows = [row({ ancestors: [node("goal-1", { timeScope: scope(1) }, "goal")] })];
    expect(partitionForScope(rows, WEEK, WINDOWS).candidates).toHaveLength(1);
  });

  it("leaves out an unplanned task whose window is next week", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(3) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS);
    expect(panes.candidates).toEqual([]);
    expect(panes.planned).toEqual([]);
  });

  it("puts a task planned into the scope on the right", () => {
    const rows = [row({ node: node("task-1", { plan: scope(1) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS);
    expect(panes.planned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.candidates).toEqual([]);
  });

  it("counts a task planned into a day inside the scope as part of what the scope holds", () => {
    const rows = [row({ node: node("task-1", { plan: scope(2) }) })];
    expect(partitionForScope(rows, WEEK, WINDOWS).planned).toHaveLength(1);
  });

  it("puts a task planned elsewhere in neither pane", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(4), plan: scope(3) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS);
    expect(panes.candidates).toEqual([]);
    expect(panes.planned).toEqual([]);
  });

  it("triages no virtual Habit occurrence", () => {
    const habitItem = { flowId: 1, itemType: "flow_task" as const, itemId: 1, scopeId: 1, cycleId: 0 };
    const rows = [row({ node: node("task-1", { virtual: true, habitItem }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS);
    expect(panes.candidates).toEqual([]);
    expect(panes.planned).toEqual([]);
  });
});

describe("planRefusal", () => {
  it("allows a move into a scope the task's own window contains", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(4) }) });
    expect(planRefusal(rows, { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" }, WINDOWS)).toBeNull();
  });

  it("refuses a move into a scope that escapes the task's own window", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(2) }) });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("ownTimeScope");
  });

  it("refuses a move into a scope that escapes the nearest planned ancestor's Plan", () => {
    const rows = row({ ancestors: [node("task-0", { plan: scope(2) })] });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("parentPlan");
  });

  it("names the task's own window first, as the backend does", () => {
    const rows = row({
      node: node("task-1", { timeScope: scope(2) }),
      ancestors: [node("task-0", { plan: scope(2) })],
    });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("ownTimeScope");
  });

  it("refuses nothing on an inherited window alone", () => {
    const rows = row({ ancestors: [node("goal-1", { timeScope: scope(2) }, "goal")] });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBeNull();
  });

  it("refuses nothing while a bound's window is still unresolved", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(99) }) });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBeNull();
  });
});
