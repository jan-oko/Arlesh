import { describe, it, expect } from "vitest";
import { occurrenceRow } from "@/test/occurrence";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { canParentNewChild, isValidDropTarget, validTypesForCycling } from "@/utils/node-meta";
import { pasteRefusal, PASTE_REFUSAL } from "@/utils/paste-refusal";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { FilterState } from "@/utils/filter-tree";
import { DEFAULT_LIST_FILTER, filterExpectationList, isListOnlyPreset } from "@/utils/list-filter";
import type { ExpectationListRow, ListFilterState } from "@/utils/list-filter";
import { flattenExpectationRows } from "@/utils/list-data";

function n(id: string, kind: NodeKind, over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], rowId: 1, ...over };
}

/** A node drawn from no row of its own. */
function drawn(id: string, kind: NodeKind, over: Partial<MindmapNode>): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...over };
}

describe("where a wait may hang", () => {
  it("hangs anywhere a Task can, and holds only notes", () => {
    for (const parent of ["aspect", "domain", "project", "goal", "task", "commitment"] as const) {
      expect(isValidDropTarget("expectation", parent)).toBe(true);
    }
    for (const parent of ["tag", "info", "expectation", "flow"] as const) {
      expect(isValidDropTarget("expectation", parent)).toBe(false);
    }
    expect(isValidDropTarget("info", "expectation")).toBe(true);
    expect(isValidDropTarget("task", "expectation")).toBe(false);
  });

  it("is not in the type cycle, and a note under it cycles to nothing but a note", () => {
    expect(validTypesForCycling("expectation", "project")).toEqual([]);
    expect(validTypesForCycling("info", "expectation")).toEqual(["info"]);
  });

  it("hangs on a Habit occurrence as on any Task", () => {
    const occurrence = drawn("habit-1", "task", { ...occurrenceRow({ habitId: 1, itemType: "flow_task", itemId: 1, cycleId: 0 }) });
    expect(canParentNewChild(occurrence, "expectation")).toBe(true);
    expect(canParentNewChild(n("task-1", "task"), "expectation")).toBe(true);
  });
});

describe("pasting a wait", () => {
  it("refuses a copied wait and any derived one by name", () => {
    const stored = n("e", "expectation");
    const check = drawn("c", "task", { rowId: "c-1", origin: { kind: "check", wait_kind: "stored", wait_id: 1, due_at: "2026-07-10T02:00:00" } });
    const target = n("project-1", "project");
    const tree = n("root", "domain", { children: [stored, check, target] });
    expect(pasteRefusal(tree, "e", target, true)).toEqual({ reason: PASTE_REFUSAL.EXPECTATION });
    expect(pasteRefusal(tree, "e", target, false)).toBeNull();
    expect(pasteRefusal(tree, "c", target, false)).toEqual({ reason: PASTE_REFUSAL.DERIVED_WAIT });
  });
});

describe("filterExpectationList", () => {
  const shared = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTER, ...over });
  const list = (preset: ListFilterState["preset"]): ListFilterState => ({ ...DEFAULT_LIST_FILTER, preset });
  const root = n("root", "domain", {
    children: [
      n("pending", "expectation", { status: "pending" }),
      n("checked", "expectation", { status: "pending", checkEvery: { n: 1, kind: "day" } }),
      n("released", "expectation", { status: "released" }),
      n("private", "expectation", { status: "pending", isPrivate: true }),
    ],
  });
  const rows: ExpectationListRow[] = flattenExpectationRows(root);
  const kept = (f: FilterState, l: ListFilterState) => filterExpectationList(rows, f, l).map((row) => row.node.id);

  it("answers the preset rules", () => {
    expect(kept(shared(), list("all"))).toEqual(["pending", "checked", "released"]);
    expect(kept(shared({ statusMode: "plan" }), list("plan"))).toEqual(["pending", "checked"]);
    expect(kept(shared({ statusMode: "start" }), list("start"))).toEqual(["pending"]);
    expect(kept(shared({ statusMode: "do" }), list("do"))).toEqual([]);
  });

  it("shows every pending wait under the Expectations option and none under Unblock", () => {
    expect(kept(shared({ statusMode: "start" }), list("expectations"))).toEqual(["pending", "checked"]);
    expect(kept(shared({ statusMode: "start", privateMode: true }), list("expectations")))
      .toEqual(["pending", "checked", "private"]);
    expect(kept(shared(), list("unblock"))).toEqual([]);
  });

  it("counts Expectations and Unblock as the List View's own options", () => {
    expect(isListOnlyPreset("expectations")).toBe(true);
    expect(isListOnlyPreset("unblock")).toBe(true);
    expect(isListOnlyPreset("plan")).toBe(false);
  });
});
