import { describe, it, expect } from "vitest";
import type { Dependency } from "@/api/tasks";
import { collectSearchableNodes, flattenNodesById } from "@/utils/mindmap-tree";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { fixtureRowId } from "@/test/node-fixture";
import { canHoldDependencies, dependencyCandidates, matchCandidates } from "./dependency-candidates";
import { DERIVED_WAIT_CAPABILITIES } from "@/test/capabilities";

function node(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, ...fixtureRowId(id), kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

const checkTask = node("task-90", "task", {
  origin: { kind: "check", wait_kind: "stored", wait_id: 7, due_at: "2026-09-01T00:00:00" },
  capabilities: DERIVED_WAIT_CAPABILITIES,
});

function board(): MindmapNode {
  return node("root", "domain", {
    children: [
      node("goal-1", "goal", {
        children: [node("task-1", "task"), node("task-2", "task"), node("task-3", "task"), checkTask],
      }),
      node("expectation-7", "expectation"),
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

describe("dependencyCandidates", () => {
  // Which nodes may be depended on is the backend's (`tasks::rules::dependencies::candidates`);
  // this pins how its answer is found in the search pool.
  it("finds each offered prerequisite in the search pool, in search order, with the edge it writes", () => {
    const tree = board();
    const allowed: Dependency[] = [{ type: "expectation", id: 7 }, { type: "task", id: 3 }, { type: "goal", id: 1 }];
    const found = dependencyCandidates(collectSearchableNodes(tree), flattenNodesById(tree), allowed);
    expect(found.map((c) => [c.id, c.dependency])).toEqual([
      ["goal-1", { type: "goal", id: 1 }],
      ["task-3", { type: "task", id: 3 }],
      ["expectation-7", { type: "expectation", id: 7 }],
    ]);
  });

  it("offers nothing the backend did not, whatever its kind", () => {
    const tree = board();
    expect(dependencyCandidates(collectSearchableNodes(tree), flattenNodesById(tree), [])).toEqual([]);
  });

  it("matches an occurrence by its UUID, as the backend names it", () => {
    const tree = node("root", "domain", { children: [node("occ", "task", { rowId: "9d1c-uuid" })] });
    const found = dependencyCandidates(collectSearchableNodes(tree), flattenNodesById(tree), [{ type: "task", id: "9d1c-uuid" }]);
    expect(found.map((c) => c.id)).toEqual(["occ"]);
  });
});

describe("matchCandidates", () => {
  it("offers nothing until something is typed, then matches the title in any case", () => {
    const tree = node("root", "domain", {
      children: [node("task-1", "task", { title: "Write report" }), node("task-2", "task", { title: "Call the bank" }), node("task-3", "task", { title: "Review REPORT" })],
    });
    const allowed: Dependency[] = [{ type: "task", id: 1 }, { type: "task", id: 3 }];
    const all = dependencyCandidates(collectSearchableNodes(tree), flattenNodesById(tree), allowed);
    expect(matchCandidates(all, "  ", 8)).toEqual([]);
    expect(matchCandidates(all, "report", 8).map((c) => c.id)).toEqual(["task-1", "task-3"]);
    expect(matchCandidates(all, "report", 1).map((c) => c.id)).toEqual(["task-1"]);
  });
});
