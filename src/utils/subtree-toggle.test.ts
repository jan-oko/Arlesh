import { describe, it, expect } from "vitest";
import { subtreeToggle } from "./subtree-toggle";
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

/** The set the canvas lays out with — `collapsedWithFoldedGroups`' answer — with `ids` drawn shut. */
function drawnShut(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

/** Nothing open at all: the two group nodes are drawn shut until opened, as the fold leaves them. */
const FOLDED = drawnShut("run", "week");

describe("subtreeToggle — which way it goes", () => {
  it("expands when the node it was pressed on is drawn shut", () => {
    const toggle = subtreeToggle(TREE, "goal", drawnShut("goal", "run", "week"));

    expect(toggle.direction).toBe("expand");
  });

  it("collapses when the node it was pressed on is drawn open", () => {
    const toggle = subtreeToggle(TREE, "goal", FOLDED);

    expect(toggle.direction).toBe("collapse");
  });

  it("reads a habit group's own inverted set, so a folded run expands", () => {
    // `run` is open in neither sense the user can see: it is absent from the opened set, which is
    // what puts it in the drawn-shut set.
    expect(subtreeToggle(TREE, "run", FOLDED).direction).toBe("expand");
  });

  it("collapses an opened run, whose id has left the drawn-shut set", () => {
    expect(subtreeToggle(TREE, "run", drawnShut("week")).direction).toBe("collapse");
  });

  it("collapses a leaf, which is drawn open because nothing put it in the set", () => {
    // Nothing is drawn differently — a leaf has nothing to hide — and the entry is inert until it
    // gains a child, exactly as a plain Ctrl+/ on a leaf already leaves one.
    expect(subtreeToggle(TREE, "task", FOLDED).direction).toBe("collapse");
  });

  it("is decided by the pressed node alone, not by a mixture underneath it", () => {
    // `goal` is open while the fold beneath it is shut: the press still collapses, because the
    // node's own state is what a second press has to be able to flip.
    expect(subtreeToggle(TREE, "goal", drawnShut("run", "week")).direction).toBe("collapse");
  });
});

describe("subtreeToggle — expanding", () => {
  const shut = drawnShut("goal", "run", "week");

  it("splits a subtree into the ids each of the two sets reads", () => {
    const toggle = subtreeToggle(TREE, "goal", shut);
    if (toggle.direction !== "expand") throw new Error("expected an expansion");

    expect([...toggle.collapsedIdsToClear].sort()).toEqual(["goal", "iteration", "task"]);
    expect([...toggle.habitGroupIdsToOpen].sort()).toEqual(["run", "week"]);
  });

  it("reaches every level of a fold from the run itself, not just the first", () => {
    const toggle = subtreeToggle(TREE, "run", FOLDED);
    if (toggle.direction !== "expand") throw new Error("expected an expansion");

    expect([...toggle.habitGroupIdsToOpen].sort()).toEqual(["run", "week"]);
  });

  it("includes the node it was pressed on, so a collapsed node opens itself", () => {
    const toggle = subtreeToggle(TREE, "task", drawnShut("task", "run", "week"));
    if (toggle.direction !== "expand") throw new Error("expected an expansion");

    expect([...toggle.collapsedIdsToClear]).toEqual(["task"]);
  });

  it("stops at the subtree it was pressed on", () => {
    const toggle = subtreeToggle(TREE, "elsewhere", drawnShut("elsewhere", "run", "week"));
    if (toggle.direction !== "expand") throw new Error("expected an expansion");

    expect([...toggle.collapsedIdsToClear]).toEqual(["elsewhere"]);
    expect(toggle.habitGroupIdsToOpen.size).toBe(0);
  });
});

describe("subtreeToggle — collapsing", () => {
  it("mirrors the expansion: the same ids, pointed the other way", () => {
    const toggle = subtreeToggle(TREE, "goal", drawnShut());
    if (toggle.direction !== "collapse") throw new Error("expected a collapse");

    expect([...toggle.collapsedIdsToAdd].sort()).toEqual(["goal", "iteration", "task"]);
    expect([...toggle.habitGroupIdsToShut].sort()).toEqual(["run", "week"]);
  });

  it("descends past the node it was pressed on, so what it shut stays shut", () => {
    // Shutting only `run` would leave `week` in the opened set, and the next single-node Ctrl+/ on
    // the run would show every iteration instead of the levels.
    const toggle = subtreeToggle(TREE, "run", drawnShut());
    if (toggle.direction !== "collapse") throw new Error("expected a collapse");

    expect([...toggle.habitGroupIdsToShut].sort()).toEqual(["run", "week"]);
    expect([...toggle.collapsedIdsToAdd]).toEqual(["iteration"]);
  });
});

describe("subtreeToggle — an id the drawn tree no longer holds", () => {
  it("touches nothing, because a keypress that finds nothing to act on is not an error", () => {
    const toggle = subtreeToggle(TREE, "filtered-away", FOLDED);
    if (toggle.direction !== "expand") throw new Error("expected the do-nothing expansion");

    expect(toggle.collapsedIdsToClear.size).toBe(0);
    expect(toggle.habitGroupIdsToOpen.size).toBe(0);
  });
});
