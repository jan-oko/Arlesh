import { describe, it, expect } from "vitest";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { canDescendInto, stepCardFields, stepChildCounts, stepRefusalKey } from "./steps-card";

function node(kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: `${kind}-1`, kind, title: kind, position: 0, tagIds: [], children: [], ...extra };
}

const WINDOW = { start_id: 7, end_id: 7 };

describe("the fields a card spells out", () => {
  it("are chosen by kind: a Task's flags, and none of them on a Goal", () => {
    const task = node("task", { status: "todo", backlogged: true, asynchronous: true });
    const goal = node("goal", { status: "active", backlogged: true, asynchronous: true });
    expect(stepCardFields(task)).toEqual(["status", "backlog", "asynchronous"]);
    expect(stepCardFields(goal)).toEqual(["status"]);
  });

  it("leave out what the node has no value for", () => {
    expect(stepCardFields(node("task"))).toEqual([]);
  });

  it("read the kind's own fields before the shared ones", () => {
    const task = node("task", { status: "todo", tagIds: [3], virtualBlockers: ["Blocked by Spec"] });
    expect(stepCardFields(task)).toEqual(["status", "blockedBy", "tags"]);
  });

  it("give a Commitment its verdict and its window, and never a Task's backlog", () => {
    const commitment = node("commitment", {
      verdict: "unresolved", verdictWindow: { n: 2, kind: "week" }, backlogged: true,
    });
    expect(stepCardFields(commitment)).toEqual(["verdict", "verdictWindow"]);
  });

  it("give an Info note its details — the one kind with free text", () => {
    expect(stepCardFields(node("info", { infoDetails: "a traceback" }))).toEqual(["details"]);
  });

  it("give a Habit its instance type and its recurrence", () => {
    const flow = node("flow", {
      flow: {
        instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "day",
        windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit: true,
        rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null,
        verdictWindowN: null, verdictWindowKind: null,
      },
    });
    expect(stepCardFields(flow)).toEqual(["instanceType", "recurrence"]);
  });

  it("read an inherited Agentic flag as a value, the way the badge row does", () => {
    expect(stepCardFields(node("task", { inheritedAgentic: true }))).toEqual(["agentic"]);
  });

  it("list a scope and a plan a Task carries", () => {
    const task = node("task", { timeScope: WINDOW, plan: WINDOW, onScopeExit: "archive" });
    expect(stepCardFields(task)).toEqual(["timeScope", "plan", "onScopeExit"]);
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

  it("refuses a childless Tag, which is a label rather than a container", () => {
    const tag = node("tag");
    expect(canDescendInto(tag)).toBe(false);
    expect(stepRefusalKey(tag)).toBe("refusedHoldsNothing");
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
