import { describe, it, expect } from "vitest";
import { flattenTaskRows, groupRowsByGoal } from "./list-data";
import type { MindmapNode, NodeKind } from "./tree-layout";
import type { TaskDependencyEdge } from "@/api/tasks";

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

describe("flattenTaskRows", () => {
  it("collects only task nodes, skipping goals/projects/domains", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("goal-1", "goal", { status: "active" }, [
            n("task-1", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);
    const rows = flattenTaskRows(tree, []);
    expect(rows.map((r) => r.node.id)).toEqual(["task-1"]);
  });

  it("resolves the nearest ancestor Goal and Project, with their status", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "paused" }, [
          n("goal-1", "goal", { status: "achieved" }, [
            n("task-1", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);
    const [row] = flattenTaskRows(tree, []);
    expect(row?.goalRef).toBe("goal-1");
    expect(row?.goalStatus).toBe("achieved");
    expect(row?.projectRef).toBe("project-1");
    expect(row?.projectStatus).toBe("paused");
    expect(row?.parentRef).toBe("goal-1");
    expect(row?.ancestorRefs).toEqual(["aspect-1", "project-1", "goal-1"]);
  });

  it("a task directly under a project has no resolved goal", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("task-1", "task", { status: "todo" }),
        ]),
      ]),
    ]);
    const [row] = flattenTaskRows(tree, []);
    expect(row?.goalRef).toBeNull();
    expect(row?.goalStatus).toBeNull();
    expect(row?.projectRef).toBe("project-1");
  });

  it("hasBlockedAncestor is true when a blocked task/goal sits above it in the chain", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("task-parent", "task", { status: "todo", blockReasons: ["stuck"] }, [
          n("task-child", "task", { status: "todo" }),
        ]),
      ]),
    ]);
    const rows = flattenTaskRows(tree, []);
    const parentRow = rows.find((r) => r.node.id === "task-parent");
    const childRow = rows.find((r) => r.node.id === "task-child");
    expect(parentRow?.isBlocked).toBe(true);
    expect(parentRow?.hasBlockedAncestor).toBe(false);
    expect(childRow?.isBlocked).toBe(false);
    expect(childRow?.hasBlockedAncestor).toBe(true);
  });

  it("resolves this task's own dependency edges to target node ids", () => {
    const tree = n("root", "domain", {}, [n("task-5", "task", { status: "todo" })]);
    const deps: TaskDependencyEdge[] = [
      { task_id: 5, dependency_type: "task", dependency_id: 9 },
      { task_id: 5, dependency_type: "goal", dependency_id: 2 },
    ];
    const [row] = flattenTaskRows(tree, deps);
    expect(row?.dependencyRefs.sort()).toEqual(["goal-2", "task-9"]);
  });
});

describe("groupRowsByGoal", () => {
  it("returns plain task entries when goal headers are off", () => {
    const tree = n("root", "domain", {}, [n("task-1", "task", { status: "todo" })]);
    const rows = flattenTaskRows(tree, []);
    const entries = groupRowsByGoal(rows, false);
    expect(entries).toEqual([{ type: "task", row: rows[0] }]);
  });

  it("inserts a goal header before the first task of each contiguous goal run", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-1", "task", { status: "todo" }),
          n("task-2", "task", { status: "todo" }),
        ]),
        n("goal-2", "goal", { status: "active" }, [
          n("task-3", "task", { status: "todo" }),
        ]),
      ]),
    ]);
    const rows = flattenTaskRows(tree, []);
    const entries = groupRowsByGoal(rows, true);
    expect(entries.map((e) => (e.type === "goal" ? `goal:${e.node.id}` : `task:${e.row.node.id}`))).toEqual([
      "goal:goal-1", "task:task-1", "task:task-2",
      "goal:goal-2", "task:task-3",
    ]);
  });

  it("does not insert a header for tasks with no resolved goal", () => {
    const tree = n("root", "domain", {}, [n("task-1", "task", { status: "todo" })]);
    const rows = flattenTaskRows(tree, []);
    const entries = groupRowsByGoal(rows, true);
    expect(entries).toEqual([{ type: "task", row: rows[0] }]);
  });
});
