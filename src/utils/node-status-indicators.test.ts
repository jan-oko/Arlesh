import { describe, it, expect } from "vitest";
import { deriveStatusIndicators } from "./node-status-indicators";
import type { StatusIndicatorType } from "./node-status-indicators";
import type { MindmapNode, NodeKind } from "./tree-layout";

function node(kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: `${kind}-1`, kind, title: kind, position: 0, tagIds: [], children: [], ...extra };
}

const scope = { start_id: 10, end_id: 12 };

/** The set of indicator types produced for a node, for order-independent assertions. */
function types(n: MindmapNode): StatusIndicatorType[] {
  return deriveStatusIndicators(n).map((i) => i.type);
}

describe("deriveStatusIndicators — Agentic", () => {
  it("badges a task that flagged itself", () => {
    expect(types(node("task", { status: "todo", agentic: true }))).toContain("agentic");
  });

  it("badges a task that inherited the flag, exactly like one that carries it", () => {
    // A branch marked in one edit would otherwise look unmarked everywhere below the node it was
    // set on, which is the opposite of what marking a branch is for.
    expect(types(node("task", { status: "todo", inheritedAgentic: true }))).toContain("agentic");
  });

  it("does not badge a task that overrode an agentic ancestor", () => {
    expect(types(node("task", { status: "todo", agentic: false, inheritedAgentic: true })))
      .not.toContain("agentic");
  });

  it("does not badge an unflagged task", () => {
    expect(types(node("task", { status: "todo" }))).not.toContain("agentic");
  });

  it("does not badge a goal or a commitment under an agentic task", () => {
    expect(types(node("goal", { status: "active", inheritedAgentic: true }))).not.toContain("agentic");
    expect(types(node("commitment", { inheritedAgentic: true }))).not.toContain("agentic");
  });

  it("sits alongside the other badges rather than replacing any of them", () => {
    const flagged = node("task", { status: "todo", agentic: true, backlogged: true, tagIds: [3] });
    expect(types(flagged)).toEqual(["backlog", "agentic", "tags"]);
  });
});

describe("deriveStatusIndicators — Asynchronous", () => {
  it("badges a task whose doing starts a wait", () => {
    expect(types(node("task", { status: "todo", asynchronous: true }))).toContain("asynchronous");
  });

  it("does not badge an unflagged task", () => {
    expect(types(node("task", { status: "todo" }))).not.toContain("asynchronous");
  });

  it("does not badge a child of an asynchronous task — the flag does not inherit", () => {
    // Deliberately unlike Agentic. A subtask of a Task that starts a wait is usually the work you
    // do *after* the wait, so badging it would say the opposite of the truth.
    const parent = node("task", { status: "todo", asynchronous: true });
    const child = node("task", { status: "todo" });
    expect(types({ ...parent, children: [child] })).toContain("asynchronous");
    expect(types(child)).not.toContain("asynchronous");
  });

  it("sits alongside the other badges rather than replacing any of them", () => {
    const flagged = node("task", { status: "todo", agentic: true, asynchronous: true, tagIds: [3] });
    expect(types(flagged)).toEqual(["agentic", "asynchronous", "tags"]);
  });
});

describe("deriveStatusIndicators", () => {
  it("returns no indicators for a bare task", () => {
    expect(deriveStatusIndicators(node("task", { status: "todo" }))).toEqual([]);
  });

  it("shows a scope clock (not out of scope) for an active scoped task", () => {
    const indicators = deriveStatusIndicators(node("task", { timeScope: scope, timing: "active" }));
    expect(indicators).toEqual([{ type: "scope", outOfScope: false }]);
  });

  it("crosses out the clock and adds an exclamation for an overdue (kept) item", () => {
    const indicators = deriveStatusIndicators(node("task", { timeScope: scope, timing: "lapsed", resolution: "overdue" }));
    expect(indicators).toEqual([
      { type: "scope", outOfScope: true },
      { type: "overdue" },
    ]);
  });

  it("crosses out the clock and adds an archive mark for a missed (archived) item", () => {
    const indicators = deriveStatusIndicators(node("task", { timeScope: scope, timing: "lapsed", resolution: "missed", archived: true }));
    expect(indicators).toEqual([
      { type: "scope", outOfScope: true },
      { type: "archived", conflict: false },
    ]);
  });

  it("crosses out the clock and adds an archive mark for a completed-but-past-window item too", () => {
    // The original bug report: a Done/Achieved item beyond its scope should also archive.
    const indicators = deriveStatusIndicators(node("task", { status: "done", timeScope: scope, timing: "lapsed", resolution: "completed", archived: true }));
    expect(indicators).toEqual([
      { type: "scope", outOfScope: true },
      { type: "archived", conflict: false },
    ]);
  });

  it("shows an archive mark for a goal with archived status even without a scope", () => {
    expect(types(node("goal", { status: "archived" }))).toEqual(["archived"]);
  });

  it("flags a conflict when effective archival overrode a manually-set Frozen status", () => {
    const indicators = deriveStatusIndicators(
      node("goal", { status: "frozen", timeScope: scope, timing: "lapsed", resolution: "missed", archived: true, archivalConflict: true }),
    );
    expect(indicators).toContainEqual({ type: "archived", conflict: true });
  });

  it("shows a frozen mark for a frozen goal or project", () => {
    expect(types(node("goal", { status: "frozen" }))).toEqual(["frozen"]);
    expect(types(node("project", { status: "frozen" }))).toEqual(["frozen"]);
  });

  it("shows a calendar for a planned task", () => {
    expect(types(node("task", { status: "todo", plan: scope }))).toEqual(["planned"]);
  });

  it("shows an info mark only for an info node that has details", () => {
    expect(types(node("info", { infoDetails: "a stack trace" }))).toEqual(["info"]);
    expect(types(node("info", { infoDetails: null }))).toEqual([]);
    expect(types(node("info", { infoDetails: "" }))).toEqual([]);
  });

  it("shows a flow-instance mark for a materialized (fromFlow) node and a virtual habit instance", () => {
    expect(types(node("task", { status: "todo", fromFlow: true }))).toEqual(["flowInstance"]);
    const habit = node("task", { status: "todo", habitItem: { flowId: 1, itemType: "flow_root", itemId: 1, scopeId: 5, cycleId: 0 } });
    expect(types(habit)).toEqual(["flowInstance"]);
  });

  it("shows a tag mark when the node carries tags", () => {
    expect(types(node("task", { status: "todo", tagIds: [3, 7] }))).toEqual(["tags"]);
    expect(types(node("task", { status: "todo", tagIds: [] }))).toEqual([]);
  });

  it("orders indicators consistently: scope, overdue, archived, planned, frozen, info, flowInstance, tags", () => {
    // A lapsed, planned, flow-originated task with tags exercises several at once.
    const busy = node("task", {
      status: "todo",
      timeScope: scope,
      timing: "lapsed",
      resolution: "missed",
      archived: true,
      plan: scope,
      fromFlow: true,
      tagIds: [1],
    });
    expect(types(busy)).toEqual(["scope", "archived", "planned", "flowInstance", "tags"]);
  });
});

describe("deriveStatusIndicators — Backlog", () => {
  it("shows a backlog badge on a task that was set aside", () => {
    expect(types(node("task", { status: "todo", backlogged: true }))).toEqual(["backlog"]);
    expect(types(node("task", { status: "todo", backlogged: false }))).toEqual([]);
  });

  it("uses a badge of its own, never the Frozen snowflake", () => {
    const badges = types(node("task", { status: "todo", backlogged: true }));
    expect(badges).not.toContain("frozen");
  });

  it("shows both badges once a lapsed window has archived a backlogged task", () => {
    // The conflict case: the stored Backlog still reads as set aside, and the forced Archived is
    // flagged on top of it — the same pairing a manually-Frozen goal already gets.
    const lapsed = node("task", {
      status: "todo", backlogged: true,
      timing: "lapsed", resolution: "missed", archived: true, archivalConflict: true,
    });
    expect(types(lapsed)).toEqual(["archived", "backlog"]);
  });
});

describe("deriveStatusIndicators — a commitment's verdict is the glyph's, not the row's", () => {
  it("adds no verdict badge, whatever the verdict is", () => {
    // The node glyph carries it — hollow while the answer is owed, solid once given, cleft when
    // broken, struck through when the Verdict Window ran out — so a badge would say the same
    // thing a few pixels below it.
    for (const verdict of [undefined, "unresolved", "kept", "broken"] as const) {
      const overrides = verdict === undefined ? {} : { verdict };
      expect(types(node("commitment", overrides))).toEqual([]);
    }
  });

  it("still shows what the glyph does not say", () => {
    const archived = node("commitment", {
      verdict: "unresolved",
      timeScope: scope,
      timing: "lapsed",
      archived: true,
    });
    // The window and the archive box stay: neither is something the shape of the node states.
    expect(types(archived)).toEqual(["scope", "archived"]);
  });
});

describe("deriveStatusIndicators — a Habit occurrence planned on its own", () => {
  it("badges the effective plan of an occurrence that follows its Cycle Plan, unmarked", () => {
    const inherited = node("task", { status: "todo", plan: scope, planOverridden: false });
    expect(deriveStatusIndicators(inherited)).toEqual([{ type: "planned" }]);
  });

  it("marks an occurrence whose plan is its own", () => {
    const own = node("task", { status: "todo", plan: scope, planOverridden: true });
    expect(deriveStatusIndicators(own)).toEqual([{ type: "planned", overridden: true }]);
  });

  it("keeps a struck-through badge on an occurrence deliberately left unplanned", () => {
    const cleared = node("task", { status: "todo", plan: null, planOverridden: true });
    expect(deriveStatusIndicators(cleared)).toEqual([
      { type: "planned", overridden: true, unplanned: true },
    ]);
  });

  it("draws no badge on an occurrence with no plan that nobody touched", () => {
    expect(types(node("task", { status: "todo", plan: null, planOverridden: false }))).toEqual([]);
  });
});

describe("deriveStatusIndicators — a Habit occurrence deleted on its own", () => {
  it("draws the archive badge, saying the occurrence was deleted rather than archived", () => {
    const deleted = node("task", {
      status: "todo", archived: true,
      occurrence: { templateTitle: "Shop", ownTitle: null, blockedReason: null, dependsOn: [], archived: true },
    });
    expect(deriveStatusIndicators(deleted)).toEqual([{ type: "archived", conflict: false, archived: true }]);
  });
});
