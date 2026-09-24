import { describe, it, expect } from "vitest";
import { filterTree, filterTreeWithFocus, DEFAULT_FILTER } from "./filter-tree";
import { focusExemptPath } from "./focus-exemption";
import type { FilterState } from "./filter-tree";
import type { MindmapNode, NodeKind } from "./tree-layout";
import { testKey } from "@/test/scope-key";

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children, ...extra };
}

const f = (over: Partial<FilterState> = {}): FilterState => ({ ...DEFAULT_FILTER, ...over });

/** Collect kept node ids (depth-first) for concise assertions. */
function ids(node: MindmapNode): string[] {
  return [node.id, ...node.children.flatMap(ids)];
}

describe("filterTree — status modes", () => {
  // aspect → project → { goal(active) → [task todo, task done], task in_progress (no todo child) }
  const tree = () =>
    n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", {}, [
          n("goal-1", "goal", { status: "active" }, [
            n("task-todo", "task", { status: "todo" }),
            n("task-done", "task", { status: "done" }),
          ]),
          n("task-ip", "task", { status: "in_progress" }),
        ]),
      ]),
    ]);

  it("All shows everything", () => {
    expect(ids(filterTree(tree(), f({ statusMode: "all" })))).toContain("task-done");
  });

  it("Plan hides done tasks but keeps a done task that has an unresolved descendant", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "plan" })));
    expect(kept).not.toContain("task-done"); // leaf done task dropped
    expect(kept).toContain("task-todo");
    expect(kept).toContain("task-ip");
    expect(kept).toContain("project-1"); // structural container kept in Plan
  });

  it("Plan hides an achieved goal but shows the active container above it (for planning)", () => {
    const t = n("root", "domain", {}, [n("aspect-1", "aspect", {}, [n("goal-done", "goal", { status: "achieved" })])]);
    const kept = ids(filterTree(t, f({ statusMode: "plan" })));
    expect(kept).not.toContain("goal-done");
    expect(kept).toContain("aspect-1"); // active container still shown so you can plan in it
  });

  it("Plan shows an empty active project/domain but hides a resolved (archived) one", () => {
    const t = n("root", "domain", {}, [
      n("proj-active", "project", { status: "active" }, []),
      n("proj-archived", "project", { status: "archived" }, []),
      n("domain-active", "domain", { status: "active" }, []),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "plan" })));
    expect(kept).toContain("proj-active");
    expect(kept).toContain("domain-active");
    expect(kept).not.toContain("proj-archived");
  });

  it("Start still hides an empty active project (planning relaxation is Plan-only)", () => {
    const t = n("root", "domain", {}, [n("proj-active", "project", { status: "active" }, [])]);
    expect(ids(filterTree(t, f({ statusMode: "start" })))).not.toContain("proj-active");
  });

  it("All still shows empty containers", () => {
    const t = n("root", "domain", {}, [n("proj-empty", "project", {}, [n("g-done", "goal", { status: "achieved" })])]);
    expect(ids(filterTree(t, f({ statusMode: "all" })))).toContain("proj-empty");
  });

  it("Start drops an in-progress task with no todo child", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "start" })));
    expect(kept).not.toContain("task-ip"); // in_progress, no todo child
    expect(kept).toContain("task-todo");
  });

  it("Start drops a blocked task and a scope-lapsed task", () => {
    const t = n("root", "domain", {}, [
      n("t-blocked", "task", { status: "todo", blockReasons: ["waiting"] }),
      n("t-lapsed", "task", { status: "todo", timing: "lapsed" }),
      n("t-ok", "task", { status: "todo" }),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).not.toContain("t-blocked");
    expect(kept).not.toContain("t-lapsed");
    expect(kept).toContain("t-ok");
  });

  it("Start hard-hides a blocked task and its whole subtree (not kept as an ancestor)", () => {
    const t = n("root", "domain", {}, [
      n("t-blocked", "task", { status: "todo", blockReasons: ["waiting"] }, [
        n("t-child", "task", { status: "todo" }),
      ]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).not.toContain("t-blocked");
    expect(kept).not.toContain("t-child"); // gated behind the blocked parent
  });

  it("Start hard-hides a dependency-blocked goal that has a startable child", () => {
    const t = n("root", "domain", {}, [
      n("g-blocked", "goal", { status: "active", virtualBlockers: ["Blocked by task 9"] }, [
        n("t-under", "task", { status: "todo" }),
      ]),
    ]);
    expect(ids(filterTree(t, f({ statusMode: "start" })))).not.toContain("g-blocked");
  });

  it("Plan still shows a blocked/lapsed task (those exclusions are Start-only)", () => {
    const t = n("root", "domain", {}, [n("t-blocked", "task", { status: "todo", virtualBlockers: ["dep"] })]);
    expect(ids(filterTree(t, f({ statusMode: "plan" })))).toContain("t-blocked");
  });

  it("Start keeps an in-progress task that has a todo child", () => {
    const t = n("root", "domain", {}, [
      n("task-ip", "task", { status: "in_progress" }, [n("task-sub", "task", { status: "todo" })]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).toContain("task-ip");
    expect(kept).toContain("task-sub");
  });

  it("Do keeps in-progress tasks + their structural ancestors, dropping goals with no in-progress descendant", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "do" })));
    expect(kept).toContain("task-ip");
    expect(kept).toContain("project-1"); // ancestor of task-ip
    expect(kept).not.toContain("goal-1"); // its children are todo/done, no in_progress
    expect(kept).not.toContain("task-todo");
  });

  it("Do keeps a goal only when it has an in-progress descendant", () => {
    const t = n("root", "domain", {}, [
      n("goal-a", "goal", { status: "active" }, [n("t-ip", "task", { status: "in_progress" })]),
      n("goal-b", "goal", { status: "active" }, [n("t-todo", "task", { status: "todo" })]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "do" })));
    expect(kept).toContain("goal-a");
    expect(kept).toContain("t-ip");
    expect(kept).not.toContain("goal-b"); // no in-progress descendant
    expect(kept).not.toContain("t-todo");
  });
});

describe("filterTree — flows & habits", () => {
  const withFlow = (isHabit: boolean) =>
    n("root", "domain", {}, [
      n("flow-1", "flow", { flow: { instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit, rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null, verdictWindowN: null, verdictWindowKind: null } }, [
        n("flowtask-1", "flow_task", {}),
      ]),
      n("task-1", "task", { status: "todo" }),
    ]);

  it("global Flow toggle off hides the whole flow subtree", () => {
    const kept = ids(filterTree(withFlow(false), f({ showFlow: false })));
    expect(kept).not.toContain("flow-1");
    expect(kept).not.toContain("flowtask-1");
    expect(kept).toContain("task-1");
  });

  it("Plan with the per-mode flows subtoggle off hides flows even when the global toggle is on", () => {
    const kept = ids(filterTree(withFlow(false), f({ statusMode: "plan", modeIncludeFlows: false })));
    expect(kept).not.toContain("flow-1");
    expect(kept).toContain("task-1");
  });

  it("Start hides a Habit flow node but keeps a plain flow", () => {
    expect(ids(filterTree(withFlow(true), f({ statusMode: "start" })))).not.toContain("flow-1");
    expect(ids(filterTree(withFlow(false), f({ statusMode: "start" })))).toContain("flow-1");
  });
});

describe("filterTree — a habit occurrence whose window has not opened", () => {
  const occurrence = (cycleId: number) => ({
    flowId: 3, itemType: "flow_task" as const, itemId: 4, scopeId: testKey(100), cycleId,
  });

  // A daily habit's iteration at breakfast: the morning item's window is open, this evening's is
  // not. Both reach the frontend; only the preset decides which are drawn.
  const iteration = () =>
    n("root", "domain", {}, [
      n("project-1", "project", {}, [
        n("habit-3-0-virtual", "goal", { virtual: true, status: "active", timing: "active" }, [
          n("morning", "task", { virtual: true, status: "todo", timing: "active", habitItem: occurrence(11) }),
          n("evening", "task", { virtual: true, status: "todo", timing: "pending", habitItem: occurrence(12) }, [
            n("evening-step", "task", { virtual: true, status: "todo", timing: "active", habitItem: occurrence(13) }),
          ]),
        ]),
      ]),
    ]);

  it("All shows it — the bug was that no preset could, because it never left the backend", () => {
    const kept = ids(filterTree(iteration(), f({ statusMode: "all" })));
    expect(kept).toContain("evening");
    expect(kept).toContain("morning");
  });

  it("Plan, Start and Do hide it, with its subtree, exactly as before", () => {
    for (const statusMode of ["plan", "start", "do"] as const) {
      const kept = ids(filterTree(iteration(), f({ statusMode })));
      expect(kept, statusMode).not.toContain("evening");
      // The subtree goes with it: an open child must not keep an unopened parent on screen.
      expect(kept, statusMode).not.toContain("evening-step");
    }
    expect(ids(filterTree(iteration(), f({ statusMode: "plan" })))).toContain("morning");
  });

  it("the Archived pill does not reach it — an unopened window is not archived", () => {
    // Include force-shows what has finished; it has no business force-showing what has not started.
    const kept = ids(filterTree(iteration(), f({ statusMode: "plan", archivedMode: "include" })));
    expect(kept).not.toContain("evening");
  });

  it("leaves a real task whose window is still ahead alone — planning ahead is what Plan is for", () => {
    // `pending` is derived for any scoped item with its window ahead, not just habit occurrences.
    // Only the generated ones are hidden; a task scheduled for next week still plans.
    const t = n("root", "domain", {}, [n("next-week", "task", { status: "todo", timing: "pending" })]);
    expect(ids(filterTree(t, f({ statusMode: "plan" })))).toContain("next-week");
    expect(ids(filterTree(t, f({ statusMode: "start" })))).toContain("next-week");
  });
});

describe("filterTree — info nodes are attachments, never keep a resolved parent", () => {
  it("hides an achieved goal whose only children are info notes (Start)", () => {
    const t = n("root", "domain", {}, [
      n("goal-done", "goal", { status: "achieved" }, [n("info-1", "info"), n("info-2", "info", {}, [n("info-3", "info")])]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).not.toContain("goal-done");
    expect(kept).not.toContain("info-1");
  });

  it("keeps info notes under a task that is itself shown", () => {
    const t = n("root", "domain", {}, [n("task-1", "task", { status: "todo" }, [n("info-1", "info")])]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).toContain("task-1");
    expect(kept).toContain("info-1"); // rides along with its shown parent
  });

  it("keeps an achieved goal that also has a matching task child (info doesn't change that)", () => {
    const t = n("root", "domain", {}, [
      n("goal-done", "goal", { status: "achieved" }, [n("task-todo", "task", { status: "todo" }), n("info-1", "info")]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "start" })));
    expect(kept).toContain("goal-done"); // ancestor of the todo task
    expect(kept).toContain("info-1");
  });
});

describe("filterTree — type visibility", () => {
  const t = () => n("root", "domain", {}, [n("task-1", "task", { status: "todo" }, [n("info-1", "info")])]);

  it("hides info nodes when the Info toggle is off", () => {
    expect(ids(filterTree(t(), f({ showInfo: false })))).not.toContain("info-1");
    expect(ids(filterTree(t(), f({ showInfo: true })))).toContain("info-1");
  });
});

describe("filterTree — tag filters (Any/All/Exclude)", () => {
  const t = () =>
    n("root", "domain", {}, [
      n("t-ab", "task", { status: "todo", tagIds: [1, 2] }),
      n("t-a", "task", { status: "todo", tagIds: [1] }),
      n("t-none", "task", { status: "todo", tagIds: [] }),
    ]);

  it("Any keeps tasks with at least one of the any-tags", () => {
    const kept = ids(filterTree(t(), f({ tagFilters: [{ tagId: 1, mode: "any" }] })));
    expect(kept).toEqual(expect.arrayContaining(["t-ab", "t-a"]));
    expect(kept).not.toContain("t-none");
  });

  it("All requires every all-tag", () => {
    const kept = ids(filterTree(t(), f({ tagFilters: [{ tagId: 1, mode: "all" }, { tagId: 2, mode: "all" }] })));
    expect(kept).toContain("t-ab");
    expect(kept).not.toContain("t-a");
  });

  it("Exclude drops tasks carrying an excluded tag", () => {
    const kept = ids(filterTree(t(), f({ tagFilters: [{ tagId: 2, mode: "exclude" }] })));
    expect(kept).not.toContain("t-ab");
    expect(kept).toContain("t-a");
    expect(kept).toContain("t-none");
  });
});

describe("filterTree — archived mode (Archived status + scope-Lapsed override)", () => {
  const t = () =>
    n("root", "domain", {}, [
      n("goal-archived", "goal", { status: "archived" }),
      n("t-lapsed", "task", { status: "todo", timing: "lapsed", resolution: "missed", archived: true }),
      n("t-ok", "task", { status: "todo" }),
    ]);

  it("All shows everything", () => {
    expect(ids(filterTree(t(), f({ statusMode: "all" })))).toEqual(
      expect.arrayContaining(["goal-archived", "t-lapsed"]),
    );
  });

  it("Plan hides archived items by default, not just via explicit Exclude", () => {
    const plan = ids(filterTree(t(), f({ statusMode: "plan" })));
    expect(plan).not.toContain("goal-archived");
    expect(plan).not.toContain("t-lapsed");
    expect(plan).toContain("t-ok");
  });

  it("Start hides archived items by default", () => {
    const start = ids(filterTree(t(), f({ statusMode: "start" })));
    expect(start).not.toContain("goal-archived");
    expect(start).not.toContain("t-lapsed");
  });

  it("Plan hides a goal whose stored status is active but whose scope forced it archived", () => {
    const t = n("root", "domain", {}, [n("goal-forced", "goal", { status: "active", archived: true })]);
    expect(ids(filterTree(t, f({ statusMode: "plan" })))).not.toContain("goal-forced");
  });

  it("Plan hides a frozen goal by default", () => {
    const t = n("root", "domain", {}, [n("goal-frozen", "goal", { status: "frozen" })]);
    expect(ids(filterTree(t, f({ statusMode: "plan" })))).not.toContain("goal-frozen");
  });

  it("include forces archived/lapsed items to show under Plan and Start (now needed under Plan too, since it hides them by default)", () => {
    const plan = ids(filterTree(t(), f({ statusMode: "plan", archivedMode: "include" })));
    expect(plan).toContain("goal-archived");
    expect(plan).toContain("t-lapsed");
    const start = ids(filterTree(t(), f({ statusMode: "start", archivedMode: "include" })));
    expect(start).toContain("goal-archived");
    expect(start).toContain("t-lapsed");
  });

  it("exclude force-hides archived/lapsed items even under All", () => {
    const kept = ids(filterTree(t(), f({ statusMode: "all", archivedMode: "exclude" })));
    expect(kept).not.toContain("goal-archived");
    expect(kept).not.toContain("t-lapsed");
    expect(kept).toContain("t-ok");
  });

  it("does not affect achieved/frozen goals — only Archived status and Lapsed lifecycle", () => {
    const achieved = n("root", "domain", {}, [n("goal-achieved", "goal", { status: "achieved" })]);
    expect(ids(filterTree(achieved, f({ statusMode: "plan", archivedMode: "include" })))).not.toContain("goal-achieved");
  });

  it("an archived structural container (project) responds to archivedMode under Plan", () => {
    const withProj = n("root", "domain", {}, [n("proj-archived", "project", { status: "archived" }, [])]);
    expect(ids(filterTree(withProj, f({ statusMode: "plan" })))).not.toContain("proj-archived");
    expect(ids(filterTree(withProj, f({ statusMode: "plan", archivedMode: "include" })))).toContain("proj-archived");
  });

  it("has no effect under Do (which already shows only in-progress tasks)", () => {
    const kept = ids(filterTree(t(), f({ statusMode: "do", archivedMode: "include" })));
    expect(kept).not.toContain("goal-archived"); // Do never shows goals as self-matches
  });

  it("catches a completed-but-past-window item too, not just an unresolved one (the original report)", () => {
    // A Done task/Achieved goal whose scope has lapsed is now also `archived: true` (Resolution
    // Completed forces effective Archival, same as Missed) — this is the actual bug that was
    // reported: a done item beyond its scope wasn't being treated as archived at all.
    const completed = n("root", "domain", {}, [
      n("t-completed-lapsed", "task", { status: "done", timing: "lapsed", resolution: "completed", archived: true }),
      n("t-ok", "task", { status: "todo" }),
    ]);
    const kept = ids(filterTree(completed, f({ statusMode: "all", archivedMode: "exclude" })));
    expect(kept).not.toContain("t-completed-lapsed");
    expect(kept).toContain("t-ok");
  });

  it("exclude hard-hides the whole subtree, even when a sibling child is an ordinarily-visible done task (regression)", () => {
    // A lapsed Habit-instance goal (e.g. "לאכול ארוחות נורמליות") with three item children: two
    // already marked done (unscoped, no lifecycle of their own — plain done tasks, self-matching
    // under All/Plan on their own merit) and one still-undone item (also lapsed, since it shares the
    // root's "past" flag). Failing only the root's own self-match isn't enough — the done siblings'
    // own self-match kept the root visible anyway as their ancestor. Exclude must drop the whole subtree.
    const habitInstance = n("root", "domain", {}, [
      n("habit-instance", "goal", { status: "active", timing: "lapsed", resolution: "missed", archived: true }, [
        n("item-done-1", "task", { status: "done" }),
        n("item-undone", "task", { status: "todo", timing: "lapsed", resolution: "missed", archived: true }),
        n("item-done-2", "task", { status: "done" }),
      ]),
    ]);
    for (const statusMode of ["all", "plan", "start"] as const) {
      const kept = ids(filterTree(habitInstance, f({ statusMode, archivedMode: "exclude" })));
      expect(kept, `under ${statusMode}`).not.toContain("habit-instance");
      expect(kept, `under ${statusMode}`).not.toContain("item-done-1");
      expect(kept, `under ${statusMode}`).not.toContain("item-undone");
      expect(kept, `under ${statusMode}`).not.toContain("item-done-2");
    }
  });
});

describe("filterTree — Private Mode reveals private subtrees", () => {
  const t = () =>
    n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("task-clean", "task", { status: "todo" }),
        n("task-private", "task", { status: "todo", isPrivate: true }, [n("child", "task", { status: "todo" })]),
      ]),
    ]);

  it("drops a private node and its whole subtree when Private Mode is off", () => {
    const kept = ids(filterTree(t(), f({ privateMode: false })));
    expect(kept).not.toContain("task-private");
    expect(kept).not.toContain("child");
    expect(kept).toContain("task-clean");
  });

  it("keeps a private node and its subtree when Private Mode is on", () => {
    const kept = ids(filterTree(t(), f({ privateMode: true })));
    expect(kept).toContain("task-private");
    expect(kept).toContain("child");
  });
});

describe("filterTree — a status-less container inherits its nearest status-bearing ancestor", () => {
  const plan = f({ statusMode: "plan" });

  it("hides a status-less domain under an achieved project, so the project drops out too", () => {
    const t = n("root", "domain", {}, [
      n("project-achieved", "project", { status: "achieved" }, [n("domain-1", "domain")]),
    ]);
    const kept = ids(filterTree(t, plan));
    expect(kept).not.toContain("domain-1");
    expect(kept).not.toContain("project-achieved");
  });

  it("hides a status-less domain under an archived project too", () => {
    const t = n("root", "domain", {}, [
      n("project-archived", "project", { status: "archived" }, [n("domain-1", "domain")]),
    ]);
    expect(ids(filterTree(t, plan))).not.toContain("domain-1");
  });

  it("still shows a status-less domain under an active project (planning into an empty one)", () => {
    const t = n("root", "domain", {}, [
      n("project-active", "project", { status: "active" }, [n("domain-1", "domain")]),
    ]);
    const kept = ids(filterTree(t, plan));
    expect(kept).toContain("domain-1");
    expect(kept).toContain("project-active");
  });

  it("inherits through an intermediate status-less domain (the reported COMMAND case)", () => {
    const t = n("root", "domain", {}, [
      n("project-achieved", "project", { status: "achieved" }, [
        n("domain-outer", "domain", {}, [n("domain-inner", "domain")]),
      ]),
    ]);
    const kept = ids(filterTree(t, plan));
    expect(kept).not.toContain("domain-inner");
    expect(kept).not.toContain("domain-outer");
    expect(kept).not.toContain("project-achieved");
  });

  it("treats a domain with no status-bearing ancestor at all as active", () => {
    const t = n("root", "domain", {}, [n("aspect-1", "aspect", {}, [n("domain-1", "domain")])]);
    expect(ids(filterTree(t, plan))).toContain("domain-1");
  });

  it("keeps an achieved project whose subtree still holds an unresolved task", () => {
    const t = n("root", "domain", {}, [
      n("project-achieved", "project", { status: "achieved" }, [
        n("domain-1", "domain", {}, [n("task-todo", "task", { status: "todo" })]),
      ]),
    ]);
    const kept = ids(filterTree(t, plan));
    expect(kept).toContain("task-todo");
    expect(kept).toContain("domain-1");
    expect(kept).toContain("project-achieved");
  });
});

describe("filterTree — a Frozen/Archived Project shelves its whole subtree", () => {
  const shelved = (status: string) =>
    n("root", "domain", {}, [
      n("project-shelved", "project", { status }, [
        n("domain-1", "domain", {}, [n("task-todo", "task", { status: "todo" })]),
      ]),
    ]);

  it("hides a frozen project and its unresolved work in Plan", () => {
    const kept = ids(filterTree(shelved("frozen"), f({ statusMode: "plan" })));
    expect(kept).not.toContain("project-shelved");
    expect(kept).not.toContain("domain-1");
    expect(kept).not.toContain("task-todo");
  });

  it("hides a frozen project and its unresolved work in Start", () => {
    expect(ids(filterTree(shelved("frozen"), f({ statusMode: "start" })))).not.toContain("task-todo");
  });

  it("hides an archived project and its unresolved work in Plan", () => {
    expect(ids(filterTree(shelved("archived"), f({ statusMode: "plan" })))).not.toContain("task-todo");
  });

  it("still shows an achieved project holding unresolved work (achieved is deliberately softer)", () => {
    const kept = ids(filterTree(shelved("achieved"), f({ statusMode: "plan" })));
    expect(kept).toContain("project-shelved");
    expect(kept).toContain("task-todo");
  });

  it("shows a frozen project under All, as before", () => {
    expect(ids(filterTree(shelved("frozen"), f({ statusMode: "all" })))).toContain("task-todo");
  });

  it("archivedMode include brings an archived project's subtree back under Plan", () => {
    const kept = ids(filterTree(shelved("archived"), f({ statusMode: "plan", archivedMode: "include" })));
    expect(kept).toContain("project-shelved");
    expect(kept).toContain("task-todo");
  });
});

describe("filterTree — Backlog", () => {
  // project → backlogged task → [sub-step, a note] ; plus an ordinary sibling task.
  const tree = () =>
    n("root", "domain", {}, [
      n("project-1", "project", { status: "active" }, [
        n("task-aside", "task", { status: "in_progress", backlogged: true }, [
          n("task-substep", "task", { status: "todo" }),
        ]),
        n("task-live", "task", { status: "todo" }),
      ]),
    ]);

  it("Plan hides a backlogged task together with its whole subtree", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "plan" })));
    expect(kept).not.toContain("task-aside");
    expect(kept).not.toContain("task-substep");
    expect(kept).toContain("task-live");
  });

  it("Start hides a backlogged task together with its whole subtree", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "start" })));
    expect(kept).not.toContain("task-aside");
    expect(kept).not.toContain("task-substep");
    expect(kept).toContain("task-live");
  });

  it("All shows a backlogged task — nothing set aside is ever actually lost", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "all" })));
    expect(kept).toContain("task-aside");
    expect(kept).toContain("task-substep");
  });

  it("Do is unaffected: it already shows only in-progress tasks", () => {
    expect(ids(filterTree(tree(), f({ statusMode: "do" })))).toContain("task-aside");
  });

  it("the Backlog preset shows only what was set aside, plus its subtree", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "backlog" })));
    expect(kept).toContain("task-aside");
    expect(kept).toContain("task-substep");
    expect(kept).not.toContain("task-live");
  });

  it("the Backlog preset keeps containers only as ancestors of a set-aside task", () => {
    const empty = n("root", "domain", {}, [
      n("project-empty", "project", { status: "active" }, [n("task-live", "task", { status: "todo" })]),
    ]);
    expect(ids(filterTree(empty, f({ statusMode: "backlog" })))).not.toContain("project-empty");
    expect(ids(filterTree(tree(), f({ statusMode: "backlog" })))).toContain("project-1");
  });

  it("the Backlog pill's Include force-shows a backlogged task under Plan and Start", () => {
    for (const statusMode of ["plan", "start"] as const) {
      const kept = ids(filterTree(tree(), f({ statusMode, backlogMode: "include" })));
      expect(kept).toContain("task-aside");
      expect(kept).toContain("task-substep");
    }
  });

  it("the Backlog pill's Exclude force-hides the subtree even under All", () => {
    const kept = ids(filterTree(tree(), f({ statusMode: "all", backlogMode: "exclude" })));
    expect(kept).not.toContain("task-aside");
    expect(kept).not.toContain("task-substep");
    expect(kept).toContain("task-live");
  });

  it("Inactive defers to the preset, exactly as the Archived pill does", () => {
    expect(ids(filterTree(tree(), f({ statusMode: "all", backlogMode: "inactive" })))).toContain("task-aside");
    expect(ids(filterTree(tree(), f({ statusMode: "plan", backlogMode: "inactive" })))).not.toContain("task-aside");
  });

  it("leaves a goal alone — Backlog is a Task-only state", () => {
    const withGoal = n("root", "domain", {}, [
      n("goal-1", "goal", { status: "active" }, [n("task-aside", "task", { status: "todo", backlogged: true })]),
    ]);
    expect(ids(filterTree(withGoal, f({ statusMode: "plan" })))).toContain("goal-1");
  });
});

describe("filterTree — commitments", () => {
  /** A commitment under a project, with the verdict and window position a case needs. */
  const tree = (extra: Partial<MindmapNode>) =>
    n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", {}, [n("commitment-1", "commitment", extra)]),
      ]),
    ]);

  const shows = (extra: Partial<MindmapNode>, mode: FilterState["statusMode"]): boolean =>
    ids(filterTree(tree(extra), f({ statusMode: mode }))).includes("commitment-1");

  it("All shows every commitment, including ones already judged", () => {
    // Looking back over what you kept and broke is the point of keeping the record.
    for (const verdict of ["unresolved", "kept", "broken"] as const) {
      expect(shows({ verdict, timing: "lapsed" }, "all")).toBe(true);
    }
  });

  it("Plan, Start and Do all show what has yet to be judged", () => {
    for (const mode of ["plan", "start", "do"] as const) {
      expect(shows({ verdict: "unresolved", timing: "active" }, mode)).toBe(true);
    }
  });

  it("a kept commitment drops out of Plan, Start and Do — it is settled", () => {
    for (const mode of ["plan", "start", "do"] as const) {
      expect(shows({ verdict: "kept", timing: "active" }, mode)).toBe(false);
    }
  });

  it("Plan, Start and Do drop a broken commitment even while its window is still open", () => {
    // A Broken verdict is an answer, like Kept, and Plan hides what is answered the way it hides a
    // done Task (ruled 2026-09-23; the old open-window carve-out is gone).
    for (const mode of ["plan", "start", "do"] as const) {
      expect(shows({ verdict: "broken", timing: "active" }, mode)).toBe(false);
      expect(shows({ verdict: "broken", timing: "pending" }, mode)).toBe(false);
    }
  });

  it("Plan drops a broken commitment once its window has closed", () => {
    expect(shows({ verdict: "broken", timing: "lapsed" }, "plan")).toBe(false);
  });

  it("the broken-while-open carve-out belongs to Plan alone", () => {
    // Start and Do are about what you are currently on, and a broken commitment is not something
    // to start or to be doing — it is something to notice while planning.
    for (const mode of ["start", "do"] as const) {
      expect(shows({ verdict: "broken", timing: "active" }, mode)).toBe(false);
    }
  });

  it("a commitment with no verdict field at all reads as unresolved", () => {
    // Absent is not a fourth state: it is the one that means nobody has said.
    expect(shows({ timing: "active" }, "plan")).toBe(true);
    expect(shows({ timing: "active" }, "start")).toBe(true);
  });

  it("Backlog shows no commitments — a commitment has no backlog to be in", () => {
    for (const verdict of ["unresolved", "kept", "broken"] as const) {
      expect(shows({ verdict, timing: "active" }, "backlog")).toBe(false);
    }
  });

  it("a commitment is hidden with its private subtree outside Private Mode", () => {
    const t = tree({ verdict: "unresolved", isPrivate: true });
    expect(ids(filterTree(t, f({ statusMode: "all" })))).not.toContain("commitment-1");
    expect(ids(filterTree(t, f({ statusMode: "all", privateMode: true })))).toContain("commitment-1");
  });

  it("a commitment keeps its task children visible even once it is settled itself", () => {
    // The commitment is kept as an ancestor of a content match, exactly as any other node is.
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", {}, [
          n("commitment-1", "commitment", { verdict: "kept", timing: "active" }, [
            n("task-1", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);
    const kept = ids(filterTree(t, f({ statusMode: "plan" })));
    expect(kept).toContain("task-1");
    expect(kept).toContain("commitment-1");
  });
});

describe("filterTreeWithFocus — the focus exemption", () => {
  // aspect → project → goal → { task-done, task-todo }, plus a second aspect holding a private project.
  const tree = () =>
    n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("goal-1", "goal", { status: "active" }, [
            n("task-done", "task", { status: "done" }),
            n("task-todo", "task", { status: "todo" }),
          ]),
        ]),
      ]),
    ]);

  const exempt = (root: MindmapNode, id: string | null) => focusExemptPath(root, id);

  // The Mindmap's exemption is kind-blind, so a Commitment is held already (Arlesh-3tt checked it).
  it("keeps a Commitment you just marked Kept under Plan, and marks it exempt", () => {
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [n("commitment-1", "commitment", { verdict: "kept", timing: "active" })]),
    ]);
    const { root, exemptedIds } = filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "commitment-1"));
    expect(ids(root)).toContain("commitment-1");
    expect(exemptedIds.has("commitment-1")).toBe(true);
  });

  it("keeps a task you just completed under Plan, for as long as it is focused", () => {
    const t = tree();
    const { root } = filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-done"));
    expect(ids(root)).toContain("task-done");
  });

  it("marks it exempt, so it renders dimmed rather than as an ordinary match", () => {
    const t = tree();
    const { exemptedIds } = filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-done"));
    expect(exemptedIds.has("task-done")).toBe(true);
    expect(exemptedIds.has("task-todo")).toBe(false);
  });

  it("lets the node go once focus moves elsewhere", () => {
    const t = tree();
    const { root } = filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-todo"));
    expect(ids(root)).not.toContain("task-done");
  });

  it("lets the node go when nothing is focused", () => {
    const t = tree();
    expect(ids(filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, null)).root)).not.toContain("task-done");
  });

  it("does not leak into the filter's own answer — filterTree still drops it", () => {
    expect(ids(filterTree(tree(), f({ statusMode: "plan" })))).not.toContain("task-done");
  });

  it("renders the focused node's ancestors with it, so it is never drawn detached", () => {
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("project-1", "project", { status: "active" }, [
          n("goal-achieved", "goal", { status: "achieved" }, [n("task-done", "task", { status: "done" })]),
        ]),
      ]),
    ]);
    const kept = ids(filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-done")).root);
    expect(kept).toEqual(expect.arrayContaining(["root", "aspect-1", "project-1", "goal-achieved", "task-done"]));
  });

  it("dims an ancestor the filter would have dropped, but not one it was keeping anyway", () => {
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("goal-achieved", "goal", { status: "achieved" }, [n("task-done", "task", { status: "done" })]),
        n("task-other", "task", { status: "todo" }),
      ]),
    ]);
    const { exemptedIds } = filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-done"));
    expect(exemptedIds.has("goal-achieved")).toBe(true);
    expect(exemptedIds.has("aspect-1")).toBe(false); // still holds task-other on its own merits
  });

  it("overrides a hard hiding rule: a node you just marked private stays while you are on it", () => {
    const t = n("root", "domain", {}, [n("aspect-1", "aspect", {}, [n("task-secret", "task", { status: "todo", isPrivate: true })])]);
    const { root, exemptedIds } = filterTreeWithFocus(t, f(), exempt(t, "task-secret"));
    expect(ids(root)).toContain("task-secret");
    expect(exemptedIds.has("task-secret")).toBe(true);
  });

  it("carries a hard-hidden ancestor without spilling the rest of its subtree", () => {
    const t = n("root", "domain", {}, [
      n("project-private", "project", { status: "active", isPrivate: true }, [
        n("task-focused", "task", { status: "todo" }),
        n("task-sibling", "task", { status: "todo" }),
      ]),
    ]);
    const kept = ids(filterTreeWithFocus(t, f(), exempt(t, "task-focused")).root);
    expect(kept).toContain("project-private");
    expect(kept).toContain("task-focused");
    expect(kept).not.toContain("task-sibling");
  });

  it("does not reveal the focused node's own hidden children", () => {
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("task-done", "task", { status: "done" }, [n("task-child-done", "task", { status: "done" })]),
      ]),
    ]);
    const kept = ids(filterTreeWithFocus(t, f({ statusMode: "plan" }), exempt(t, "task-done")).root);
    expect(kept).toContain("task-done");
    expect(kept).not.toContain("task-child-done");
  });

  it("keeps a Task you just cycled to a Goal under Do, where Do shows in-progress tasks only", () => {
    const t = n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [n("goal-1", "goal", { status: "active" })]),
    ]);
    const before = ids(filterTree(t, f({ statusMode: "do" })));
    expect(before).not.toContain("goal-1");
    const { root, exemptedIds } = filterTreeWithFocus(t, f({ statusMode: "do" }), exempt(t, "goal-1"));
    expect(ids(root)).toContain("goal-1");
    expect(exemptedIds.has("goal-1")).toBe(true);
  });
});
