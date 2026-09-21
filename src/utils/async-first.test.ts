import { describe, it, expect } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskListRow } from "@/utils/list-filter";
import type { ListRowEntry } from "@/utils/list-data";
import { withAsynchronousSection } from "./async-first";

function node(id: string): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children: [] };
}

/** `a*` is asynchronous, anything else is not; the ancestors are given as ids, outermost first. */
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
    hasBlockedAncestor: false,
    isAgentic: false,
    isAsynchronous: id.startsWith("a"),
    hasPrivateAncestor: false,
    scopeTokens: [],
  };
}

/** The rendered shape, for assertions: the section as `~`, a header as `#a›b`, a task as `id:depth`. */
function shapeOf(entries: readonly ListRowEntry[]): string[] {
  return entries.map((entry) => {
    if (entry.type === "asynchronous") return "~";
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
      "~", "#goal›p", "a1:0",
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
      "~", "#goal›p", "a1:0",
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
      "~", "#goal", "a1:0", "c1:1", "c2:2",
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
      "~", "#goal", "a1:0", "#goal›hidden", "grandchild:1",
      "#goal", "s1:0",
    ]);
  });

  it("keeps pre-order within each half", () => {
    const entries = withAsynchronousSection([
      row("s1", ["goal"]), row("a1", ["goal"]), row("s2", ["goal"]), row("a2", ["goal"]),
    ]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "a2:0", "#goal", "s1:0", "s2:0"]);
  });

  it("draws no section at all — not an empty one — when nothing is asynchronous", () => {
    const entries = withAsynchronousSection([row("s1", ["goal"]), row("s2", ["goal", "s1"])]);
    expect(shapeOf(entries)).toEqual(["#goal", "s1:0", "s2:1"]);
  });

  it("leaves no stray headers below when every row is asynchronous", () => {
    const entries = withAsynchronousSection([row("a1", ["goal"]), row("a2", ["goal"])]);
    expect(shapeOf(entries)).toEqual(["~", "#goal", "a1:0", "a2:0"]);
  });

  it("returns an empty list unchanged", () => {
    expect(withAsynchronousSection([])).toEqual([]);
  });
});
