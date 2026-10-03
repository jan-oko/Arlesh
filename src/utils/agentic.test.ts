import { describe, it, expect } from "vitest";
import { isAgentic, storedAgenticState, toggledAgenticState } from "./agentic";
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

describe("toggledAgenticState", () => {
  it("marks an unflagged task agentic in one press — the state every task starts in", () => {
    expect(toggledAgenticState(n("task-1", "task"))).toBe("yes");
  });

  it("marks a task explicitly not agentic in one press, so the toggle undoes itself", () => {
    expect(toggledAgenticState(n("task-1", "task", { agentic: true }))).toBe("no");
  });

  it("turns an explicit No back on in one press, not two", () => {
    // The case that drove the toggle: under a non-agentic parent this task looks exactly like an
    // unflagged one, so a cycle that sent it to Inherit first spent a press on an invisible move.
    expect(toggledAgenticState(n("task-2", "task", { agentic: false }))).toBe("yes");
  });

  it("pins a task that was only inheriting Yes to an explicit No", () => {
    // Reads as agentic, so one press must turn the badge off. Detaching it from the ancestor that
    // was deciding for it is the cost of that, and the editor is where Inherit comes back.
    expect(toggledAgenticState(n("task-2", "task", { inheritedAgentic: true }))).toBe("no");
  });

  it("never writes Inherit: it is a starting point the key resolves through, not a destination", () => {
    const written = [
      toggledAgenticState(n("task-1", "task")),
      toggledAgenticState(n("task-2", "task", { agentic: true })),
      toggledAgenticState(n("task-3", "task", { agentic: false })),
    ];
    expect(written).not.toContain("inherit");
  });

  it("flips both ways, so two presses leave a task reading as it started", () => {
    expect(toggledAgenticState(n("task-1", "task", { agentic: true }))).toBe("no");
    expect(toggledAgenticState(n("task-1", "task", { agentic: false }))).toBe("yes");
  });
});
