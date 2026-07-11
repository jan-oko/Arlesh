import { describe, it, expect } from "vitest";
import {
  matchesPillGroup, deriveScopeStateTokens, filterTaskList,
  DEFAULT_LIST_FILTER,
} from "./list-filter";
import type { PillFilter, ListFilterState, TaskListRow } from "./list-filter";
import { DEFAULT_FILTER } from "./filter-tree";
import type { FilterState } from "./filter-tree";
import type { MindmapNode, NodeKind } from "./tree-layout";

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    parentRef: "goal-1",
    ancestorRefs: ["goal-1", "project-1", "aspect-1"],
    ancestors: [],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: "project-1",
    projectStatus: "active",
    dependencyRefs: [],
    isBlocked: false,
    hasBlockedAncestor: false,
    hasNsfwAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

const lf = (over: Partial<ListFilterState> = {}): ListFilterState => ({
  ...DEFAULT_LIST_FILTER,
  ...over,
  pills: { ...DEFAULT_LIST_FILTER.pills, ...(over.pills ?? {}) },
});

const sf = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTER, ...over });

describe("matchesPillGroup", () => {
  it("passes with no filters", () => {
    expect(matchesPillGroup([], ["x"])).toBe(true);
  });

  it("any: matches if the row has at least one any-pill value", () => {
    const filters: PillFilter[] = [{ value: "a", mode: "any" }, { value: "b", mode: "any" }];
    expect(matchesPillGroup(filters, ["b"])).toBe(true);
    expect(matchesPillGroup(filters, ["c"])).toBe(false);
  });

  it("all: matches only if the row has every all-pill value", () => {
    const filters: PillFilter[] = [{ value: "a", mode: "all" }, { value: "b", mode: "all" }];
    expect(matchesPillGroup(filters, ["a", "b"])).toBe(true);
    expect(matchesPillGroup(filters, ["a"])).toBe(false);
  });

  it("exclude: fails if the row has any exclude-pill value", () => {
    const filters: PillFilter[] = [{ value: "a", mode: "exclude" }];
    expect(matchesPillGroup(filters, ["a"])).toBe(false);
    expect(matchesPillGroup(filters, ["b"])).toBe(true);
  });

  it("combines any ∧ all ∧ ¬exclude", () => {
    const filters: PillFilter[] = [
      { value: "a", mode: "any" },
      { value: "b", mode: "all" },
      { value: "c", mode: "exclude" },
    ];
    expect(matchesPillGroup(filters, ["a", "b"])).toBe(true);
    expect(matchesPillGroup(filters, ["a", "b", "c"])).toBe(false);
    expect(matchesPillGroup(filters, ["b"])).toBe(false); // fails the any clause
  });
});

describe("deriveScopeStateTokens", () => {
  it("unscoped + unplanned when neither is set", () => {
    expect(deriveScopeStateTokens(n("t", "task"))).toEqual(["unscoped", "unplanned"]);
  });

  it("scope lifecycle token when scoped", () => {
    const node = n("t", "task", { timeScope: { start_id: 1, end_id: 1 }, timing: "lapsed", resolution: "overdue" });
    expect(deriveScopeStateTokens(node)).toContain("overdue");
  });

  it("a completed-but-lapsed task still reads as active here (dimension predates archivedMode)", () => {
    // Preserves this dimension's exact pre-existing behavior: a Done task never got a "lapsed"/
    // "overdue" scope-state token before Resolution existed, even though it's now `archived: true`.
    const node = n("t", "task", {
      status: "done", timeScope: { start_id: 1, end_id: 1 }, timing: "lapsed", resolution: "completed", archived: true,
    });
    expect(deriveScopeStateTokens(node)).toContain("active");
    expect(deriveScopeStateTokens(node)).not.toContain("lapsed");
  });

  it("planned when a Plan is set, independent of scope state", () => {
    const node = n("t", "task", { plan: { start_id: 1, end_id: 1 } });
    expect(deriveScopeStateTokens(node)).toEqual(["unscoped", "planned"]);
  });
});

describe("filterTaskList", () => {
  it("all preset shows everything", () => {
    const rows = [row({ node: n("task-done", "task", { status: "done" }) })];
    expect(filterTaskList(rows, sf({ statusMode: "all" }), lf()).map((r) => r.node.id)).toEqual(["task-done"]);
  });

  it("plan preset hides done tasks", () => {
    const rows = [row({ node: n("task-done", "task", { status: "done" }) })];
    expect(filterTaskList(rows, sf({ statusMode: "plan" }), lf())).toHaveLength(0);
  });

  it("start preset drops a task with a blocked ancestor even though the task itself isn't blocked", () => {
    const rows = [row({ hasBlockedAncestor: true })];
    expect(filterTaskList(rows, sf({ statusMode: "start" }), lf())).toHaveLength(0);
  });

  it("do preset keeps only in-progress tasks", () => {
    const rows = [
      row({ node: n("task-ip", "task", { status: "in_progress" }) }),
      row({ node: n("task-todo", "task", { status: "todo" }) }),
    ];
    expect(filterTaskList(rows, sf({ statusMode: "do" }), lf()).map((r) => r.node.id)).toEqual(["task-ip"]);
  });

  it("unblock preset shows only blocked tasks and ignores the shared status mode", () => {
    const rows = [
      row({ node: n("task-blocked", "task", { status: "done" }), isBlocked: true }),
      row({ node: n("task-open", "task", { status: "todo" }), isBlocked: false }),
    ];
    expect(filterTaskList(rows, sf({ statusMode: "plan" }), lf({ preset: "unblock" })).map((r) => r.node.id))
      .toEqual(["task-blocked"]);
  });

  it("work mode hard-hides an NSFW task", () => {
    const rows = [row({ node: n("task-nsfw", "task", { status: "todo", nsfw: true }) })];
    expect(filterTaskList(rows, sf({ workMode: true }), lf())).toHaveLength(0);
  });

  it("work mode hard-hides a task nested under an NSFW ancestor, even though the task itself isn't marked", () => {
    const rows = [row({ node: n("task-child", "task", { status: "todo", nsfw: false }), hasNsfwAncestor: true })];
    expect(filterTaskList(rows, sf({ workMode: true }), lf())).toHaveLength(0);
  });

  it("work mode does not hide a non-NSFW task with no NSFW ancestor", () => {
    const rows = [row({ node: n("task-clean", "task", { status: "todo", nsfw: false }), hasNsfwAncestor: false })];
    expect(filterTaskList(rows, sf({ workMode: true }), lf())).toHaveLength(1);
  });

  it("parent filter (any) keeps only rows under the chosen parent", () => {
    const rows = [row({ parentRef: "goal-1" }), row({ node: n("task-2", "task"), parentRef: "goal-2" })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, parent: [{ value: "goal-1", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), filter).map((r) => r.parentRef)).toEqual(["goal-1"]);
  });

  it("antecedent filter matches any ancestor in the chain, not just the direct parent", () => {
    const rows = [row({ ancestorRefs: ["goal-1", "project-1", "aspect-1"] })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, antecedent: [{ value: "aspect-1", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), filter)).toHaveLength(1);
  });

  it("dependency filter (exclude) drops a task depending on the excluded target", () => {
    const rows = [row({ dependencyRefs: ["task-9"] })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, dependency: [{ value: "task-9", mode: "exclude" }] } });
    expect(filterTaskList(rows, sf(), filter)).toHaveLength(0);
  });

  it("goal status filter matches the resolved goal's status, not the task's own", () => {
    const rows = [row({ goalStatus: "achieved" })];
    const passFilter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, goalStatus: [{ value: "achieved", mode: "any" }] } });
    const failFilter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, goalStatus: [{ value: "frozen", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), passFilter)).toHaveLength(1);
    expect(filterTaskList(rows, sf(), failFilter)).toHaveLength(0);
  });

  it("a task with no resolved goal never matches a goal status filter", () => {
    const rows = [row({ goalRef: null, goalStatus: null })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, goalStatus: [{ value: "active", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), filter)).toHaveLength(0);
  });

  it("scope-state filter: unscoped and planned combine on the same row", () => {
    const rows = [row({ scopeTokens: ["unscoped", "planned"] })];
    const filter = lf({
      pills: {
        ...DEFAULT_LIST_FILTER.pills,
        scopeState: [{ value: "unscoped", mode: "all" }, { value: "planned", mode: "all" }],
      },
    });
    expect(filterTaskList(rows, sf(), filter)).toHaveLength(1);
  });

  it("blocked filter (any=blocked) keeps only blocked tasks", () => {
    const rows = [row({ isBlocked: true }), row({ node: n("task-2", "task"), isBlocked: false })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, blocked: [{ value: "blocked", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), filter).map((r) => r.isBlocked)).toEqual([true]);
  });

  it("combines the shared tag filter with a list-exclusive filter", () => {
    const rows = [row({ node: n("task-1", "task", { status: "todo", tagIds: [5] }) })];
    const shared = sf({ tagFilters: [{ tagId: 5, mode: "any" }] });
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, taskStatus: [{ value: "todo", mode: "all" }] } });
    expect(filterTaskList(rows, shared, filter)).toHaveLength(1);
    expect(filterTaskList(rows, sf({ tagFilters: [{ tagId: 6, mode: "any" }] }), filter)).toHaveLength(0);
  });
});
