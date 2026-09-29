import { describe, it, expect } from "vitest";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { FilterState } from "@/utils/filter-tree";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import { zenContents } from "./zen-contents";
import type { ZenSourceRows, ZenStripsShown } from "./zen-contents";

function n(id: string, kind: NodeKind, over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], rowId: 1, ...over };
}

const root = n("root", "domain", {
  children: [
    n("goal-1", "goal", {
      status: "active",
      children: [
        n("task-doing", "task", {
          status: "in_progress",
          children: [n("task-doing-child", "task", { status: "in_progress", asynchronous: true })],
        }),
        n("task-todo", "task", { status: "todo" }),
        n("task-done", "task", { status: "done" }),
        n("task-second", "task", { status: "in_progress", tagIds: [7] }),
      ],
    }),
    n("commitment-open", "commitment", { verdict: "unresolved" }),
    n("commitment-kept", "commitment", { verdict: "kept" }),
    n("expectation-live", "expectation", { status: "pending" }),
    n("expectation-checked", "expectation", { status: "pending", checkEvery: { n: 1, kind: "day" } }),
    n("expectation-ahead", "expectation", { status: "pending", timing: "pending" }),
    n("expectation-released", "expectation", { status: "released" }),
  ],
});

const source: ZenSourceRows = {
  tasks: flattenTaskRows(root, []),
  commitments: flattenCommitmentRows(root),
  expectations: flattenExpectationRows(root),
};

const BOTH: ZenStripsShown = { commitments: true, expectations: true };

function ids(rows: ReadonlyArray<{ node: { id: string } }>): string[] {
  return rows.map((row) => row.node.id);
}

function read(shared: Partial<FilterState> = {}, strips: ZenStripsShown = BOTH, focusedId: string | null = null) {
  return zenContents(source, { ...DEFAULT_FILTER, ...shared }, strips, focusedId);
}

describe("zenContents", () => {
  it("shows the in-progress Tasks in plain board order, whatever the tab's own preset", () => {
    for (const statusMode of ["all", "plan", "start", "do", "backlog"] as const) {
      expect(ids(read({ statusMode }).tasks.rows)).toEqual(["task-doing", "task-doing-child", "task-second"]);
    }
  });

  it("puts the unresolved Commitments in their strip", () => {
    expect(ids(read().commitments.rows)).toEqual(["commitment-open"]);
  });

  it("puts the Expectations Start would show in their strip", () => {
    expect(ids(read().expectations.rows)).toEqual(["expectation-live", "expectation-checked"]);
  });

  it("honours Start hides waits that have checks in the Expectations strip", () => {
    expect(ids(read({ startHidesCheckedWaits: true }).expectations.rows)).toEqual(["expectation-live"]);
  });

  it("draws nothing in a strip the tab has hidden", () => {
    const contents = read({}, { commitments: false, expectations: false });
    expect(contents.commitments.rows).toEqual([]);
    expect(contents.expectations.rows).toEqual([]);
    expect(ids(contents.tasks.rows)).toHaveLength(3);
  });

  it("still applies the shared tag filter", () => {
    const contents = read({ tagFilters: [{ tagId: 7, mode: "all" }] });
    expect(ids(contents.tasks.rows)).toEqual(["task-second"]);
  });

  it("keeps the selected card when it stops matching, and says it is exempted", () => {
    const contents = read({}, BOTH, "task-done");
    expect(ids(contents.tasks.rows)).toEqual(["task-doing", "task-doing-child", "task-done", "task-second"]);
    expect(contents.tasks.exemptedIds).toEqual(new Set(["task-done"]));
  });
});
