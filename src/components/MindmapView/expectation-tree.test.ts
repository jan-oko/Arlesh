import { describe, it, expect } from "vitest";
import { applyLifecycles, buildTree, lifecycleMap } from "./use-mindmap-data";
import { DEFAULT_FILTER, filterTree, filterTreeWithFocus } from "@/utils/filter-tree";
import { focusExemptPath } from "@/utils/focus-exemption";
import type { ItemLifecycle } from "@/api/scope-lifecycle";
import type { Domain } from "@/api/domains";
import type { Task, TaskDependencyEdge } from "@/api/tasks";
import type { Expectation } from "@/api/expectations";
import type { Info } from "@/api/infos";
import type { MindmapNode } from "@/utils/tree-layout";
import { findNode } from "@/utils/mindmap-tree";
import { expectationNodeId } from "@/utils/node-uuid";
import { testKey } from "@/test/scope-key";

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

const DUE = { start_id: testKey(10), end_id: testKey(10) };
const EVERY = { n: 3, kind: "day" };
/** The UUID the backend serves a check task under. */
const CHECK_ID = "0b3c1f30-9f0e-5a1b-8c4d-000000000003";
const SPAWNED_ID = "1c4d2e41-0a1f-5b2c-9d5e-000000000005";
const DELEGATION_ID = "2d5e3f52-1b20-5c3d-8e6f-000000000005";

/** A wait's check task, as the Task virtual table serves it. */
function check(over: Partial<Task> = {}): Task {
  return task({
    id: CHECK_ID, title: "Reviewer replies", parent_type: "expectation", parent_id: 3,
    time_scope: DUE, position: Number.MIN_SAFE_INTEGER,
    origin: { kind: "check", wait_kind: "stored", wait_id: 3, due_at: "2026-07-10T02:00:00" },
    ...over,
  });
}

function build(
  tasks: Task[], expectations: Expectation[], deps: TaskDependencyEdge[] = [], infos: Info[] = [],
): MindmapNode {
  return buildTree(
    [ASPECT], [], tasks, infos, [], [], [], [], [], [], [], deps, [], expectations,
    (title) => `waiting on ${title}`, (title) => `Check: ${title}`,
  );
}

describe("buildTree — expectations", () => {
  it("draws a stored wait under its parent, keyed by a minted UUID and carrying its row", () => {
    const root = build([], [wait()]);
    const node = findNode(root, expectationNodeId(3));
    expect(node).toMatchObject({ kind: "expectation", rowId: 3, status: "pending", checkEvery: null });
    expect(node?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("hangs a check task row under its wait, drawn with the prefix, its editor keeping the row's title", () => {
    const root = build([check()], [wait({ check_every: EVERY })]);
    const node = findNode(root, `task-${CHECK_ID}`);
    expect(node).toMatchObject({
      kind: "task", rowId: CHECK_ID, status: "todo", timeScope: DUE,
      title: "Check: Reviewer replies", rowTitle: "Reviewer replies",
    });
    expect(node?.virtual).toBeUndefined();
    expect(findNode(root, expectationNodeId(3))?.children.map((child) => child.id)).toEqual([`task-${CHECK_ID}`]);
  });

  it("blocks a task depending on a pending wait, and lets it go once the wait is released", () => {
    const edge: TaskDependencyEdge = { task_id: 5, dependency_type: "expectation", dependency_id: 3 };
    const pending = findNode(build([task()], [wait()], [edge]), "task-5");
    expect(pending?.virtualBlockers).toEqual(["Blocked by expectation 3 (Reviewer replies)"]);
    expect(pending?.expectationDependencyIds).toEqual([3]);
    const released = findNode(build([task()], [wait({ status: "released" })], [edge]), "task-5");
    expect(released?.virtualBlockers).toEqual([]);
  });

  it("draws a delegated task's wait row beneath it, titled as what it waits on", () => {
    const root = build([task({ delegate_to: { kind: "agent" } })], [wait({
      id: DELEGATION_ID, title: "Send the draft", parent_type: "task", parent_id: 5,
      origin: { kind: "delegation_wait", task_id: 5 },
    })]);
    const node = findNode(root, expectationNodeId(DELEGATION_ID));
    expect(node).toMatchObject({
      kind: "expectation", status: "pending", title: "waiting on Send the draft", rowTitle: "Send the draft",
    });
    expect(findNode(root, "task-5")?.children.map((child) => child.id)).toContain(expectationNodeId(DELEGATION_ID));
  });

  it("draws a done asynchronous task's spawned wait row beneath it, with its checks beneath the wait", () => {
    const root = build(
      [
        task({ status: "done", asynchronous: true }),
        check({
          parent_id: SPAWNED_ID, title: "Waiting on Send the draft",
          origin: { kind: "check", wait_kind: "spawned", wait_id: 5, due_at: "2026-09-22T10:00:00" },
        }),
      ],
      [wait({
        id: SPAWNED_ID, title: "Waiting on Send the draft", parent_type: "task", parent_id: 5,
        check_every: EVERY, time_scope: DUE, tag_ids: [4], origin: { kind: "spawned_wait", task_id: 5 },
      })],
    );
    const spawned = findNode(root, expectationNodeId(SPAWNED_ID));
    expect(spawned).toMatchObject({
      kind: "expectation", rowId: SPAWNED_ID, checkEvery: EVERY, timeScope: DUE, tagIds: [4],
    });
    expect(findNode(root, "task-5")?.children.map((child) => child.id)).toContain(expectationNodeId(SPAWNED_ID));
    expect(spawned?.children.map((child) => child.id)).toEqual([`task-${CHECK_ID}`]);
  });

  it("reads asynchronous from the task's own flag, with or without a template", () => {
    const template = { title: "Waiting on Send the draft", tag_ids: [4], check_every: EVERY };
    const root = build([task({ asynchronous: true, async_template: template }), task({ id: 8, asynchronous: true })], []);
    expect(findNode(root, "task-5")).toMatchObject({ asynchronous: true, asyncTemplate: template });
    expect(findNode(root, "task-8")).toMatchObject({ asynchronous: true });
  });

  describe("completing a check", () => {
    // A check task's id is its (wait, due at) key, so the open check and the same check done are
    // one node: the selection holds on it, and the focus exemption keeps it on screen.
    const before = (): MindmapNode => build([check()], [wait({ check_every: EVERY })]);
    const after = (): MindmapNode => build([check({ status: "done" })], [wait({ check_every: EVERY })]);

    it("under All the completed check is shown done", () => {
      const shown = findNode(filterTree(after(), DEFAULT_FILTER), `task-${CHECK_ID}`);
      expect(shown?.status).toBe("done");
    });

    it("complete a selected check under Start; it stays visible dimmed", () => {
      const start = { ...DEFAULT_FILTER, statusMode: "start" as const };
      const selected = `task-${CHECK_ID}`;
      expect(findNode(filterTree(before(), start), selected)).toBeDefined();
      const tree = after();
      const { root, exemptedIds } = filterTreeWithFocus(tree, start, focusExemptPath(tree, selected));
      expect(findNode(root, selected)).toMatchObject({ status: "done" });
      expect(exemptedIds.has(selected)).toBe(true);
      expect(findNode(filterTree(tree, start), selected)).toBeUndefined();
    });

    it("stamps the open check with its own lifecycle, filed under its row", () => {
      const tree = before();
      const lifecycle: ItemLifecycle = {
        node_type: "task", node_id: CHECK_ID, timing: "active", archival: "live", archival_conflict: false,
      };
      applyLifecycles(tree, lifecycleMap([lifecycle]));
      expect(findNode(tree, `task-${CHECK_ID}`)?.timing).toBe("active");
    });
  });

  it("stamps a spawned wait with the lifecycle filed under its row", () => {
    const tree = build([task({ status: "done" })], [wait({
      id: SPAWNED_ID, parent_type: "task", parent_id: 5, origin: { kind: "spawned_wait", task_id: 5 },
    })]);
    const lifecycle: ItemLifecycle = {
      node_type: "expectation", node_id: SPAWNED_ID, timing: "lapsed", archival: "live", archival_conflict: false,
    };
    applyLifecycles(tree, lifecycleMap([lifecycle]));
    expect(findNode(tree, expectationNodeId(SPAWNED_ID))?.timing).toBe("lapsed");
  });

  it("hangs a note under a wait", () => {
    const note: Info = { id: 9, body: "asked Monday", details: null, parent_type: "expectation", parent_id: 3, position: 0, is_private: false };
    const root = build([], [wait()], [], [note]);
    expect(findNode(root, expectationNodeId(3))?.children.map((child) => child.id)).toEqual(["info-9"]);
  });
});
