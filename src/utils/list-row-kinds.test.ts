import { describe, it, expect } from "vitest";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import {
  DEFAULT_LIST_FILTER, LIST_ROW_KINDS, filterCommitmentList, filterExpectationList, filterTaskList,
  readRowKinds, rowKindToggleRefusal, withCurrentPillDimensions, withRowKindToggled,
} from "@/utils/list-filter";
import type { ListFilterState, ListRowKind } from "@/utils/list-filter";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

function n(id: string, kind: NodeKind, over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], rowId: 1, ...over };
}

const root = n("root", "domain", {
  children: [
    n("task", "task", { status: "todo" }),
    n("commitment", "commitment"),
    n("wait", "expectation", { status: "pending" }),
  ],
});

const list = (over: Partial<ListFilterState>): ListFilterState => ({ ...DEFAULT_LIST_FILTER, ...over });

/** Every row the list keeps, of all three kinds. */
function shownIds(listFilter: ListFilterState): string[] {
  return [
    ...filterTaskList(flattenTaskRows(root, []), DEFAULT_FILTER, listFilter),
    ...filterCommitmentList(flattenCommitmentRows(root), DEFAULT_FILTER, listFilter),
    ...filterExpectationList(flattenExpectationRows(root), DEFAULT_FILTER, listFilter),
  ].map((row) => row.node.id);
}

describe("the row-kind selection", () => {
  it("shows every kind by default", () => {
    expect(DEFAULT_LIST_FILTER.kinds).toEqual(["task", "commitment", "expectation"]);
    expect(shownIds(DEFAULT_LIST_FILTER)).toEqual(["task", "commitment", "wait"]);
  });

  it.each([
    [["commitment", "expectation"], ["commitment", "wait"]],
    [["task", "expectation"], ["task", "wait"]],
    [["task", "commitment"], ["task", "commitment"]],
    [["expectation"], ["wait"]],
  ] as const)("with %j shown, keeps %j", (kinds, ids) => {
    expect(shownIds(list({ kinds: [...kinds] }))).toEqual(ids);
  });

  it("narrows on top of the preset rather than replacing it", () => {
    const done = n("root", "domain", { children: [n("done", "task", { status: "done" })] });
    const rows = flattenTaskRows(done, []);
    expect(filterTaskList(rows, { ...DEFAULT_FILTER, statusMode: "plan" }, list({ kinds: ["task"] }))).toEqual([]);
  });

  it("is ignored under the Expectations option, which already shows waits and nothing else", () => {
    expect(shownIds(list({ preset: "expectations", kinds: ["task"] }))).toEqual(["wait"]);
  });

  it("still applies under Unblock: with Tasks hidden there is nothing left to show", () => {
    const blocked = n("root", "domain", { children: [n("stuck", "task", { status: "todo", blockReasons: ["x"] })] });
    const rows = flattenTaskRows(blocked, []);
    expect(filterTaskList(rows, DEFAULT_FILTER, list({ preset: "unblock" }))).toHaveLength(1);
    expect(filterTaskList(rows, DEFAULT_FILTER, list({ preset: "unblock", kinds: ["commitment"] }))).toEqual([]);
  });
});

describe("toggling a row kind", () => {
  it("flips one kind and keeps the canonical order", () => {
    expect(withRowKindToggled(["task", "commitment", "expectation"], "commitment")).toEqual(["task", "expectation"]);
    expect(withRowKindToggled(["expectation"], "task")).toEqual(["task", "expectation"]);
  });

  it("refuses to hide the last kind shown", () => {
    for (const kind of LIST_ROW_KINDS) {
      expect(rowKindToggleRefusal(list({ kinds: [kind] }), kind)).toBe("lastKind");
    }
    expect(rowKindToggleRefusal(list({ kinds: ["task"] }), "commitment")).toBeNull();
    expect(rowKindToggleRefusal(DEFAULT_LIST_FILTER, "task")).toBeNull();
  });

  it("refuses every kind under the Expectations option", () => {
    for (const kind of LIST_ROW_KINDS) {
      expect(rowKindToggleRefusal(list({ preset: "expectations" }), kind)).toBe("expectationsOption");
    }
  });
});

describe("reading a stored row-kind selection", () => {
  it("reads a tab stored before the selector existed as every kind", () => {
    expect(withCurrentPillDimensions({ preset: "do", pills: {} }).kinds).toEqual([...LIST_ROW_KINDS]);
  });

  it.each([
    [undefined, [...LIST_ROW_KINDS]],
    [[], [...LIST_ROW_KINDS]],
    ["task", [...LIST_ROW_KINDS]],
    [["bogus"], [...LIST_ROW_KINDS]],
    [["expectation", "task", "task", "bogus"], ["task", "expectation"]],
  ] as const)("reads %j as %j", (stored, expected) => {
    const kinds: ListRowKind[] = readRowKinds(stored);
    expect(kinds).toEqual(expected);
  });
});
