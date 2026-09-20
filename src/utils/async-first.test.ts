import { describe, it, expect } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskListRow } from "@/utils/list-filter";
import type { ListRowEntry } from "@/utils/list-data";
import { withAsynchronousFirst } from "./async-first";

function node(id: string): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children: [] };
}

function row(id: string, isAsynchronous: boolean): TaskListRow {
  return {
    node: node(id),
    ancestors: [],
    goalRef: null,
    goalStatus: null,
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    hasBlockedAncestor: false,
    isAgentic: false,
    isAsynchronous,
    hasPrivateAncestor: false,
    scopeTokens: [],
  };
}

/** `a*` is asynchronous, anything else is not; the digits after a colon are the visible depth. */
function task(spec: string): ListRowEntry {
  const [id = "", depth = "0"] = spec.split(":");
  return { type: "task", row: row(id, id.startsWith("a")), visibleDepth: Number(depth) };
}

function header(key: string): ListRowEntry {
  return { type: "path", pathKey: key, segments: [node(key)] };
}

/** The rendered shape, for assertions: a header as `#key`, a task as its id at its depth. */
function shapeOf(entries: readonly ListRowEntry[]): string[] {
  return entries.map((entry) =>
    entry.type === "path" ? `#${entry.pathKey}` : `${entry.row.node.id}:${entry.visibleDepth}`,
  );
}

describe("withAsynchronousFirst", () => {
  it("floats the asynchronous rows to the top of their run", () => {
    const entries = [header("p"), task("s1:0"), task("a1:0"), task("s2:0"), task("a2:0")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual([
      "#p", "a1:0", "a2:0", "s1:0", "s2:0",
    ]);
  });

  it("is stable: rows that do not move past each other keep their order", () => {
    const entries = [task("s1:0"), task("s2:0"), task("s3:0")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual(["s1:0", "s2:0", "s3:0"]);
  });

  it("never moves a row across a path header, and changes no run's membership", () => {
    const entries = [
      header("p"), task("s1:0"), task("a1:0"),
      header("q"), task("s2:0"), task("a2:0"),
    ];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual([
      "#p", "a1:0", "s1:0",
      "#q", "a2:0", "s2:0",
    ]);
  });

  it("leaves every header exactly where it was, in the same order", () => {
    const entries = [header("p"), task("a1:0"), header("q"), task("s1:0"), header("r")];
    const headers = (list: readonly ListRowEntry[]) =>
      list.map((e, i) => (e.type === "path" ? `${i}:${e.pathKey}` : null)).filter((x) => x !== null);
    expect(headers(withAsynchronousFirst(entries))).toEqual(headers(entries));
  });

  it("carries a subtree with the row it hangs from rather than hoisting a child over its parent", () => {
    // `a1` leads, and its child comes with it — the indentation names a parent the reader expects
    // to find directly above, so a lifted child would point at a row that is no longer there.
    const entries = [task("s1:0"), task("s1a:1"), task("a1:0"), task("a1a:1")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual([
      "a1:0", "a1a:1", "s1:0", "s1a:1",
    ]);
  });

  it("reorders a nested row among its own siblings, not against the whole run", () => {
    // `a2` is a child of `s1`; it leads its siblings, and does not jump over `s1` to lead the run.
    const entries = [task("s1:0"), task("s2:1"), task("a2:1"), task("s3:0")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual([
      "s1:0", "a2:1", "s2:1", "s3:0",
    ]);
  });

  it("handles a run that opens deeper than it later goes", () => {
    // A run's first row can be a child of a row in an earlier run, so the depths need not start at
    // zero — and a shallower row after it is another root rather than a child of nothing.
    const entries = [task("s1:1"), task("a1:1"), task("s2:0")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual(["a1:1", "s1:1", "s2:0"]);
  });

  it("leaves a list with nothing asynchronous in it untouched", () => {
    const entries = [header("p"), task("s1:0"), task("s2:1"), task("s3:0")];
    expect(shapeOf(withAsynchronousFirst(entries))).toEqual(shapeOf(entries));
  });

  it("returns an empty list unchanged", () => {
    expect(withAsynchronousFirst([])).toEqual([]);
  });
});
