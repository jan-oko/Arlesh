import { describe, it, expect } from "vitest";
import type { ScopeWindows } from "./scope-interval";
import type { MindmapNode, NodeKind } from "./tree-layout";
import type { ScopeAxis, ScopeMatch, ScopeSelection } from "./scope-match";
import {
  inheritedWindow, isScopeSelection, ownWindow, passesScope, referencedScopeIdsInTree,
  resolveScopeFilter, timeScopeWindow, windowMatches,
} from "./scope-match";

// Windows on the 02:00 ladder boundary, as `canonical_bounds` resolves them: 1 = W35, 2 = a
// Wednesday inside it, 3 = the season around it, 4 = W36, 5 = a day in September.
const WINDOWS: ScopeWindows = new Map([
  [1, { start: "2026-08-24T02:00:00", end: "2026-08-31T02:00:00" }],
  [2, { start: "2026-08-26T02:00:00", end: "2026-08-27T02:00:00" }],
  [3, { start: "2026-06-01T02:00:00", end: "2026-09-01T02:00:00" }],
  [4, { start: "2026-08-31T02:00:00", end: "2026-09-07T02:00:00" }],
  [5, { start: "2026-09-03T02:00:00", end: "2026-09-04T02:00:00" }],
]);

const WEEK = WINDOWS.get(1) ?? { start: "", end: "" };
const WEDNESDAY = WINDOWS.get(2) ?? { start: "", end: "" };
const SEASON = WINDOWS.get(3) ?? { start: "", end: "" };
const NEXT_WEEK = WINDOWS.get(4) ?? { start: "", end: "" };

function node(kind: NodeKind, scopeId: number | null, planId: number | null = null): MindmapNode {
  return {
    id: `${kind}-1`,
    kind,
    title: kind,
    position: 0,
    tagIds: [],
    children: [],
    ...(scopeId === null ? {} : { timeScope: { start_id: scopeId, end_id: scopeId } }),
    ...(planId === null ? {} : { plan: { start_id: planId, end_id: planId } }),
  };
}

function selection(axis: ScopeAxis, match: ScopeMatch, start = 1, end = start): ScopeSelection {
  return { startId: start, endId: end, axis, match };
}

function judge(item: MindmapNode, sel: ScopeSelection, inherited = null as number | null): boolean {
  const scope = resolveScopeFilter(sel, WINDOWS);
  const ancestors = inherited === null ? [] : [node("goal", inherited)];
  return passesScope(item, inheritedWindow(ancestors, WINDOWS), scope);
}

describe("windowMatches", () => {
  it("keeps a day inside the week under Within and drops the season around it", () => {
    expect(windowMatches(WEDNESDAY, WEEK, "within")).toBe(true);
    expect(windowMatches(SEASON, WEEK, "within")).toBe(false);
  });

  it("keeps both the day inside the week and the season around it under Overlapping", () => {
    expect(windowMatches(WEDNESDAY, WEEK, "overlapping")).toBe(true);
    expect(windowMatches(SEASON, WEEK, "overlapping")).toBe(true);
  });

  it("does not overlap the week that starts where this one ends", () => {
    expect(windowMatches(NEXT_WEEK, WEEK, "overlapping")).toBe(false);
  });

  it("holds a week inside itself, which is what a single-scope selection asks", () => {
    expect(windowMatches(WEEK, WEEK, "within")).toBe(true);
  });
});

describe("timeScopeWindow", () => {
  it("reads a range as one window, from the first start to the last end", () => {
    expect(timeScopeWindow({ start_id: 1, end_id: 4 }, WINDOWS)).toEqual({
      start: "2026-08-24T02:00:00",
      end: "2026-09-07T02:00:00",
    });
  });

  it("is null while an endpoint has not resolved", () => {
    expect(timeScopeWindow({ start_id: 1, end_id: 99 }, WINDOWS)).toBeNull();
  });
});

describe("resolveScopeFilter", () => {
  it("is null with no selection, so nothing is narrowed", () => {
    expect(resolveScopeFilter(null, WINDOWS)).toBeNull();
  });

  it("is null while the picked scope has not resolved, rather than emptying the board", () => {
    expect(resolveScopeFilter(selection("relevance", "within", 99), WINDOWS)).toBeNull();
  });
});

describe("passesScope on the relevance axis", () => {
  it("compares the item's own window when it has one", () => {
    expect(judge(node("task", 2), selection("relevance", "within"))).toBe(true);
    expect(judge(node("task", 3), selection("relevance", "within"))).toBe(false);
    expect(judge(node("task", 3), selection("relevance", "overlapping"))).toBe(true);
  });

  it("reads the nearest scoped ancestor when the item carries no window of its own", () => {
    expect(judge(node("task", null), selection("relevance", "within"), 2)).toBe(true);
    expect(judge(node("task", null), selection("relevance", "within"), 3)).toBe(false);
  });

  it("prefers the item's own window over the one it would have inherited", () => {
    expect(judge(node("task", 5), selection("relevance", "overlapping"), 2)).toBe(false);
  });

  it("treats an Unscoped item as always relevant, so it overlaps all and is within none", () => {
    expect(judge(node("task", null), selection("relevance", "overlapping"))).toBe(true);
    expect(judge(node("task", null), selection("relevance", "within"))).toBe(false);
  });

  it("judges a Commitment the same way it judges a Task", () => {
    expect(judge(node("commitment", 2), selection("relevance", "within"))).toBe(true);
    expect(judge(node("commitment", 3), selection("relevance", "within"))).toBe(false);
  });
});

describe("passesScope on the plan axis", () => {
  it("reads the Plan and never the Time Scope", () => {
    expect(judge(node("task", 3, 2), selection("plan", "within"))).toBe(true);
    expect(judge(node("task", 2, 5), selection("plan", "within"))).toBe(false);
  });

  it("drops an unplanned item, whatever its window says", () => {
    expect(judge(node("task", 2), selection("plan", "within"))).toBe(false);
    expect(judge(node("task", 2), selection("plan", "overlapping"))).toBe(false);
  });

  it("never inherits a Plan from an ancestor", () => {
    expect(judge(node("task", null), selection("plan", "overlapping"), 2)).toBe(false);
  });

  it("drops a Goal and a Commitment, neither of which is ever planned", () => {
    expect(judge(node("goal", 2), selection("plan", "overlapping"))).toBe(false);
    expect(judge(node("commitment", 2), selection("plan", "overlapping"))).toBe(false);
  });
});

describe("passesScope on what cannot answer", () => {
  it("never judges a container, which has no window of its own", () => {
    for (const kind of ["domain", "project", "aspect", "tag"] as const) {
      expect(judge(node(kind, null), selection("relevance", "within"))).toBe(true);
    }
  });

  it("judges nothing when no scope is selected", () => {
    expect(passesScope(node("task", 3), null, null)).toBe(true);
  });
});

describe("ownWindow", () => {
  it("is null both for an item with no scope and for one whose scope has not resolved", () => {
    expect(ownWindow(node("task", null), WINDOWS)).toBeNull();
    expect(ownWindow(node("task", 99), WINDOWS)).toBeNull();
  });
});

describe("inheritedWindow", () => {
  it("takes the nearest scoped ancestor, not the outermost", () => {
    const chain = [node("goal", 3), node("goal", 1), node("goal", null)];
    expect(inheritedWindow(chain, WINDOWS)).toEqual(WEEK);
  });

  it("is null when nothing above the item is scoped", () => {
    expect(inheritedWindow([node("domain", null)], WINDOWS)).toBeNull();
  });
});

describe("referencedScopeIdsInTree", () => {
  it("collects every node's own boundaries and Plan, plus the selection's own", () => {
    const root = { ...node("domain", null), children: [node("task", 2, 5)] };
    const ids = referencedScopeIdsInTree(root, selection("relevance", "within", 1, 4));
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 4, 5]);
  });

  it("collects nothing from the selection when there is none", () => {
    expect(referencedScopeIdsInTree(node("task", null), null)).toEqual([]);
  });
});

describe("isScopeSelection", () => {
  it("rejects a stored selection naming an axis or match rule this build cannot express", () => {
    expect(isScopeSelection({ startId: 1, endId: 1, axis: "relevance", match: "within" })).toBe(true);
    expect(isScopeSelection({ startId: 1, endId: 1, axis: "urgency", match: "within" })).toBe(false);
    expect(isScopeSelection({ startId: 1, endId: 1, axis: "relevance", match: "touching" })).toBe(false);
    expect(isScopeSelection({ startId: "1", endId: 1, axis: "relevance", match: "within" })).toBe(false);
    expect(isScopeSelection(null)).toBe(false);
  });
});
