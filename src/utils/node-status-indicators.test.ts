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
    const habit = node("task", { status: "todo", habitItem: { flowId: 1, itemType: "flow_root", itemId: 1, scopeId: 5 } });
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
