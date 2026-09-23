import { describe, it, expect } from "vitest";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import {
  glyphNamesKind,
  bulletCapacity, canDescendInto, infoBullets, infoChildTitles, stepCardFields, stepChildCounts,
  stepRefusalKey,
} from "./steps-card";

function node(kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: `${kind}-1`, kind, title: kind, position: 0, tagIds: [], children: [], ...extra };
}

const WINDOW = { start_id: 7, end_id: 7 };

describe("the fields a card spells out", () => {
  it("never repeat the icon: a Task's status is the glyph, so it is not also a field", () => {
    const task = node("task", { status: "todo", timeScope: WINDOW });
    expect(stepCardFields(task)).toEqual(["timeScope"]);
  });

  it("never repeat the badge row: the three Task flags are badges, so they are not also fields", () => {
    const task = node("task", { backlogged: true, asynchronous: true, inheritedAgentic: true });
    expect(stepCardFields(task)).toEqual([]);
  });

  it("keeps the value behind a badge — the clock says a Task has a window, not which one", () => {
    expect(stepCardFields(node("task", { timeScope: WINDOW, plan: WINDOW }))).toEqual(["timeScope", "plan"]);
  });

  it("reads the kind's own fields before the shared ones", () => {
    const task = node("task", { timeScope: WINDOW, tagIds: [3], virtualBlockers: ["Blocked by Spec"] });
    expect(stepCardFields(task)).toEqual(["timeScope", "blockedBy", "tags"]);
  });

  it("gives a Commitment its window but not its verdict, which the shield already draws", () => {
    const commitment = node("commitment", {
      verdict: "unresolved", verdictWindow: { n: 2, kind: "week" }, backlogged: true,
    });
    expect(stepCardFields(commitment)).toEqual(["verdictWindow"]);
  });

  it("gives an Info note its details — the one kind with free text", () => {
    expect(stepCardFields(node("info", { infoDetails: "a traceback" }))).toEqual(["details"]);
  });

  it("keeps a Project's status, which no icon and no badge carries", () => {
    expect(stepCardFields(node("project", { status: "active" }))).toEqual(["status"]);
  });

  it("gives a Habit its instance type but not its recurrence, which the glyph already is", () => {
    const flow = node("flow", {
      flow: {
        instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "day",
        windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: true,
        rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null,
        verdictWindowN: null, verdictWindowKind: null,
      },
    });
    expect(stepCardFields(flow)).toEqual(["instanceType"]);
  });

  it("leaves out what the node has no value for", () => {
    expect(stepCardFields(node("task"))).toEqual([]);
  });
});

describe("how many Info notes fit", () => {
  it("falls as the fields above them take the room", () => {
    const tall = bulletCapacity(240, 0);
    expect(bulletCapacity(240, 2)).toBe(tall - 2);
  });

  it("is none on a card with no room left", () => {
    expect(bulletCapacity(108, 8)).toBe(0);
  });

  it("grows with the card", () => {
    expect(bulletCapacity(240, 1)).toBeGreaterThan(bulletCapacity(108, 1));
  });
});

describe("the Info notes a card draws", () => {
  it("shows them all when they fit", () => {
    expect(infoBullets(["a", "b"], 3)).toEqual({ shown: ["a", "b"], more: 0 });
  });

  it("spends the last line saying what is left, rather than dropping it in silence", () => {
    expect(infoBullets(["a", "b", "c", "d"], 3)).toEqual({ shown: ["a", "b"], more: 2 });
  });

  it("says only the count when there is room for one line and more than one note", () => {
    expect(infoBullets(["a", "b"], 1)).toEqual({ shown: [], more: 2 });
  });

  it("reports everything as missing when there is no room at all", () => {
    expect(infoBullets(["a", "b"], 0)).toEqual({ shown: [], more: 2 });
  });
});

describe("a node's Info children", () => {
  it("are the info-kind children, in the order they are drawn", () => {
    const parent = node("goal", {
      children: [node("task"), node("info", { id: "info-1", title: "first" }),
        node("info", { id: "info-2", title: "second" })],
    });
    expect(infoChildTitles(parent)).toEqual(["first", "second"]);
  });
});

describe("a container card's count", () => {
  it("reads matching of total, so the filter's effect is visible", () => {
    const filtered = node("goal", { children: [node("task")] });
    const raw = node("goal", { children: [node("task"), node("task"), node("task")] });
    expect(stepChildCounts(filtered, raw)).toEqual({ matching: 1, total: 3 });
  });

  it("falls back to what it can see when the node is not in the raw tree", () => {
    const filtered = node("goal", { children: [node("task")] });
    expect(stepChildCounts(filtered, undefined)).toEqual({ matching: 1, total: 1 });
  });
});

describe("what you can descend into", () => {
  it("opens a node that already holds something", () => {
    expect(canDescendInto(node("tag", { children: [node("info")] }))).toBe(true);
  });

  it("opens a childless Task, so a leaf is not a dead end", () => {
    expect(canDescendInto(node("task"))).toBe(true);
  });

  it("opens a childless Info note, which holds info notes of its own", () => {
    expect(canDescendInto(node("info"))).toBe(true);
  });

  it("opens a virtual Habit occurrence, which takes children through the attachment path", () => {
    const occurrence = node("task", {
      id: "task-9", virtual: true,
      habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 0 },
    });
    expect(canDescendInto(occurrence)).toBe(true);
  });

  it("opens a childless Tag, which holds notes about itself", () => {
    // Arlesh-71m taught `isValidDropTarget` that a tag takes info children. A Tag was the one real
    // node this view refused, and it is not one any more — so the rule is now simply "a drawing
    // has no inside, everything else does".
    expect(canDescendInto(node("tag"))).toBe(true);
  });

  it("refuses a childless drawing, which has no inside at all", () => {
    const folded = node("habit_group", {
      id: "habit_group-1",
      habitGroup: {
        flowId: 1, level: "run", passed: 9, done: 5, missed: 4,
        spanStart: "2026-01-01", spanEnd: "2026-02-01", spanLabel: "January",
      },
    });
    expect(canDescendInto(folded)).toBe(false);
    expect(stepRefusalKey(folded)).toBe("refusedNotStored");
  });
});

describe("whether a card writes out its kind", () => {
  it("does not, where the glyph already says it", () => {
    for (const kind of ["aspect", "domain", "project", "goal", "task", "commitment", "tag", "info", "flow"] as const) {
      expect(glyphNamesKind(kind)).toBe(true);
    }
  });

  it("does, for a Flow's template Goal and Task, which borrow the Goal and Task glyphs", () => {
    expect(glyphNamesKind("flow_goal")).toBe(false);
    expect(glyphNamesKind("flow_task")).toBe(false);
  });
});
