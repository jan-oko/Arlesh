import { describe, it, expect } from "vitest";
import { subtreeExpansion } from "./recursive-expand";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children };
}

/** A node the fold drew: what marks it is `habitGroup`, which `isHabitGroupNode` reads. */
function group(id: string, children: MindmapNode[] = []): MindmapNode {
  return {
    id, kind: "habit_group", title: id, virtual: true, position: 0, tagIds: [], children,
    habitGroup: {
      flowId: 7, level: "run", passed: 2, done: 1, missed: 1,
      spanStart: "2026-09-08", spanEnd: "2026-09-16", spanLabel: "8–16 Sep",
    },
  };
}

// root ─┬─ goal ─┬─ run ─┬─ week ── iteration
//       │        └─ task
//       └─ elsewhere
const TREE = node("root", [
  node("goal", [group("run", [group("week", [node("iteration")])]), node("task")]),
  node("elsewhere"),
]);

describe("subtreeExpansion", () => {
  it("splits a subtree into the ids each of the two sets reads", () => {
    const { collapsedIdsToClear, habitGroupIdsToOpen } = subtreeExpansion(TREE, "goal");

    expect([...collapsedIdsToClear].sort()).toEqual(["goal", "iteration", "task"]);
    expect([...habitGroupIdsToOpen].sort()).toEqual(["run", "week"]);
  });

  it("reaches every level of a fold from the run itself, not just the first", () => {
    const { habitGroupIdsToOpen } = subtreeExpansion(TREE, "run");

    expect([...habitGroupIdsToOpen].sort()).toEqual(["run", "week"]);
  });

  it("includes the node it is asked about, so a collapsed node opens itself", () => {
    expect([...subtreeExpansion(TREE, "task").collapsedIdsToClear]).toEqual(["task"]);
  });

  it("stops at the subtree it was asked about", () => {
    const { collapsedIdsToClear, habitGroupIdsToOpen } = subtreeExpansion(TREE, "elsewhere");

    expect([...collapsedIdsToClear]).toEqual(["elsewhere"]);
    expect(habitGroupIdsToOpen.size).toBe(0);
  });

  it("expands nothing for an id the drawn tree no longer holds", () => {
    const { collapsedIdsToClear, habitGroupIdsToOpen } = subtreeExpansion(TREE, "filtered-away");

    expect(collapsedIdsToClear.size).toBe(0);
    expect(habitGroupIdsToOpen.size).toBe(0);
  });
});
