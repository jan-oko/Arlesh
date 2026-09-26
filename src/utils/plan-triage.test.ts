import { describe, it, expect } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import {
  effectiveTimeScope, nearestPlannedAncestor, partitionForScope, planRefusal, referencedScopeIds,
  timeScopeWindow,
} from "./plan-triage";
import type { ScopeWindows } from "./plan-triage";
import type { TaskListRow } from "./list-filter";
import type { MindmapNode, NodeKind } from "./tree-layout";
import { testKey } from "@/test/scope-key";
import { scopeKeyText, type ScopeKeyText } from "@/utils/scope-key";
import type { ScopeKey } from "@/api/scopes";

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

const WEEK = { start: "2026-09-20T00:00:00", end: "2026-09-27T00:00:00" };
// Tuesday 22/09 and its morning, for a plan into a part of the day.
const TUESDAY = { start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00" };
const MORNING: ScopeKey = { kind: "part_of_day", date: "2026-09-22", part: "morning" };
const MORNING_WINDOWS: ScopeWindows = new Map([
  ...WINDOWS,
  [scopeKeyText(MORNING), { start: "2026-09-22T06:00:00", end: "2026-09-22T12:00:00" }],
]);
// The week's parent scope is the month, by id; a Season has none.
const MONTH_PARENT: ReadonlySet<ScopeKeyText> = new Set([scopeKeyText(testKey(4))]);
const NO_PARENT: ReadonlySet<ScopeKeyText> = new Set();
const SEASON = { start: "2026-09-01T00:00:00", end: "2026-12-01T00:00:00" };

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
  it("collects the row's own boundaries and its ancestors'", () => {
    const ids = referencedScopeIds([
      row({
        node: node("task-1", { timeScope: { start_id: testKey(1), end_id: testKey(3) } }),
        ancestors: [node("task-0", { plan: scope(4) })],
      }),
    ]);
    expect(ids.map(scopeKeyText).sort()).toEqual([testKey(1), testKey(3), testKey(4)].map(scopeKeyText));
  });
});

describe("partitionForScope", () => {
  it("offers an unplanned task whose own window is the scope", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(1) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.unplanned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.planned).toEqual([]);
  });

  it("offers an unplanned task whose window merely overlaps the scope", () => {
    const rows = [row({ node: node("task-1", { timeScope: { start_id: testKey(2), end_id: testKey(3) } }) })];
    expect(partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT).unplanned).toHaveLength(1);
  });

  it("offers an Unscoped task, which is always relevant", () => {
    expect(partitionForScope([row()], WEEK, WINDOWS, MONTH_PARENT).unplanned).toHaveLength(1);
  });

  it("offers a task relevant only through an inherited window", () => {
    const rows = [row({ ancestors: [node("goal-1", { timeScope: scope(1) }, "goal")] })];
    expect(partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT).unplanned).toHaveLength(1);
  });

  it("leaves out an unplanned task whose window is next week", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(3) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.unplanned).toEqual([]);
    expect(panes.planned).toEqual([]);
  });

  it("puts a task planned into the scope on the right", () => {
    const rows = [row({ node: node("task-1", { plan: scope(1) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.planned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.unplanned).toEqual([]);
  });

  it("counts a task planned into a day inside the scope as part of what the scope holds", () => {
    const rows = [row({ node: node("task-1", { plan: scope(2) }) })];
    expect(partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT).planned).toHaveLength(1);
  });

  it("puts a task planned elsewhere in neither pane", () => {
    const rows = [row({ node: node("task-1", { timeScope: scope(4), plan: scope(3) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.unplanned).toEqual([]);
    expect(panes.planned).toEqual([]);
    expect(panes.parentPlanned).toEqual([]);
  });

  // The month a week sits in: committed, but not to anywhere as fine as a week. That is the work a
  // pass over this week exists to place, and the left-hand pane opens on exactly it.
  it("puts a task planned to the month above the week on the parent-planned heap", () => {
    const rows = [row({ node: node("task-1", { plan: scope(4) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.parentPlanned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.planned).toEqual([]);
    expect(panes.unplanned).toEqual([]);
  });

  it("does not reach two rungs up: a plan on the season is not offered to a week", () => {
    const rows = [row({ node: node("task-1", { plan: scope(5) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.parentPlanned).toEqual([]);
    expect(panes.planned).toEqual([]);
    expect(panes.unplanned).toEqual([]);
  });

  // A Season is the top of the ladder: no parent, so no parent-planned heap, and the unplanned
  // relevant work is all there is to offer.
  it("has no parent-planned heap for a Season, and still offers the unplanned work", () => {
    const rows = [
      row({ node: node("task-1", { timeScope: scope(1) }) }),
      row({ node: node("task-2", { plan: scope(5) }) }),
    ];
    const panes = partitionForScope(rows, SEASON, WINDOWS, NO_PARENT);
    expect(panes.parentPlanned).toEqual([]);
    expect(panes.unplanned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.planned.map((r) => r.node.id)).toEqual(["task-2"]);
  });

  // Arlesh-3tt: October is a sibling of September, not its parent, so work planned there is
  // neither half of the candidates while September is being filled.
  it("offers nothing planned to October while filling September", () => {
    const september = WINDOWS.get(scopeKeyText(testKey(4)));
    if (september === undefined) throw new Error("fixture");
    const rows = [row({ node: node("task-1", { plan: scope(6) }) })];
    const panes = partitionForScope(rows, september, WINDOWS, new Set([scopeKeyText(testKey(5))]));
    expect(panes).toEqual({ unplanned: [], planned: [], parentPlanned: [] });
  });

  // The week of 27 September sits in both months, and is September's (see `parentRefs`): what is
  // planned to September is its parent-planned work, and what is planned to October is not. It is
  // contained by neither month, which is why the parent is matched by id rather than by containment.
  it("offers September's work and not October's to the week at their edge", () => {
    const edgeWeek = { start: "2026-09-27T00:00:00", end: "2026-10-04T00:00:00" };
    const rows = [
      row({ node: node("task-sep", { plan: scope(4) }) }),
      row({ node: node("task-oct", { plan: scope(6) }) }),
    ];
    const panes = partitionForScope(rows, edgeWeek, WINDOWS, MONTH_PARENT);
    expect(panes.parentPlanned.map((r) => r.node.id)).toEqual(["task-sep"]);
    expect(panes.unplanned).toEqual([]);
    expect(panes.planned).toEqual([]);
  });

  it("does not call a plan that *is* the scope its own parent", () => {
    const rows = [row({ node: node("task-1", { plan: scope(1) }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.planned.map((r) => r.node.id)).toEqual(["task-1"]);
    expect(panes.parentPlanned).toEqual([]);
  });

  it("triages no node that draws no row, which has nowhere to write a Plan", () => {
    const rows = [row({ node: node("check-1", { virtual: true }) })];
    const panes = partitionForScope(rows, WEEK, WINDOWS, MONTH_PARENT);
    expect(panes.unplanned).toEqual([]);
    expect(panes.planned).toEqual([]);
  });

  describe("a Habit occurrence", () => {
    function occurrence(extra: Partial<MindmapNode>): TaskListRow {
      return row({ node: node("occurrence-1", { ...occurrenceRow(), ...extra }) });
    }

    // No Cycle Plan means unplanned: its window says when it is relevant, not that it was planned.
    it("is an unplanned candidate where it has no Cycle Plan and its window is relevant", () => {
      const panes = partitionForScope([occurrence({ timeScope: scope(2) })], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes.unplanned.map((r) => r.node.id)).toEqual(["occurrence-1"]);
      expect(panes.planned).toEqual([]);
    });

    it("is not a candidate where its window is not relevant", () => {
      const panes = partitionForScope([occurrence({ timeScope: scope(3) })], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes).toEqual({ unplanned: [], planned: [], parentPlanned: [] });
    });

    it("is planned where its Plan sits inside the scope", () => {
      const panes = partitionForScope([occurrence({ timeScope: scope(4), plan: scope(2) })], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes.planned.map((r) => r.node.id)).toEqual(["occurrence-1"]);
    });

    // A Part-of-Day cycle planned to its own scope: the Plan is the occurrence's window itself.
    it("is planned where its Plan is its own window, inside the scope", () => {
      const panes = partitionForScope([occurrence({ timeScope: scope(2), plan: scope(2) })], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes.planned.map((r) => r.node.id)).toEqual(["occurrence-1"]);
      expect(panes.unplanned).toEqual([]);
    });

    it("is parent-planned where its Plan is the parent scope", () => {
      const panes = partitionForScope([occurrence({ timeScope: scope(4), plan: scope(4) })], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes.parentPlanned.map((r) => r.node.id)).toEqual(["occurrence-1"]);
    });

    // An item-less Habit (flow 18): its root is the only occurrence, planned into a part of the
    // day — this morning — and done, as a stored Task planned there and done would be.
    it("puts an item-less Habit's root, planned into a part of the day, in that scope's planned pane", () => {
      const morning = { start_id: MORNING, end_id: MORNING };
      const root = row({
        node: node("habit-root", {
          ...occurrenceRow({ itemType: "flow_root" }), timeScope: scope(2), plan: morning, status: "done",
        }),
      });
      const stored = row({ node: node("task-1", { timeScope: scope(2), plan: morning, status: "done" }) });
      const panes = partitionForScope([root, stored], TUESDAY, MORNING_WINDOWS, NO_PARENT);
      expect(panes.planned.map((r) => r.node.id)).toEqual(["habit-root", "task-1"]);
      expect(panes.unplanned).toEqual([]);
    });

    it("offers an unplanned root as a candidate, and its item occurrence beside it, once each", () => {
      const root = row({ node: node("habit-root", { ...occurrenceRow({ itemType: "flow_root" }), timeScope: scope(2) }) });
      const item = occurrence({ timeScope: scope(2) });
      const panes = partitionForScope([root, item], WEEK, WINDOWS, MONTH_PARENT);
      expect(panes.unplanned.map((r) => r.node.id)).toEqual(["habit-root", "occurrence-1"]);
      expect(panes.planned).toEqual([]);
    });
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

  it("lets an overdue task leave its own window, which has already passed", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(2), resolution: "overdue" }) });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBeNull();
  });

  it("still holds an overdue task to its nearest planned ancestor's Plan", () => {
    const rows = row({
      node: node("task-1", { timeScope: scope(2), resolution: "overdue" }),
      ancestors: [node("task-0", { plan: scope(2) })],
    });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("parentPlan");
  });

  it("does not exempt a task that lapsed done", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(2), resolution: "completed" }) });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("ownTimeScope");
  });

  it("does not exempt a task that lapsed missed", () => {
    const rows = row({ node: node("task-1", { timeScope: scope(2), resolution: "missed" }) });
    expect(planRefusal(rows, WEEK, WINDOWS)).toBe("ownTimeScope");
  });
});
