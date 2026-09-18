import { describe, it, expect } from "vitest";
import { filterTree, hiddenNodeKinds, DEFAULT_FILTER } from "./filter-tree";
import type { FilterState } from "./filter-tree";
import type { MindmapNode, NodeKind } from "./tree-layout";

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
      n("flow-1", "flow", { flow: { instanceType: "task", targetType: null, targetId: null, durationN: 1, durationKind: "week", windowPart: null, windowTimeStart: null, windowTimeEnd: null, isHabit, rootPlanKind: null, rootPlanStart: null, rootPlanEnd: null } }, [
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

describe("hiddenNodeKinds", () => {
  it("hides nothing under the default filter", () => {
    expect(hiddenNodeKinds(DEFAULT_FILTER)).toEqual([]);
  });

  it("names info when the Info toggle is off", () => {
    expect(hiddenNodeKinds(f({ showInfo: false }))).toEqual(["info"]);
  });

  it("names the flow kinds when the Flow toggle is off", () => {
    expect(hiddenNodeKinds(f({ showFlow: false }))).toEqual(["flow", "flow_goal", "flow_task"]);
  });

  it("names no kind for Private Mode, which hides particular nodes rather than a whole kind", () => {
    expect(hiddenNodeKinds(f({ privateMode: false }))).toEqual([]);
  });

  it("names no kind for a status preset, which judges each node on its own status", () => {
    for (const statusMode of ["plan", "start", "do"] as const) {
      expect(hiddenNodeKinds(f({ statusMode }))).toEqual([]);
    }
  });

  it("names no kind for the Archived tri-state, which judges each node's own archival", () => {
    expect(hiddenNodeKinds(f({ archivedMode: "exclude" }))).toEqual([]);
  });
});
