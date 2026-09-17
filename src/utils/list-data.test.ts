import { describe, it, expect } from "vitest";
import { flattenTaskRows, groupRowsByPath } from "./list-data";
import type { ListRowEntry } from "./list-data";
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
        n("project-1", "project", { status: "frozen" }, [
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
    expect(row?.projectStatus).toBe("frozen");
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

  it("hasPrivateAncestor is true when any ancestor (e.g. the Project) is marked private, not just a direct parent", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { isPrivate: true }, [
          n("goal-1", "goal", { status: "active", isPrivate: false }, [
            n("task-1", "task", { status: "todo", isPrivate: false }),
          ]),
        ]),
      ]),
    ]);
    const [row] = flattenTaskRows(tree, []);
    expect(row?.node.isPrivate).toBe(false);
    expect(row?.hasPrivateAncestor).toBe(true);
  });

  it("hasPrivateAncestor is false when no ancestor is marked private", () => {
    const tree = n("root", "domain", {}, [n("aspect-1", "aspect", {}, [n("task-1", "task", { status: "todo" })])]);
    const [row] = flattenTaskRows(tree, []);
    expect(row?.hasPrivateAncestor).toBe(false);
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

/** What the list renders, in order: each header by the ancestors it names, each row by its id and
 * the depth it is indented to. */
function rendered(entries: readonly ListRowEntry[]): string[] {
  return entries.map((entry) =>
    entry.type === "path"
      ? `path:${entry.segments.map((s) => s.id).join(">")}`
      : `task:${entry.row.node.id}@${entry.visibleDepth}`,
  );
}

describe("groupRowsByPath", () => {
  it("names every ancestor of a run once, above the run", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("goal-1", "goal", { status: "active" }, [
            n("task-1", "task", { status: "todo" }),
            n("task-2", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);
    expect(rendered(groupRowsByPath(flattenTaskRows(tree, [])))).toEqual([
      "path:aspect-1>project-1>goal-1",
      "task:task-1@0",
      "task:task-2@0",
    ]);
  });

  it("opens a new header where the path changes", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [n("task-1", "task", { status: "todo" })]),
        n("goal-2", "goal", { status: "active" }, [n("task-2", "task", { status: "todo" })]),
      ]),
    ]);
    expect(rendered(groupRowsByPath(flattenTaskRows(tree, [])))).toEqual([
      "path:aspect-1>goal-1", "task:task-1@0",
      "path:aspect-1>goal-2", "task:task-2@0",
    ]);
  });

  it("renders no header for a task with no ancestors", () => {
    const tree = n("root", "domain", {}, [n("task-1", "task", { status: "todo" })]);
    expect(rendered(groupRowsByPath(flattenTaskRows(tree, [])))).toEqual(["task:task-1@0"]);
  });

  it("keeps a parent task out of the header when it is itself a row, and counts it as depth", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-parent", "task", { status: "todo" }, [
            n("task-child", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);
    expect(rendered(groupRowsByPath(flattenTaskRows(tree, [])))).toEqual([
      "path:aspect-1>goal-1",
      "task:task-parent@0",
      "task:task-child@1",
    ]);
  });

  it("moves a parent task into the header when the active filter hides it", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-parent", "task", { status: "todo" }, [
            n("task-child", "task", { status: "in_progress" }),
          ]),
        ]),
      ]),
    ]);
    // Stands in for the Do preset, which keeps only the in-progress child.
    const visible = flattenTaskRows(tree, []).filter((r) => r.node.status === "in_progress");
    expect(rendered(groupRowsByPath(visible))).toEqual([
      "path:aspect-1>goal-1>task-parent",
      "task:task-child@0",
    ]);
  });

  it("splits one goal's run per hidden parent, so no row is shown without its stated parent", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-p", "task", { status: "todo" }, [n("task-a", "task", { status: "in_progress" })]),
          n("task-q", "task", { status: "todo" }, [n("task-b", "task", { status: "in_progress" })]),
        ]),
      ]),
    ]);
    const visible = flattenTaskRows(tree, []).filter((r) => r.node.status === "in_progress");
    expect(rendered(groupRowsByPath(visible))).toEqual([
      "path:aspect-1>goal-1>task-p", "task:task-a@0",
      "path:aspect-1>goal-1>task-q", "task:task-b@0",
    ]);
  });

  it("still names a run's path when filtering has reduced it to a single row", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-1", "task", { status: "todo" }),
          n("task-2", "task", { status: "done" }),
        ]),
      ]),
    ]);
    const visible = flattenTaskRows(tree, []).filter((r) => r.node.status === "done");
    expect(rendered(groupRowsByPath(visible))).toEqual(["path:aspect-1>goal-1", "task:task-2@0"]);
  });

  it("gives each run its own key even when the same path recurs further down the list", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-1", "task", { status: "todo" }),
          n("task-p", "task", { status: "done" }, [n("task-2", "task", { status: "todo" })]),
          n("task-3", "task", { status: "todo" }),
        ]),
      ]),
    ]);
    const visible = flattenTaskRows(tree, []).filter((r) => r.node.status === "todo");
    expect(rendered(groupRowsByPath(visible))).toEqual([
      "path:aspect-1>goal-1", "task:task-1@0",
      "path:aspect-1>goal-1>task-p", "task:task-2@0",
      "path:aspect-1>goal-1", "task:task-3@0",
    ]);
  });

  it("carries the header's own nodes, so each segment is addressable as a filter value", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", { title: "Growth" }, [
        n("goal-1", "goal", { status: "active", title: "Ship it" }, [n("task-1", "task", { status: "todo" })]),
      ]),
    ]);
    const [header] = groupRowsByPath(flattenTaskRows(tree, []));
    expect(header?.type).toBe("path");
    if (header?.type !== "path") throw new Error("expected a path header first");
    expect(header.segments.map((s) => s.title)).toEqual(["Growth", "Ship it"]);
    expect(header.segments.map((s) => s.id)).toEqual(["aspect-1", "goal-1"]);
  });
});
