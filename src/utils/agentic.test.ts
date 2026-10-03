import { describe, it, expect } from "vitest";
import { isAgentic, storedAgenticState } from "./agentic";
import type { MindmapNode, NodeKind } from "./tree-layout";

/** A node with what the backend says its ancestors read as (the load's `inherited_agentic`). */
function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

describe("isAgentic", () => {
  it("reads a task that flagged itself as agentic", () => {
    expect(isAgentic(n("task-1", "task", { agentic: true }))).toBe(true);
  });

  it("reads a task nobody flagged, under nothing, as not agentic", () => {
    expect(isAgentic(n("task-1", "task"))).toBe(false);
  });

  it("reads an unflagged task under an agentic ancestor as agentic", () => {
    expect(isAgentic(n("task-2", "task", { inheritedAgentic: true }))).toBe(true);
  });

  it("reads an explicitly unflagged task under an agentic ancestor as not agentic", () => {
    // The override half of the rule: saying "not this one" has to beat the inherited yes,
    // otherwise a branch could be marked but never unmarked in one place.
    expect(isAgentic(n("task-2", "task", { agentic: false, inheritedAgentic: true }))).toBe(false);
  });

  it("reads a flagged task under an unflagging ancestor as agentic", () => {
    expect(isAgentic(n("task-3", "task", { agentic: true, inheritedAgentic: false }))).toBe(true);
  });

  it("never reads a non-task as agentic, however agentic its ancestors are", () => {
    // Tasks only: an agent does actions, where a Goal is a desired state and a Commitment is kept
    // rather than done.
    expect(isAgentic(n("goal-1", "goal", { inheritedAgentic: true }))).toBe(false);
    expect(isAgentic(n("commitment-1", "commitment", { inheritedAgentic: true }))).toBe(false);
  });
});

describe("storedAgenticState", () => {
  it("reads an absent or null flag as the unchosen state that inherits", () => {
    expect(storedAgenticState(null)).toBe("inherit");
    expect(storedAgenticState(undefined)).toBe("inherit");
  });

  it("reads the two stored answers as themselves", () => {
    expect(storedAgenticState(true)).toBe("yes");
    expect(storedAgenticState(false)).toBe("no");
  });
});
