import { describe, it, expect } from "vitest";
import { flattenTaskRows, groupRowsByPath } from "./list-data";
import type { PathGroupedEntry } from "./list-data";
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
    expect(row?.ancestors.map((a) => a.id)).toEqual(["aspect-1", "project-1", "goal-1"]);
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
function rendered(entries: readonly PathGroupedEntry[]): string[] {
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

  it("indents each step of a chain whose every link is a row", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-a", "task", { status: "todo" }, [
            n("task-b", "task", { status: "todo" }, [
              n("task-c", "task", { status: "todo" }),
            ]),
          ]),
        ]),
      ]),
    ]);
    expect(rendered(groupRowsByPath(flattenTaskRows(tree, [])))).toEqual([
      "path:aspect-1>goal-1",
      "task:task-a@0",
      "task:task-b@1",
      "task:task-c@2",
    ]);
  });

  it("counts only the ancestor tasks that are rows: two of three hidden leaves the row at depth 1", () => {
    const tree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-1", "goal", { status: "active" }, [
          n("task-a", "task", { status: "todo" }, [
            n("task-b", "task", { status: "in_progress" }, [
              n("task-c", "task", { status: "todo" }, [
                n("task-d", "task", { status: "in_progress" }),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    // Stands in for the Do preset: of task-d's three ancestor tasks only task-b survives.
    const visible = flattenTaskRows(tree, []).filter((r) => r.node.status === "in_progress");
    expect(rendered(groupRowsByPath(visible))).toEqual([
      "path:aspect-1>goal-1>task-a",
      "task:task-b@0",
      "path:aspect-1>goal-1>task-a>task-c",
      "task:task-d@1",
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

/**
 * Entering a subtree re-roots the List View, and it does so by flattening from the subtree's node
 * instead of the true root. Nothing in the two functions is subtree-aware — that is the point: the
 * ancestors a row reports are simply the ones walked to reach it, so scoping the walk is enough to
 * scope the headers, and `segments` + `visibleDepth` keep partitioning them exactly.
 */
describe("flattening from a subtree root", () => {
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
  const subtreeRoot = tree.children[0]?.children[0];
  if (subtreeRoot === undefined) throw new Error("fixture: expected project-1");

  it("starts a row's path *below* the subtree root, dropping it and everything above it", () => {
    expect(rendered(groupRowsByPath(flattenTaskRows(subtreeRoot, [])))).toEqual([
      "path:goal-1",
      "task:task-1@0",
      "task:task-2@0",
    ]);
  });

  it("puts the subtree root itself in no header — the top bar names where you are", () => {
    for (const entry of groupRowsByPath(flattenTaskRows(subtreeRoot, []))) {
      if (entry.type !== "path") continue;
      expect(entry.segments.map((seg) => seg.id)).not.toContain("project-1");
      expect(entry.segments.map((seg) => seg.id)).not.toContain("aspect-1");
    }
  });

  it("emits no header at all for a row whose only ancestor was the subtree root", () => {
    // Trimming the root can empty a path outright. That must render as nothing — the same case as
    // a task with no ancestors at the true root — rather than a blank header leaving a gap.
    const flat = n("root", "domain", {}, [
      n("project-1", "project", { status: "active" }, [
        n("task-1", "task", { status: "todo" }),
        n("task-2", "task", { status: "todo" }),
      ]),
    ]);
    const root = flat.children[0];
    if (root === undefined) throw new Error("fixture: expected project-1");
    const entries = groupRowsByPath(flattenTaskRows(root, []));
    expect(entries.every((e) => e.type === "task")).toBe(true);
    expect(rendered(entries)).toEqual(["task:task-1@0", "task:task-2@0"]);
  });

  it("never lists the subtree root as a row, even when it is itself a Task", () => {
    const taskRooted = n("root", "domain", {}, [
      n("task-outer", "task", { status: "todo" }, [n("task-inner", "task", { status: "todo" })]),
    ]);
    const root = taskRooted.children[0];
    if (root === undefined) throw new Error("fixture: expected task-outer");
    expect(rendered(groupRowsByPath(flattenTaskRows(root, [])))).toEqual(["task:task-inner@0"]);
  });

  it("keeps segments and visibleDepth partitioning each row's ancestors exactly", () => {
    // The header above a row names the ancestors it does not indent past, and visibleDepth counts
    // the ones it does; together they must account for every ancestor the row actually has, or the
    // indentation and the header disagree about where the row sits.
    const deepTree = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("goal-1", "goal", { status: "active" }, [
            n("task-parent", "task", { status: "todo" }, [n("task-child", "task", { status: "todo" })]),
          ]),
          n("goal-2", "goal", { status: "active" }, [n("task-other", "task", { status: "todo" })]),
        ]),
      ]),
    ]);
    const root = deepTree.children[0]?.children[0];
    if (root === undefined) throw new Error("fixture: expected project-1");

    let currentSegments = 0;
    let sawTask = false;
    for (const entry of groupRowsByPath(flattenTaskRows(root, []))) {
      if (entry.type === "path") { currentSegments = entry.segments.length; continue; }
      sawTask = true;
      expect(entry.visibleDepth + currentSegments).toBe(entry.row.ancestors.length);
    }
    expect(sawTask).toBe(true);
  });

  it("still indents under an ancestor Task that is itself a row inside the subtree", () => {
    const nestedTree = n("root", "domain", {}, [
      n("project-1", "project", { status: "active" }, [
        n("task-parent", "task", { status: "todo" }, [n("task-child", "task", { status: "todo" })]),
      ]),
    ]);
    const root = nestedTree.children[0];
    if (root === undefined) throw new Error("fixture: expected project-1");
    // project-1 is the subtree root, so it is gone from the path entirely — which leaves
    // task-parent with no path at all. task-child still indents under it, because task-parent is
    // a row and so counts as depth rather than as a segment.
    expect(rendered(groupRowsByPath(flattenTaskRows(root, [])))).toEqual([
      "task:task-parent@0",
      "task:task-child@1",
    ]);
  });
});
