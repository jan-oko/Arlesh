import { describe, it, expect } from "vitest";
import { filterTree, DEFAULT_FILTER } from "./filter-tree";
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
      n("t-lapsed", "task", { status: "todo", scopeLifecycle: "lapsed" }),
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

describe("filterTree — Work mode hides NSFW subtrees", () => {
  const t = () =>
    n("root", "domain", {}, [
      n("aspect-1", "aspect", {}, [
        n("task-clean", "task", { status: "todo" }),
        n("task-nsfw", "task", { status: "todo", nsfw: true }, [n("child", "task", { status: "todo" })]),
      ]),
    ]);

  it("keeps the NSFW node and its subtree when Work mode is off", () => {
    const kept = ids(filterTree(t(), f({ workMode: false })));
    expect(kept).toContain("task-nsfw");
    expect(kept).toContain("child");
  });

  it("drops the NSFW node and its whole subtree when Work mode is on", () => {
    const kept = ids(filterTree(t(), f({ workMode: true })));
    expect(kept).not.toContain("task-nsfw");
    expect(kept).not.toContain("child");
    expect(kept).toContain("task-clean");
  });
});
