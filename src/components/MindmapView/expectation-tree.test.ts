import { describe, it, expect } from "vitest";
import { buildTree } from "./use-mindmap-data";
import type { Domain } from "@/api/domains";
import type { Task, TaskDependencyEdge } from "@/api/tasks";
import type { Expectation } from "@/api/expectations";
import type { Info } from "@/api/infos";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { checkTaskNodeId, delegationWaitNodeId, expectationNodeId } from "@/utils/node-uuid";

const ASPECT: Domain = {
  id: 1, title: "Work", description: null, subtype: "aspect", parent_id: null, color: null,
  status: null, knowledge_base_directory: null, position: 0, is_private: false,
};

function task(over: Partial<Task> = {}): Task {
  return {
    id: 5, title: "Send the draft", parent_type: "project", parent_id: 1, status: "todo",
    delegate_to: null, agentic: null, asynchronous: false, time_scope: null, on_scope_exit: null,
    plan: null, archival: "live", tag_ids: [], position: 1, is_private: false, ...over,
  };
}

function wait(over: Partial<Expectation> = {}): Expectation {
  return {
    id: 3, title: "Reviewer replies", parent_type: "project", parent_id: 1, status: "pending",
    archival: "live", check_by: null, time_scope: null, tag_ids: [], position: 2, is_private: false,
    ...over,
  };
}

const CHECK_BY = { start_id: 10, end_id: 10 };

function build(
  tasks: Task[], expectations: Expectation[], deps: TaskDependencyEdge[] = [], infos: Info[] = [],
): MindmapNode {
  return buildTree(
    [ASPECT], [], tasks, infos, [], [], [], [], [], [], [], deps, [], expectations,
    (title) => `waiting on ${title}`,
  );
}

describe("buildTree — expectations", () => {
  it("draws a stored wait under its parent, keyed by a minted UUID and carrying its row", () => {
    const root = build([], [wait()]);
    const node = findNode(root, expectationNodeId(3));
    expect(node).toMatchObject({ kind: "expectation", rowId: 3, status: "pending", checkBy: null });
    expect(node?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("hangs a virtual check task under a pending, live wait with a check-by, and no other", () => {
    const root = build([], [
      wait({ id: 3, check_by: CHECK_BY }),
      wait({ id: 4, check_by: CHECK_BY, status: "released" }),
      wait({ id: 6, check_by: CHECK_BY, archival: "archived" }),
      wait({ id: 7 }),
    ]);
    const check = findNode(root, checkTaskNodeId(3));
    expect(check).toMatchObject({
      kind: "task", status: "todo", virtual: true, expectationCheck: { expectationId: 3 }, timeScope: CHECK_BY,
    });
    expect(check?.rowId).toBeUndefined();
    for (const id of [4, 6, 7]) expect(findNode(root, checkTaskNodeId(id))).toBeUndefined();
  });

  it("blocks a task depending on a pending wait, and lets it go once the wait is released", () => {
    const edge: TaskDependencyEdge = { task_id: 5, dependency_type: "expectation", dependency_id: 3 };
    const pending = findNode(build([task()], [wait()], [edge]), "task-5");
    expect(pending?.virtualBlockers).toEqual(["Blocked by expectation 3 (Reviewer replies)"]);
    expect(pending?.expectationDependencyIds).toEqual([3]);
    const released = findNode(build([task()], [wait({ status: "released" })], [edge]), "task-5");
    expect(released?.virtualBlockers).toEqual([]);
  });

  it("gives an undone delegated task a virtual wait, and a done one none", () => {
    const root = build([
      task({ id: 5, delegate_to: { kind: "agent" } }),
      task({ id: 8, delegate_to: { kind: "person", id: 2 }, status: "done" }),
    ], []);
    expect(findNode(root, delegationWaitNodeId(5))).toMatchObject({
      kind: "expectation", status: "pending", virtual: true, delegationWait: { taskId: 5 },
      title: "waiting on Send the draft",
    });
    expect(findNode(root, delegationWaitNodeId(8))).toBeUndefined();
  });

  it("hangs a note under a wait", () => {
    const note: Info = { id: 9, body: "asked Monday", details: null, parent_type: "expectation", parent_id: 3, position: 0, is_private: false };
    const root = build([], [wait()], [], [note]);
    expect(findNode(root, expectationNodeId(3))?.children.map((child) => child.id)).toEqual(["info-9"]);
  });
});
