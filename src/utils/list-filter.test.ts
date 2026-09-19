import { describe, it, expect } from "vitest";
import {
  matchesPillGroup, deriveScopeStateTokens, filterTaskList, filterTaskListWithFocus, filterCommitmentList,
  withCurrentPillDimensions,
  DEFAULT_LIST_FILTER,
} from "./list-filter";
import type { PillFilter, ListFilterState, TaskListRow, CommitmentListRow } from "./list-filter";
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
    ancestors: [],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: "project-1",
    projectStatus: "active",
    dependencyRefs: [],
    isBlocked: false,
    isAgentic: false,
    hasBlockedAncestor: false,
    hasPrivateAncestor: false,
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

  it("shows a not-yet-open occurrence under All and hides it under Plan/Start/Do", () => {
    // Same rule the canvas applies, on the flat list: All is the preset that shows everything,
    // including this evening's habit item at breakfast.
    const evening = n("evening", "task", {
      status: "todo",
      timing: "pending",
      habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100, cycleId: 12 },
    });
    const rows = [row({ node: evening })];
    expect(filterTaskList(rows, sf({ statusMode: "all" }), lf())).toHaveLength(1);
    for (const statusMode of ["plan", "start", "do"] as const) {
      expect(filterTaskList(rows, sf({ statusMode }), lf()), statusMode).toHaveLength(0);
    }
  });

  it("hides a row whose habit-occurrence ancestor has not opened yet", () => {
    // The canvas prunes the subtree; a flat list has to walk for it.
    const ancestor = n("evening", "task", {
      timing: "pending",
      habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100, cycleId: 12 },
    });
    const rows = [row({ ancestors: [ancestor] })];
    expect(filterTaskList(rows, sf({ statusMode: "all" }), lf())).toHaveLength(1);
    expect(filterTaskList(rows, sf({ statusMode: "plan" }), lf())).toHaveLength(0);
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

  it("hard-hides a private task while Private Mode is off", () => {
    const rows = [row({ node: n("task-private", "task", { status: "todo", isPrivate: true }) })];
    expect(filterTaskList(rows, sf({ privateMode: false }), lf())).toHaveLength(0);
  });

  it("hard-hides a task nested under a private ancestor, even though the task itself isn't marked", () => {
    const rows = [row({ node: n("task-child", "task", { status: "todo", isPrivate: false }), hasPrivateAncestor: true })];
    expect(filterTaskList(rows, sf({ privateMode: false }), lf())).toHaveLength(0);
  });

  it("does not hide a non-private task with no private ancestor", () => {
    const rows = [row({ node: n("task-clean", "task", { status: "todo", isPrivate: false }), hasPrivateAncestor: false })];
    expect(filterTaskList(rows, sf({ privateMode: false }), lf())).toHaveLength(1);
  });

  it("shows a private task and one under a private ancestor once Private Mode is on", () => {
    const rows = [
      row({ node: n("task-private", "task", { status: "todo", isPrivate: true }) }),
      row({ node: n("task-child", "task", { status: "todo", isPrivate: false }), hasPrivateAncestor: true }),
    ];
    expect(filterTaskList(rows, sf({ privateMode: true }), lf())).toHaveLength(2);
  });

  it("parent filter (any) keeps only rows under the chosen parent", () => {
    const rows = [row({ parentRef: "goal-1" }), row({ node: n("task-2", "task"), parentRef: "goal-2" })];
    const filter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, parent: [{ value: "goal-1", mode: "any" }] } });
    expect(filterTaskList(rows, sf(), filter).map((r) => r.parentRef)).toEqual(["goal-1"]);
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

describe("filterTaskList — archived tasks under the Plan preset", () => {
  const archivedTask = () =>
    n("task-archived", "task", {
      status: "todo", timeScope: { start_id: 1, end_id: 1 }, timing: "lapsed",
      resolution: "missed", archived: true,
    });

  it("plan preset hides a task whose effective Archival is archived, even when it isn't done", () => {
    expect(filterTaskList([row({ node: archivedTask() })], sf({ statusMode: "plan" }), lf())).toEqual([]);
  });

  it("archivedMode include force-shows an archived task under Plan", () => {
    const kept = filterTaskList([row({ node: archivedTask() })], sf({ statusMode: "plan", archivedMode: "include" }), lf());
    expect(kept.map((r) => r.node.id)).toEqual(["task-archived"]);
  });

  it("archivedMode include force-shows a lapsed task under Start", () => {
    const kept = filterTaskList([row({ node: archivedTask() })], sf({ statusMode: "start", archivedMode: "include" }), lf());
    expect(kept.map((r) => r.node.id)).toEqual(["task-archived"]);
  });

  it("plan preset still shows an unfinished task that is merely overdue, not archived", () => {
    const overdue = n("task-overdue", "task", {
      status: "todo", timeScope: { start_id: 1, end_id: 1 }, timing: "lapsed", resolution: "overdue",
    });
    const kept = filterTaskList([row({ node: overdue })], sf({ statusMode: "plan" }), lf());
    expect(kept.map((r) => r.node.id)).toEqual(["task-overdue"]);
  });
});

describe("filterTaskList — tasks inside a Frozen/Archived Project", () => {
  const under = (status: string, projectId = "project-1") =>
    row({ ancestors: [n(projectId, "project", { status }), n("domain-1", "domain")] });

  it("plan preset hides a task inside a frozen project", () => {
    expect(filterTaskList([under("frozen")], sf({ statusMode: "plan" }), lf())).toEqual([]);
  });

  it("start preset hides a task inside an archived project", () => {
    expect(filterTaskList([under("archived")], sf({ statusMode: "start" }), lf())).toEqual([]);
  });

  it("plan preset still shows a task inside an achieved project", () => {
    expect(filterTaskList([under("achieved")], sf({ statusMode: "plan" }), lf())).toHaveLength(1);
  });

  it("all preset still shows a task inside a frozen project", () => {
    expect(filterTaskList([under("frozen")], sf({ statusMode: "all" }), lf())).toHaveLength(1);
  });

  it("hides a task whose outer project is frozen even when the nearest one is active", () => {
    const nested = row({
      ancestors: [n("project-outer", "project", { status: "frozen" }), n("project-inner", "project", { status: "active" })],
      projectStatus: "active",
    });
    expect(filterTaskList([nested], sf({ statusMode: "plan" }), lf())).toEqual([]);
  });
});

describe("withCurrentPillDimensions", () => {
  it("drops a retired dimension, so a filter saved before it was removed stops narrowing the list", () => {
    // A blob written while Antecedent was still a dimension, before subtree entry replaced it.
    const restored = withCurrentPillDimensions({
      preset: "all",
      pills: { ...DEFAULT_LIST_FILTER.pills, antecedent: [{ value: "aspect-1", mode: "any" }] },
    });
    expect(restored.pills).toEqual(DEFAULT_LIST_FILTER.pills);
    expect(filterTaskList([row()], sf(), restored)).toHaveLength(1);
  });

  it("fills in a dimension the saved filter never had, so nothing reads an undefined pill list", () => {
    const restored = withCurrentPillDimensions({ preset: "do", pills: { parent: [{ value: "goal-1", mode: "any" }] } });
    expect(restored.preset).toBe("do");
    expect(restored.pills.parent).toEqual([{ value: "goal-1", mode: "any" }]);
    expect(restored.pills.blocked).toEqual([]);
  });

  it("survives a filter persisted before Agentic was a dimension", () => {
    // The shape a user's stored filter has today: every dimension but the new one. It must come
    // back as an empty pill list rather than undefined, and must narrow nothing.
    const beforeAgentic: Record<string, unknown> = { ...DEFAULT_LIST_FILTER.pills };
    delete beforeAgentic.agentic;
    const restored = withCurrentPillDimensions({ preset: "all", pills: beforeAgentic });
    expect(restored.pills.agentic).toEqual([]);
    expect(filterTaskList([row({ isAgentic: true }), row({ isAgentic: false })], sf(), restored))
      .toHaveLength(2);
  });

  it("drops a saved pill that is not a pill at all", () => {
    const restored = withCurrentPillDimensions({
      preset: "all",
      pills: { parent: ["goal-1", { value: "goal-2", mode: "nope" }, { value: "goal-3", mode: "all" }] },
    });
    expect(restored.pills.parent).toEqual([{ value: "goal-3", mode: "all" }]);
  });
});

describe("filterTaskList — Agentic", () => {
  const agentic = row({ node: n("task-a", "task", { status: "todo" }), isAgentic: true });
  const manual = row({ node: n("task-m", "task", { status: "todo" }), isAgentic: false });

  it("shows both when no Agentic pill is set", () => {
    expect(filterTaskList([agentic, manual], sf(), lf())).toHaveLength(2);
  });

  it("keeps only agentic rows under an Any pill", () => {
    const filtered = filterTaskList([agentic, manual], sf(), lf({ pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [{ value: "agentic", mode: "any" }] } }));
    expect(filtered.map((r) => r.node.id)).toEqual(["task-a"]);
  });

  it("keeps only the rest under a Not-agentic pill", () => {
    const filtered = filterTaskList([agentic, manual], sf(), lf({ pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [{ value: "not_agentic", mode: "any" }] } }));
    expect(filtered.map((r) => r.node.id)).toEqual(["task-m"]);
  });

  it("drops agentic rows under an Exclusion pill", () => {
    const filtered = filterTaskList([agentic, manual], sf(), lf({ pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [{ value: "agentic", mode: "exclude" }] } }));
    expect(filtered.map((r) => r.node.id)).toEqual(["task-m"]);
  });

  it("intersects an All pill with another dimension rather than replacing it", () => {
    const blocked = row({ node: n("task-b", "task", { status: "todo" }), isAgentic: true, isBlocked: true });
    const filtered = filterTaskList([agentic, manual, blocked], sf(), lf({
      pills: {
        ...DEFAULT_LIST_FILTER.pills,
        agentic: [{ value: "agentic", mode: "all" }],
        blocked: [{ value: "blocked", mode: "all" }],
      },
    }));
    expect(filtered.map((r) => r.node.id)).toEqual(["task-b"]);
  });

  it("leaves the delegated/undelegated question alone — a row can be agentic and anything else", () => {
    // The two are independent by design: the flag says the work suits an agent, a delegate says
    // who holds it. Nothing in this dimension may touch another.
    const filtered = filterTaskList([agentic, manual], sf(), lf({ pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [{ value: "agentic", mode: "any" }] } }));
    expect(filtered).toHaveLength(1);
  });
});

describe("filterTaskList — Backlog", () => {
  const aside = row({ node: n("task-aside", "task", { status: "todo", backlogged: true }) });
  const live = row({ node: n("task-live", "task", { status: "todo" }) });
  // A live sub-step under a set-aside parent: hidden with it, exactly as on the canvas.
  const substep = row({
    node: n("task-substep", "task", { status: "todo" }),
    ancestors: [n("task-aside", "task", { status: "todo", backlogged: true })],
  });
  const rows = [aside, live, substep];
  const kept = (shared: Partial<FilterState>, list: Partial<ListFilterState> = {}) =>
    filterTaskList(rows, sf(shared), lf(list)).map((r) => r.node.id);

  it("Plan hides a backlogged row and everything under it", () => {
    expect(kept({ statusMode: "plan" })).toEqual(["task-live"]);
  });

  it("Start hides a backlogged row and everything under it", () => {
    expect(kept({ statusMode: "start" })).toEqual(["task-live"]);
  });

  it("All lists a backlogged row", () => {
    expect(kept({ statusMode: "all" })).toContain("task-aside");
  });

  it("the Backlog preset lists only what was set aside, plus what sits under it", () => {
    expect(kept({ statusMode: "backlog" })).toEqual(["task-aside", "task-substep"]);
  });

  it("the Backlog pill's Include brings the rows back under Plan", () => {
    expect(kept({ statusMode: "plan", backlogMode: "include" })).toEqual([
      "task-aside", "task-live", "task-substep",
    ]);
  });

  it("the Backlog pill's Exclude drops them even under All", () => {
    expect(kept({ statusMode: "all", backlogMode: "exclude" })).toEqual(["task-live"]);
  });
});

describe("filterCommitmentList", () => {
  function commitmentRow(over: Partial<CommitmentListRow> = {}): CommitmentListRow {
    return {
      node: n("commitment-1", "commitment", { verdict: "unresolved", timing: "active" }),
      parentRef: "project-1",
      ancestors: [],
      hasPrivateAncestor: false,
      scopeTokens: ["active", "unplanned"],
      ...over,
    };
  }

  const kept = (rows: CommitmentListRow[], shared = sf(), list = lf()): string[] =>
    filterCommitmentList(rows, shared, list).map((r) => r.node.id);

  it("reads the same preset rules the Mindmap does", () => {
    const unresolved = commitmentRow();
    const settled = commitmentRow({
      node: n("commitment-2", "commitment", { verdict: "kept", timing: "active" }),
    });
    const brokenOpen = commitmentRow({
      node: n("commitment-3", "commitment", { verdict: "broken", timing: "active" }),
    });
    const brokenShut = commitmentRow({
      node: n("commitment-4", "commitment", { verdict: "broken", timing: "lapsed" }),
    });
    const rows = [unresolved, settled, brokenOpen, brokenShut];

    expect(kept(rows, sf({ statusMode: "all" }))).toEqual([
      "commitment-1", "commitment-2", "commitment-3", "commitment-4",
    ]);
    expect(kept(rows, sf({ statusMode: "plan" }))).toEqual(["commitment-1", "commitment-3"]);
    expect(kept(rows, sf({ statusMode: "start" }))).toEqual(["commitment-1"]);
    expect(kept(rows, sf({ statusMode: "do" }))).toEqual(["commitment-1"]);
  });

  it("is empty under Unblock and Backlog, which are about states a commitment cannot be in", () => {
    const rows = [commitmentRow()];
    expect(kept(rows, sf(), lf({ preset: "unblock" }))).toEqual([]);
    expect(kept(rows, sf(), lf({ preset: "backlog" }))).toEqual([]);
  });

  it("filters by verdict", () => {
    const rows = [
      commitmentRow(),
      commitmentRow({ node: n("commitment-2", "commitment", { verdict: "broken", timing: "active" }) }),
      commitmentRow({ node: n("commitment-3", "commitment", { verdict: "kept", timing: "active" }) }),
    ];
    const brokenOnly = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, verdict: [{ value: "broken", mode: "any" }] } });
    expect(kept(rows, sf({ statusMode: "all" }), brokenOnly)).toEqual(["commitment-2"]);
  });

  it("ignores the pill dimensions a commitment does not have", () => {
    // Asking to see in-progress tasks is not a reason to empty the commitments band: the
    // dimension does not apply, so it is not a test the row can fail.
    const withTaskPill = lf({
      pills: {
        ...DEFAULT_LIST_FILTER.pills,
        taskStatus: [{ value: "in_progress", mode: "any" }],
        blocked: [{ value: "blocked", mode: "any" }],
        dependency: [{ value: "task-9", mode: "any" }],
      },
    });
    expect(kept([commitmentRow()], sf(), withTaskPill)).toEqual(["commitment-1"]);
  });

  it("applies the parent pill", () => {
    const rows = [commitmentRow()];
    const matching = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, parent: [{ value: "project-1", mode: "any" }] } });
    const other = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, parent: [{ value: "project-2", mode: "any" }] } });
    expect(kept(rows, sf(), matching)).toEqual(["commitment-1"]);
    expect(kept(rows, sf(), other)).toEqual([]);
  });

  it("hides a commitment under a private ancestor outside Private Mode", () => {
    const rows = [commitmentRow({ hasPrivateAncestor: true })];
    expect(kept(rows)).toEqual([]);
    expect(kept(rows, sf({ privateMode: true }))).toEqual(["commitment-1"]);
  });

  it("hides a commitment under a shelved project in Plan", () => {
    const rows = [
      commitmentRow({ ancestors: [n("project-1", "project", { status: "frozen" })] }),
    ];
    expect(kept(rows, sf({ statusMode: "plan" }))).toEqual([]);
    expect(kept(rows, sf({ statusMode: "all" }))).toEqual(["commitment-1"]);
  });
});

describe("filterTaskListWithFocus — the focus exemption", () => {
  const done = row({ node: n("task-done", "task", { status: "done" }) });
  const todo = row({ node: n("task-todo", "task", { status: "todo" }) });

  it("keeps the row you just completed under Plan, for as long as it is focused", () => {
    const { rows, exemptedIds } = filterTaskListWithFocus([done, todo], sf({ statusMode: "plan" }), lf(), "task-done");
    expect(rows.map((r) => r.node.id)).toEqual(["task-done", "task-todo"]);
    expect(exemptedIds.has("task-done")).toBe(true);
  });

  it("lets it go once focus moves to another row", () => {
    const { rows } = filterTaskListWithFocus([done, todo], sf({ statusMode: "plan" }), lf(), "task-todo");
    expect(rows.map((r) => r.node.id)).toEqual(["task-todo"]);
  });

  it("lets it go when nothing is focused", () => {
    const { rows } = filterTaskListWithFocus([done, todo], sf({ statusMode: "plan" }), lf(), null);
    expect(rows.map((r) => r.node.id)).toEqual(["task-todo"]);
  });

  it("does not leak into the filter's own answer — filterTaskList still drops it", () => {
    expect(filterTaskList([done, todo], sf({ statusMode: "plan" }), lf()).map((r) => r.node.id)).toEqual(["task-todo"]);
  });

  it("overrides a List-View pill filter too, not just the status preset", () => {
    const listFilter = lf({ pills: { ...DEFAULT_LIST_FILTER.pills, taskStatus: [{ value: "todo", mode: "any" }] } });
    const { rows, exemptedIds } = filterTaskListWithFocus([done, todo], sf(), listFilter, "task-done");
    expect(rows.map((r) => r.node.id)).toEqual(["task-done", "task-todo"]);
    expect(exemptedIds.has("task-done")).toBe(true);
  });

  it("marks nothing exempt when the focused row matches on its own merits", () => {
    const { exemptedIds } = filterTaskListWithFocus([done, todo], sf({ statusMode: "plan" }), lf(), "task-todo");
    expect(exemptedIds.size).toBe(0);
  });
});
