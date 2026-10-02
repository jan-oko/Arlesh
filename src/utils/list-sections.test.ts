import { describe, it, expect } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskListRow } from "@/utils/list-filter";
import type { ListRowEntry } from "@/utils/list-data";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { showsOverdueSection, withListSections } from "./list-sections";

/** `o*` (and `oa*`) is Overdue; nothing else is. */
function node(id: string): MindmapNode {
  return {
    id, kind: "task", title: id, position: 0, tagIds: [], children: [],
    ...(id.startsWith("o") ? { overdue: true } : {}),
    ...(id.startsWith("r") ? { status: "review", taskStatus: { kind: "agentic" as const, status: "review" as const } } : {}),
  };
}

/** The Asynchronous section alone — the setting on, the list not under Start. */
function withAsynchronousSection(rows: readonly TaskListRow[]): ListRowEntry[] {
  return withListSections(rows.map((row) => ({ type: "task" as const, row })), { review: false, overdue: false, asynchronous: true });
}

/** Both sections asked for, as under Start with Asynchronous first on. */
function withBothSections(rows: readonly TaskListRow[]): ListRowEntry[] {
  return withListSections(rows.map((row) => ({ type: "task" as const, row })), { review: false, overdue: true, asynchronous: true });
}

/** `a*` and `oa*` are asynchronous, anything else is not; the ancestors are given as ids, outermost
 * first. */
function row(id: string, ancestorIds: readonly string[] = []): TaskListRow {
  return {
    node: node(id),
    ancestors: ancestorIds.map(node),
    goalRef: null,
    goalStatus: null,
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    heldByBlockedAncestor: false,
    isAgentic: false,
    isAsynchronous: id.startsWith("a") || id.startsWith("oa"),
    hasPrivateAncestor: false,
    scopeTokens: [],
  };
}

/** The rendered shape, for assertions: the Asynchronous heading as `~` and its closing rule as `—`,
 * the Overdue heading as `!` and its rule as `=`, a header as `#a›b`, a task as `id:depth`. */
function shapeOf(entries: readonly ListRowEntry[]): string[] {
  return entries.map((entry) => {
    if (entry.type === "asynchronous") return "~";
    if (entry.type === "asynchronousEnd") return "—";
    if (entry.type === "overdue") return "!";
    if (entry.type === "overdueEnd") return "=";
    if (entry.type === "review") return "?";
    if (entry.type === "reviewEnd") return "_";
    if (entry.type === "path") return `#${entry.segments.map((segment) => segment.id).join("›")}`;
    return `${entry.row.node.id}:${entry.visibleDepth}`;
  });
}

describe("withAsynchronousSection", () => {
  it("lifts an asynchronous row out of its run into a section at the top of the list", () => {
    // The situation the section exists for: one asynchronous task, alone among its siblings, deep
    // in a subtree. Under the old per-sibling partition it had nothing to overtake and never moved.
    const entries = withAsynchronousSection([
      row("p", ["goal"]),
      row("s1", ["goal", "p"]),
      row("a1", ["goal", "p"]),
      row("s2", ["goal", "p"]),
    ]);
    expect(shapeOf(entries)).toEqual([
      "~", "#goal›p", "a1:0", "—",
      "#goal", "p:0", "s1:1", "s2:1",
    ]);
  });

  it("names the parent a lifted row left behind in the section's own path header", () => {
    const entries = withAsynchronousSection([
      row("p", ["goal"]),
      row("s1", ["goal", "p"]),
      row("a1", ["goal", "p"]),
    ]);
    expect(shapeOf(entries)).toEqual([
      "~", "#goal›p", "a1:0", "—",
      "#goal", "p:0", "s1:1",
    ]);
  });

  it("moves a row rather than duplicating it", () => {
    const entries = withAsynchronousSection([row("s1"), row("a1")]);
    const ids = entries.filter((entry) => entry.type === "task").map((entry) => entry.row.node.id);
    expect(ids).toEqual(["a1", "s1"]);
  });

  it("carries a lifted row's whole subtree with it, indentation intact", () => {
    const entries = withAsynchronousSection([
      row("a1", ["goal"]),
      row("c1", ["goal", "a1"]),
      row("c2", ["goal", "a1", "c1"]),
      row("s1", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual([
      "~", "#goal", "a1:0", "c1:1", "c2:2", "—",
      "#goal", "s1:0",
    ]);
  });

  it("lifts an outer asynchronous subtree once, nesting and all, and nothing lifts twice", () => {
    const entries = withAsynchronousSection([
      row("a1", ["goal"]),
      row("s1", ["goal", "a1"]),
      row("a2", ["goal", "a1", "s1"]),
    ]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "s1:1", "a2:2"]);
  });

  it("keeps a descendant of a lifted row with it even when the row between them was filtered out", () => {
    const entries = withAsynchronousSection([
      row("a1", ["goal"]),
      row("grandchild", ["goal", "a1", "hidden"]),
      row("s1", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual([
      "~", "#goal", "a1:0", "#goal›hidden", "grandchild:1", "—",
      "#goal", "s1:0",
    ]);
  });

  it("keeps pre-order within each half", () => {
    const entries = withAsynchronousSection([
      row("s1", ["goal"]), row("a1", ["goal"]), row("s2", ["goal"]), row("a2", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "a2:0", "—", "#goal", "s1:0", "s2:0"]);
  });

  it("draws no section at all — not an empty one — when nothing is asynchronous", () => {
    const entries = withAsynchronousSection([row("s1", ["goal"]), row("s2", ["goal", "s1"])]);
    expect(shapeOf(entries)).toEqual(["#goal", "s1:0", "s2:1"]);
  });

  it("leaves no stray header and no closing rule below when every row is asynchronous", () => {
    // Nothing follows the section, so a rule under it would be a line drawn into empty space.
    const entries = withAsynchronousSection([row("a1", ["goal"]), row("a2", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "a2:0"]);
  });

  it("returns an empty list unchanged", () => {
    expect(withAsynchronousSection([])).toEqual([]);
  });
});

describe("withListSections with the Overdue section", () => {
  it("lifts an Overdue row into a section above the Asynchronous one", () => {
    const entries = withBothSections([
      row("s1", ["goal"]),
      row("a1", ["goal"]),
      row("o1", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual([
      "!", "#goal", "o1:0", "=",
      "~", "#goal", "a1:0", "—",
      "#goal", "s1:0",
    ]);
  });

  it("puts a row that is both Overdue and asynchronous in the Overdue section, once", () => {
    const entries = withBothSections([row("oa1", ["goal"]), row("s1", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["!", "#goal", "oa1:0", "=", "#goal", "s1:0"]);
  });

  it("carries an Overdue row's subtree with it, asynchronous children included", () => {
    const entries = withBothSections([
      row("o1", ["goal"]),
      row("a1", ["goal", "o1"]),
      row("s1", ["goal", "o1"]),
      row("s2", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual(["!", "#goal", "o1:0", "a1:1", "s1:1", "=", "#goal", "s2:0"]);
  });

  it("draws no Overdue heading when nothing is Overdue", () => {
    const entries = withBothSections([row("a1", ["goal"]), row("s1", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "—", "#goal", "s1:0"]);
  });

  it("closes the Overdue section when only the Asynchronous section follows it", () => {
    const entries = withBothSections([row("o1", ["goal"]), row("a1", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["!", "#goal", "o1:0", "=", "~", "#goal", "a1:0"]);
  });

  it("draws no closing rule when every row is Overdue", () => {
    const entries = withBothSections([row("o1", ["goal"]), row("o2", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["!", "#goal", "o1:0", "o2:0"]);
  });

  it("leaves an Overdue row where the tree put it when the section is not asked for", () => {
    const entries = withAsynchronousSection([row("s1", ["goal"]), row("o1", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["#goal", "s1:0", "o1:0"]);
  });
});

describe("showsOverdueSection", () => {
  const start = { ...DEFAULT_FILTER, statusMode: "start" as const };

  it("draws it under Start while the setting is on", () => {
    expect(showsOverdueSection(true, start, { ...DEFAULT_LIST_FILTER, preset: "start" })).toBe(true);
  });

  it("does not draw it with the setting off", () => {
    expect(showsOverdueSection(false, start, { ...DEFAULT_LIST_FILTER, preset: "start" })).toBe(false);
  });

  it("does not draw it under any other preset", () => {
    for (const statusMode of ["all", "plan", "do", "backlog"] as const) {
      expect(showsOverdueSection(true, { ...DEFAULT_FILTER, statusMode }, { ...DEFAULT_LIST_FILTER, preset: statusMode }))
        .toBe(false);
    }
  });

  it("does not draw it under the Unblock or Expectations option, which replace Start's question", () => {
    for (const preset of ["unblock", "expectations"] as const) {
      expect(showsOverdueSection(true, start, { ...DEFAULT_LIST_FILTER, preset })).toBe(false);
    }
  });
});

describe("the Review section", () => {
  function withReview(rows: readonly TaskListRow[]): ListRowEntry[] {
    return withListSections(rows.map((row) => ({ type: "task" as const, row })), { review: true, overdue: true, asynchronous: false });
  }

  it("leads, above Overdue, carrying each Review task with its subtree", () => {
    expect(shapeOf(withReview([row("x"), row("o1"), row("r1"), row("y", ["r1"])]))).toEqual([
      "?", "r1:0", "y:1", "_", "!", "o1:0", "=", "x:0",
    ]);
  });

  it("draws nothing when no task reads Review", () => {
    expect(shapeOf(withReview([row("x")]))).toEqual(["x:0"]);
  });
});
