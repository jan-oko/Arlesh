import { describe, it, expect } from "vitest";
import { occurrenceMenuEntries, storedOccurrenceStatus } from "@/utils/occurrence-menu";
import type { MindmapNode } from "@/utils/tree-layout";

const META = { templateTitle: "Run", ownTitle: null, blockedReason: null, dependsOn: [], archived: false };
const ITEM = { flowId: 3, itemType: "flow_task" as const, itemId: 4, scopeId: 100, cycleId: 0 };

function node(extra: Partial<MindmapNode>): MindmapNode {
  return {
    id: "habititem-flow_task-4-0-0-virtual", kind: "task", title: "Run", status: "todo", position: 0,
    tagIds: [], children: [], virtual: true, habitItem: ITEM, occurrence: META, ...extra,
  };
}

const actions = (n: MindmapNode, collapsed = false, canCollapse = true) =>
  occurrenceMenuEntries(n, collapsed, canCollapse)?.map((entry) => entry.action);

describe("occurrenceMenuEntries", () => {
  it("offers a task occurrence its editor, the other statuses, its Plan and deleting it", () => {
    expect(actions(node({}))).toEqual([
      "edit", "status:in_progress", "status:done", "plan", "unplan", "delete",
    ]);
  });

  it("offers handing an overridden plan back, and no second 'unplan' on one already unplanned", () => {
    expect(actions(node({ planOverridden: true, plan: null }))).toEqual([
      "edit", "status:in_progress", "status:done", "plan", "follow-cycle-plan", "delete",
    ]);
  });

  it("offers a goal occurrence no Plan", () => {
    expect(actions(node({ kind: "goal", status: "active" }))).toEqual(["edit", "status:achieved", "delete"]);
  });

  it("offers a deleted occurrence only its editor and Restore", () => {
    expect(actions(node({ occurrence: { ...META, archived: true } }))).toEqual(["edit", "restore"]);
  });

  it("offers the iteration root its status and folding, never editing or deleting", () => {
    const root = node({
      id: "habit-3-0-virtual", habitItem: { ...ITEM, itemType: "flow_root", itemId: 3 },
      children: [node({})],
    });
    expect(actions(root)).toEqual(["status:in_progress", "status:done", "collapse"]);
    expect(actions(root, true)).toContain("expand");
    expect(actions(root, false, false)).toEqual(["status:in_progress", "status:done"]);
  });

  it("offers a commitment iteration no status — its verdict is its own control", () => {
    const root = node({ kind: "commitment", habitItem: { ...ITEM, itemType: "flow_root" } });
    expect(actions(root)).toEqual([]);
  });

  it("is not a menu for a node that is not an occurrence", () => {
    const task: MindmapNode = { id: "task-1", kind: "task", title: "Run", position: 0, tagIds: [], children: [] };
    expect(occurrenceMenuEntries(task, false)).toBeNull();
  });
});

describe("storedOccurrenceStatus", () => {
  it("clears the Modification for the base status and stores a goal's achieved as done", () => {
    expect(storedOccurrenceStatus("todo")).toBeNull();
    expect(storedOccurrenceStatus("active")).toBeNull();
    expect(storedOccurrenceStatus("achieved")).toBe("done");
    expect(storedOccurrenceStatus("in_progress")).toBe("in_progress");
  });
});
