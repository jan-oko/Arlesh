import { describe, it, expect } from "vitest";
import type { TaskDependencyEdge } from "@/api/tasks";
import { collectSearchableNodes, flattenNodesById } from "@/utils/mindmap-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { canHoldDependencies, dependencyCandidates, dependencyOn, matchCandidates } from "./dependency-candidates";

function node(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function edge(taskId: number | string, type: string, id: number | string): TaskDependencyEdge {
  return { task_id: taskId, dependency_type: type, dependency_id: id };
}

function candidateIds(tree: MindmapNode, dependentId: string, edges: TaskDependencyEdge[]): string[] {
  const byId = flattenNodesById(tree);
  const dependent = byId.get(dependentId);
  if (dependent === undefined) throw new Error(`no ${dependentId} in the fixture`);
  return dependencyCandidates(dependent, collectSearchableNodes(tree), byId, edges).map((c) => c.id);
}

const checkTask = node("task-90", "task", {
  origin: { kind: "check", wait_kind: "stored", wait_id: 7, due_at: "2026-09-01T00:00:00" },
});
const spawnedWait = node("expectation-91", "expectation", { origin: { kind: "spawned_wait", task_id: 3 } });

function board(): MindmapNode {
  return node("root", "domain", {
    children: [
      node("goal-1", "goal", {
        children: [node("task-1", "task"), node("task-2", "task"), node("task-3", "task"), checkTask],
      }),
      node("expectation-7", "expectation"),
      spawnedWait,
      node("domain-4", "domain"),
      node("habit_group-virtual", "habit_group", { virtual: true }),
    ],
  });
}

describe("canHoldDependencies", () => {
  it("takes a stored Task and a Habit occurrence, and nothing without a row of its own", () => {
    expect(canHoldDependencies(node("task-1", "task"))).toBe(true);
    expect(canHoldDependencies(node("occ", "task", { rowId: "9d1c-uuid" }))).toBe(true);
    expect(canHoldDependencies(checkTask)).toBe(false);
    expect(canHoldDependencies(node("goal-1", "goal"))).toBe(false);
    expect(canHoldDependencies(node("flow_task-1", "flow_task"))).toBe(false);
  });
});

describe("dependencyOn", () => {
  it("names a Task by its row, an occurrence by its UUID and a stored wait by its id", () => {
    expect(dependencyOn(node("task-5", "task"))).toEqual({ type: "task", id: 5 });
    expect(dependencyOn(node("occ", "task", { rowId: "9d1c-uuid" }))).toEqual({ type: "task", id: "9d1c-uuid" });
    expect(dependencyOn(node("expectation-7", "expectation"))).toEqual({ type: "expectation", id: 7 });
  });

  it("offers no edge onto a derived wait or anything but a Task and an Expectation", () => {
    expect(dependencyOn(spawnedWait)).toBeNull();
    expect(dependencyOn(checkTask)).toBeNull();
    expect(dependencyOn(node("goal-1", "goal"))).toBeNull();
  });
});

describe("dependencyCandidates", () => {
  it("offers every other Task and every stored Expectation", () => {
    expect(candidateIds(board(), "task-1", [])).toEqual(["task-2", "task-3", "expectation-7"]);
  });

  it("leaves out what the Task already depends on", () => {
    const edges = [edge(1, "task", 2), edge(1, "expectation", 7)];
    expect(candidateIds(board(), "task-1", edges)).toEqual(["task-3"]);
  });

  it("leaves out every Task that already depends on it, through a chain too, since that closes a cycle", () => {
    // task-3 → task-2 → task-1: making task-1 depend on either would close the loop.
    const edges = [edge(2, "task", 1), edge(3, "task", 2)];
    expect(candidateIds(board(), "task-1", edges)).toEqual(["expectation-7"]);
  });

  it("keeps a Task that depends on the same wait — an Expectation depends on nothing, so no cycle runs through one", () => {
    const edges = [edge(2, "expectation", 7)];
    expect(candidateIds(board(), "task-1", edges)).toEqual(["task-2", "task-3", "expectation-7"]);
  });
});

describe("matchCandidates", () => {
  it("offers nothing until something is typed, then matches the title in any case", () => {
    const tree = node("root", "domain", {
      children: [node("task-1", "task", { title: "Write report" }), node("task-2", "task", { title: "Call the bank" }), node("task-3", "task", { title: "Review REPORT" })],
    });
    const byId = flattenNodesById(tree);
    const dependent = byId.get("task-2");
    if (dependent === undefined) throw new Error("fixture");
    const all = dependencyCandidates(dependent, collectSearchableNodes(tree), byId, []);
    expect(matchCandidates(all, "  ", 8)).toEqual([]);
    expect(matchCandidates(all, "report", 8).map((c) => c.id)).toEqual(["task-1", "task-3"]);
    expect(matchCandidates(all, "report", 1).map((c) => c.id)).toEqual(["task-1"]);
  });
});
