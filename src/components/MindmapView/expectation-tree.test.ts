import { describe, it, expect } from "vitest";
import { buildTree } from "./use-mindmap-data";
import type { Domain } from "@/api/domains";
import type { Task, TaskDependencyEdge } from "@/api/tasks";
import type { Expectation, ExpectationCheck, SpawnedWaitView } from "@/api/expectations";
import type { Info } from "@/api/infos";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import {
  checkTaskNodeId, delegationWaitNodeId, expectationNodeId, spawnedCheckNodeId, spawnedWaitNodeId,
} from "@/utils/node-uuid";

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
    archival: "live", time_scope: null, tag_ids: [], position: 2, is_private: false,
    ...over,
  };
}

const DUE = { start_id: 10, end_id: 10 };
const EVERY = { n: 3, kind: "day" };

function build(
  tasks: Task[], expectations: Expectation[], deps: TaskDependencyEdge[] = [], infos: Info[] = [],
  checks: ExpectationCheck[] = [], spawned: SpawnedWaitView[] = [],
): MindmapNode {
  return buildTree(
    [ASPECT], [], tasks, infos, [], [], [], [], [], [], [], deps, [], expectations,
    (title) => `waiting on ${title}`, checks, spawned,
  );
}

function spawn(over: Partial<SpawnedWaitView> = {}): SpawnedWaitView {
  return { task_id: 5, spawned_at: "2026-09-20T10:00:00", status: "pending", archival: "live", ...over };
}

const TEMPLATE = { title: "Waiting on Send the draft", tag_ids: [4], check_every: EVERY };

describe("buildTree — expectations", () => {
  it("draws a stored wait under its parent, keyed by a minted UUID and carrying its row", () => {
    const root = build([], [wait()]);
    const node = findNode(root, expectationNodeId(3));
    expect(node).toMatchObject({ kind: "expectation", rowId: 3, status: "pending", checkEvery: null });
    expect(node?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("hangs a virtual check task, drawn on its due day, under each wait the backend says is due", () => {
    const root = build([], [
      wait({ id: 3, check_every: EVERY }),
      wait({ id: 4, check_every: EVERY, status: "released" }),
      wait({ id: 6, check_every: EVERY, archival: "archived" }),
      wait({ id: 7 }),
    ], [], [], [{ expectation_id: 3, due: DUE }]);
    expect(findNode(root, expectationNodeId(3))).toMatchObject({ checkEvery: EVERY });
    const check = findNode(root, checkTaskNodeId(3));
    expect(check).toMatchObject({
      kind: "task", status: "todo", virtual: true, expectationCheck: { kind: "stored", expectationId: 3 }, timeScope: DUE,
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

  it("draws a done asynchronous task's spawned wait beneath it, from its template and overlay", () => {
    const root = build(
      [task({ status: "done", asynchronous: true, async_template: TEMPLATE })], [], [], [], [],
      [spawn({ next_check: DUE, time_scope: DUE })],
    );
    const spawned = findNode(root, spawnedWaitNodeId(5));
    expect(spawned).toMatchObject({
      kind: "expectation", title: "Waiting on Send the draft", status: "pending", virtual: true,
      spawnedBy: { taskId: 5 }, checkEvery: EVERY, timeScope: DUE, tagIds: [4],
    });
    expect(spawned?.rowId).toBeUndefined();
    expect(findNode(root, "task-5")?.children.map((child) => child.id)).toContain(spawnedWaitNodeId(5));
    expect(findNode(root, spawnedCheckNodeId(5))).toMatchObject({
      kind: "task", virtual: true, expectationCheck: { kind: "spawned", taskId: 5 }, timeScope: DUE,
    });
  });

  it("draws no spawned wait for a task without a template, asynchronous or not", () => {
    const bare = build([task({ status: "done" })], [], [], [], [], [spawn()]);
    expect(findNode(bare, spawnedWaitNodeId(5))).toBeUndefined();
    const flagOnly = build([task({ status: "done", asynchronous: true })], [], [], [], [], [spawn()]);
    expect(findNode(flagOnly, spawnedWaitNodeId(5))).toBeUndefined();
  });

  it("lets a dependent of a done asynchronous task go, whatever its spawned wait is doing", () => {
    const edge: TaskDependencyEdge = { task_id: 8, dependency_type: "task", dependency_id: 5 };
    const tasks = (): Task[] => [
      task({ status: "done", asynchronous: true, async_template: TEMPLATE }),
      task({ id: 8, title: "Merge it" }),
    ];
    const pending = findNode(build(tasks(), [], [edge], [], [], [spawn()]), "task-8");
    expect(pending?.virtualBlockers).toEqual([]);
  });

  it("reads asynchronous from the task's own flag, with or without a template", () => {
    const root = build([task({ asynchronous: true, async_template: TEMPLATE }), task({ id: 8, asynchronous: true })], []);
    expect(findNode(root, "task-5")).toMatchObject({ asynchronous: true, asyncTemplate: TEMPLATE });
    expect(findNode(root, "task-8")).toMatchObject({ asynchronous: true });
  });

  it("hangs a note under a wait", () => {
    const note: Info = { id: 9, body: "asked Monday", details: null, parent_type: "expectation", parent_id: 3, position: 0, is_private: false };
    const root = build([], [wait()], [], [note]);
    expect(findNode(root, expectationNodeId(3))?.children.map((child) => child.id)).toEqual(["info-9"]);
  });
});
