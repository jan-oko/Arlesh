import { describe, it, expect } from "vitest";
import { isAgentic, propagateAgentic, storedAgenticState, toggledAgenticState } from "./agentic";
import type { MindmapNode, NodeKind } from "./tree-layout";

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

/** Builds a tree from a node and its children, then resolves the inherited flag over it. */
function resolved(root: MindmapNode): MindmapNode {
  propagateAgentic(root, false);
  return root;
}

function byId(root: MindmapNode, id: string): MindmapNode {
  const pending: MindmapNode[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.id === id) return node;
    pending.push(...node.children);
  }
  throw new Error(`no node ${id} in the tree`);
}

describe("isAgentic", () => {
  it("reads a task that flagged itself as agentic", () => {
    expect(isAgentic(resolved(n("task-1", "task", { agentic: true })))).toBe(true);
  });

  it("reads a task nobody flagged, under nothing, as not agentic", () => {
    expect(isAgentic(resolved(n("task-1", "task")))).toBe(false);
  });

  it("reads an unflagged child of an agentic task as agentic", () => {
    const root = resolved(
      n("task-1", "task", { agentic: true, children: [n("task-2", "task")] }),
    );
    expect(isAgentic(byId(root, "task-2"))).toBe(true);
  });

  it("reads an explicitly unflagged child of an agentic task as not agentic", () => {
    // The override half of the rule: saying "not this one" has to beat the inherited yes,
    // otherwise a branch could be marked but never unmarked in one place.
    const root = resolved(
      n("task-1", "task", { agentic: true, children: [n("task-2", "task", { agentic: false })] }),
    );
    expect(isAgentic(byId(root, "task-2"))).toBe(false);
  });

  it("re-flags a grandchild under an explicitly unflagged child", () => {
    const root = resolved(
      n("task-1", "task", {
        agentic: true,
        children: [
          n("task-2", "task", { agentic: false, children: [n("task-3", "task", { agentic: true })] }),
        ],
      }),
    );
    expect(isAgentic(byId(root, "task-3"))).toBe(true);
  });

  it("inherits through a goal, which carries no flag of its own", () => {
    const root = resolved(
      n("task-1", "task", {
        agentic: true,
        children: [n("goal-1", "goal", { children: [n("task-2", "task")] })],
      }),
    );
    expect(isAgentic(byId(root, "task-2"))).toBe(true);
  });

  it("never reads a non-task as agentic, however agentic its ancestors are", () => {
    // Tasks only: an agent does actions, where a Goal is a desired state and a Commitment is kept
    // rather than done. The value still passes through them to the tasks below.
    const root = resolved(
      n("task-1", "task", {
        agentic: true,
        children: [n("goal-1", "goal"), n("commitment-1", "commitment")],
      }),
    );
    expect(isAgentic(byId(root, "goal-1"))).toBe(false);
    expect(isAgentic(byId(root, "commitment-1"))).toBe(false);
  });

  it("leaves a task outside the flagged branch alone", () => {
    const root = resolved(
      n("domain-1", "domain", {
        children: [n("task-1", "task", { agentic: true }), n("task-2", "task")],
      }),
    );
    expect(isAgentic(byId(root, "task-1"))).toBe(true);
    expect(isAgentic(byId(root, "task-2"))).toBe(false);
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
    expect(toggledAgenticState(resolved(n("task-1", "task")))).toBe("yes");
  });

  it("marks a task explicitly not agentic in one press, so the toggle undoes itself", () => {
    expect(toggledAgenticState(resolved(n("task-1", "task", { agentic: true })))).toBe("no");
  });

  it("turns an explicit No back on in one press, not two", () => {
    // The case that drove the toggle: under a non-agentic parent this task looks exactly like an
    // unflagged one, so a cycle that sent it to Inherit first spent a press on an invisible move.
    const root = resolved(
      n("task-1", "task", { children: [n("task-2", "task", { agentic: false })] }),
    );
    expect(toggledAgenticState(byId(root, "task-2"))).toBe("yes");
  });

  it("pins a task that was only inheriting Yes to an explicit No", () => {
    // Reads as agentic, so one press must turn the badge off. Detaching it from the ancestor that
    // was deciding for it is the cost of that, and the editor is where Inherit comes back.
    const root = resolved(
      n("task-1", "task", { agentic: true, children: [n("task-2", "task")] }),
    );
    expect(toggledAgenticState(byId(root, "task-2"))).toBe("no");
  });

  it("never writes Inherit: it is a starting point the key resolves through, not a destination", () => {
    const written = [
      toggledAgenticState(resolved(n("task-1", "task"))),
      toggledAgenticState(resolved(n("task-2", "task", { agentic: true }))),
      toggledAgenticState(resolved(n("task-3", "task", { agentic: false }))),
    ];
    expect(written).not.toContain("inherit");
  });

  it("flips both ways, so two presses leave a task reading as it started", () => {
    // Explicitly, now, rather than by inheritance — but the same picture on screen.
    expect(toggledAgenticState(resolved(n("task-1", "task", { agentic: true })))).toBe("no");
    expect(toggledAgenticState(resolved(n("task-1", "task", { agentic: false })))).toBe("yes");
  });
});
