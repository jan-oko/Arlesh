import { describe, it, expect } from "vitest";
import { computeNodeDimensions, estimateWrappedLineCount, getNodeSize, validTypesForCycling, typeAcceptsChildren, isValidDropTarget, computeEditHeight, validParentKinds, isFlowKind, canParentNewTask, canParentNewChild, canParentAnyNewChild, canAdoptChildren, canAdoptExistingChild, TYPED_CHILD_KINDS } from "./node-meta";
import { ALL_NODE_KINDS } from "./tree-layout";
import type { MindmapNode } from "./tree-layout";

describe("computeNodeDimensions", () => {
  it("matches getNodeSize height for a short single-word title", () => {
    const base = getNodeSize(0);
    const computed = computeNodeDimensions(0, "Hello");
    expect(computed.height).toBe(base.height);
    expect(computed.width).toBe(base.width);
    expect(computed.iconWidth).toBe(base.iconWidth);
  });

  it("returns minimum height for an empty title", () => {
    const { height } = computeNodeDimensions(0, "");
    expect(height).toBe(getNodeSize(0).height);
  });

  it("expands height for a title long enough to wrap to a third line", () => {
    // depth 0: charWidth ≈ 18*0.52 = 9.36, textArea = 200-32-4 = 164, charsPerLine ≈ 17
    // 40 chars → ceil(40/17) = 3 lines → height = 8 + 3*22 = 74 > minHeight=52
    const { height } = computeNodeDimensions(0, "A".repeat(40));
    expect(height).toBeGreaterThan(getNodeSize(0).height);
  });

  it("treats explicit \\n as a forced line break increasing height above single-line equivalent", () => {
    // "A\nB\nC" = 3 segments of 1 char each = 3 lines
    // 3 lines at depth 0: height = 8 + 3*22 = 74
    const threeLines = computeNodeDimensions(0, "A\nB\nC").height;
    const oneLine = computeNodeDimensions(0, "ABC").height;
    expect(threeLines).toBeGreaterThan(oneLine);
  });

  it("uses minimum height at greater depths", () => {
    const { height } = computeNodeDimensions(4, "short");
    expect(height).toBe(getNodeSize(4).height);
  });

  it("handles depth beyond the spec table by clamping to the last entry", () => {
    const d4 = computeNodeDimensions(4, "x");
    const d99 = computeNodeDimensions(99, "x");
    expect(d4.width).toBe(d99.width);
    expect(d4.height).toBe(d99.height);
  });

  it("returns lineCount 1 for a short title that fits on one line", () => {
    const { lineCount } = computeNodeDimensions(0, "short");
    expect(lineCount).toBe(1);
  });

  it("returns lineCount matching the number of estimated wrapped lines for a long title", () => {
    // depth 0: charsPerLine ≈ floor(164 / 9.36) = 17
    // 40 chars → ceil(40/17) = 3 lines
    const { lineCount } = computeNodeDimensions(0, "A".repeat(40));
    expect(lineCount).toBe(3);
  });

  it("returns lineCount equal to explicit newline segments for multi-line title", () => {
    const { lineCount } = computeNodeDimensions(0, "A\nB\nC");
    expect(lineCount).toBe(3);
  });
});

describe("estimateWrappedLineCount", () => {
  it("returns 1 for a short text that fits on one line", () => {
    // depth 0 textAreaWidth=164, fontSize=18 → charsPerLine≈17
    expect(estimateWrappedLineCount("hello", 164, 18)).toBe(1);
  });

  it("matches computeNodeDimensions lineCount for the same text and dimensions", () => {
    // depth 0: iconWidth=32, textAreaWidth=164, fontSize=18
    const { lineCount } = computeNodeDimensions(0, "A".repeat(40));
    expect(estimateWrappedLineCount("A".repeat(40), 164, 18)).toBe(lineCount);
  });

  it("counts explicit newlines as forced breaks", () => {
    expect(estimateWrappedLineCount("A\nB\nC", 164, 18)).toBe(3);
  });
});

describe("computeEditHeight", () => {
  it("returns minimum height when lineCount is 1", () => {
    const base = getNodeSize(0);
    expect(computeEditHeight(0, 1)).toBe(base.height);
  });

  it("returns a larger height for more lines", () => {
    const oneLineHeight = computeEditHeight(0, 1);
    const threeLineHeight = computeEditHeight(0, 3);
    expect(threeLineHeight).toBeGreaterThan(oneLineHeight);
  });

  it("matches nodeHeight formula: max(minHeight, VERTICAL_PADDING + lineCount * lineHeight)", () => {
    // depth 0: minHeight=52, lineHeight=22, VERTICAL_PADDING=8
    // lineCount=3 → 8 + 3*22 = 74 > 52 → should be 74
    expect(computeEditHeight(0, 3)).toBe(74);
  });
});

describe("isValidDropTarget — goal and task sources", () => {
  it("goal can be dropped onto a domain (not task)", () => {
    expect(isValidDropTarget("goal", "domain")).toBe(true);
  });

  it("goal can be dropped onto a goal", () => {
    expect(isValidDropTarget("goal", "goal")).toBe(true);
  });

  it("goal cannot be dropped onto a task", () => {
    expect(isValidDropTarget("goal", "task")).toBe(false);
  });

  it("task can be dropped onto a task", () => {
    expect(isValidDropTarget("task", "task")).toBe(true);
  });

  it("task can be dropped onto a goal", () => {
    expect(isValidDropTarget("task", "goal")).toBe(true);
  });

  it("task can be dropped onto a domain", () => {
    expect(isValidDropTarget("task", "domain")).toBe(true);
  });

  it("project can be dropped onto an aspect", () => {
    expect(isValidDropTarget("project", "aspect")).toBe(true);
  });

  it("project cannot be dropped onto a domain", () => {
    expect(isValidDropTarget("project", "domain")).toBe(false);
  });

  it("domain can be dropped onto a domain", () => {
    expect(isValidDropTarget("domain", "domain")).toBe(true);
  });

  it("aspect cannot be dropped anywhere (immutable)", () => {
    expect(isValidDropTarget("aspect", "domain")).toBe(false);
    expect(isValidDropTarget("aspect", "project")).toBe(false);
  });
});

describe("validTypesForCycling — parent-subtype validity", () => {
  it("offers Project only under an Aspect or Project parent", () => {
    expect(validTypesForCycling("domain", "aspect")).toContain("project");
    expect(validTypesForCycling("domain", "project")).toContain("project");
    // A Project's parent must be an Aspect or Project — not a Domain or Tag.
    expect(validTypesForCycling("domain", "domain")).not.toContain("project");
    expect(validTypesForCycling("domain", "tag")).not.toContain("project");
  });

  it("does not offer Tag under a Tag parent (tags can't have tag children)", () => {
    expect(validTypesForCycling("domain", "tag")).not.toContain("tag");
    expect(validTypesForCycling("domain", "aspect")).toContain("tag");
  });

  it("still offers Domain under any domain-table parent", () => {
    for (const parent of ["aspect", "project", "domain", "tag"] as const) {
      expect(validTypesForCycling("project", parent)).toContain("domain");
    }
  });
});

describe("typeAcceptsChildren", () => {
  it("info can only hold info children", () => {
    expect(typeAcceptsChildren("info", ["info"])).toBe(true);
    expect(typeAcceptsChildren("info", ["task"])).toBe(false);
    expect(typeAcceptsChildren("info", [])).toBe(true);
  });

  it("task cannot hold goal children (goal parent_type excludes task)", () => {
    expect(typeAcceptsChildren("task", ["task", "info"])).toBe(true);
    expect(typeAcceptsChildren("task", ["goal"])).toBe(false);
  });

  it("goal holds goal/task/info but not a domain-table child", () => {
    expect(typeAcceptsChildren("goal", ["goal", "task", "info"])).toBe(true);
    expect(typeAcceptsChildren("goal", ["project"])).toBe(false);
  });

  it("domain cannot hold a project child (a project needs an aspect/project parent)", () => {
    expect(typeAcceptsChildren("domain", ["domain", "goal"])).toBe(true);
    expect(typeAcceptsChildren("domain", ["project"])).toBe(false);
  });

  it("a tag holds only info children (it's a label, not a container)", () => {
    expect(typeAcceptsChildren("tag", ["info"])).toBe(true);
    expect(typeAcceptsChildren("tag", [])).toBe(true);
    expect(typeAcceptsChildren("tag", ["goal"])).toBe(false);
    expect(typeAcceptsChildren("tag", ["task"])).toBe(false);
    expect(typeAcceptsChildren("tag", ["domain"])).toBe(false);
  });
});

describe("validTypesForCycling — info", () => {
  it("includes info in the cycle under a domain parent", () => {
    expect(validTypesForCycling("task", "domain")).toContain("info");
  });

  it("includes info in the cycle under an aspect parent", () => {
    expect(validTypesForCycling("domain", "aspect")).toContain("info");
  });

  it("includes info in the cycle under a goal parent", () => {
    expect(validTypesForCycling("task", "goal")).toContain("info");
  });

  it("includes info in the cycle under a task parent", () => {
    expect(validTypesForCycling("task", "task")).toContain("info");
  });

  it("returns only [info] when parent is info (no cycling out)", () => {
    expect(validTypesForCycling("info", "info")).toEqual(["info"]);
  });

  it("can cycle from info itself when parent is domain", () => {
    const cycle = validTypesForCycling("info", "domain");
    expect(cycle).toContain("info");
    expect(cycle.length).toBeGreaterThan(1);
  });
});

describe("validTypesForCycling — a commitment flow's items", () => {
  it("does not offer a goal item on a commitment flow", () => {
    // A Commitment holds Tasks and other Commitments and no Goals, so such an item could never
    // materialise: the flow would derive no iterations at all. Not offered, rather than offered
    // and explained afterwards by the Mindmap's failure banner.
    expect(validTypesForCycling("flow_task", "flow", "commitment")).toEqual(["flow_task"]);
    expect(validTypesForCycling("flow_goal", "flow", "commitment")).toEqual(["flow_task"]);
  });

  it("still offers both on a goal or task flow", () => {
    expect(validTypesForCycling("flow_task", "flow", "task")).toEqual(["flow_goal", "flow_task"]);
    expect(validTypesForCycling("flow_task", "flow", "goal")).toEqual(["flow_goal", "flow_task"]);
  });

  it("offers both when the instance type is not known, as before", () => {
    expect(validTypesForCycling("flow_task", "flow")).toEqual(["flow_goal", "flow_task"]);
  });
});

describe("validTypesForCycling — flow items", () => {
  it("cycles a flow item between goal and task under a flow root", () => {
    expect(validTypesForCycling("flow_goal", "flow")).toEqual(["flow_goal", "flow_task"]);
    expect(validTypesForCycling("flow_task", "flow")).toEqual(["flow_goal", "flow_task"]);
  });

  it("cycles a flow item between goal and task under a flow-goal parent", () => {
    expect(validTypesForCycling("flow_task", "flow_goal")).toEqual(["flow_goal", "flow_task"]);
  });

  it("allows only task under a flow-task parent (a goal can't sit under a task)", () => {
    expect(validTypesForCycling("flow_task", "flow_task")).toEqual(["flow_task"]);
  });

  it("never cycles the flow node itself", () => {
    expect(validTypesForCycling("flow", "domain")).toEqual([]);
  });
});

describe("isValidDropTarget — info", () => {
  it("info can be dropped onto a domain", () => {
    expect(isValidDropTarget("info", "domain")).toBe(true);
  });

  it("info can be dropped onto a goal", () => {
    expect(isValidDropTarget("info", "goal")).toBe(true);
  });

  it("info can be dropped onto a task", () => {
    expect(isValidDropTarget("info", "task")).toBe(true);
  });

  it("info can be dropped onto another info node", () => {
    expect(isValidDropTarget("info", "info")).toBe(true);
  });

  it("info cannot be dropped onto a tag", () => {
    expect(isValidDropTarget("info", "tag")).toBe(false);
  });

  it("task cannot be dropped onto an info node (info only accepts info children)", () => {
    expect(isValidDropTarget("task", "info")).toBe(false);
  });

  it("goal cannot be dropped onto an info node", () => {
    expect(isValidDropTarget("goal", "info")).toBe(false);
  });

  it("domain cannot be dropped onto an info node", () => {
    expect(isValidDropTarget("domain", "info")).toBe(false);
  });
});

describe("commitments in the type cycle", () => {
  it("sits immediately after Task under a domain-table parent", () => {
    const cycle = validTypesForCycling("task", "project");
    expect(cycle).toContain("commitment");
    expect(cycle.indexOf("commitment")).toBe(cycle.indexOf("task") + 1);
  });

  it("is reachable under a goal, a task and another commitment", () => {
    for (const parent of ["goal", "task", "commitment"] as const) {
      expect(validTypesForCycling("task", parent)).toContain("commitment");
    }
  });

  it("is not reachable under an info parent, which holds only notes", () => {
    expect(validTypesForCycling("info", "info")).toEqual(["info"]);
  });

  it("offers no Goal under a commitment: a desired state is not something you hold to", () => {
    expect(validTypesForCycling("task", "commitment")).not.toContain("goal");
    expect(typeAcceptsChildren("commitment", ["goal"])).toBe(false);
  });

  it("holds tasks, other commitments and notes", () => {
    expect(typeAcceptsChildren("commitment", ["task", "commitment", "info"])).toBe(true);
    expect(typeAcceptsChildren("commitment", ["flow"])).toBe(false);
    expect(typeAcceptsChildren("commitment", ["project"])).toBe(false);
  });

  it("can be dropped wherever a task can, plus onto another commitment", () => {
    for (const target of ["aspect", "domain", "project", "goal", "task", "commitment"] as const) {
      expect(isValidDropTarget("commitment", target)).toBe(true);
    }
    expect(isValidDropTarget("commitment", "tag")).toBe(false);
    expect(isValidDropTarget("commitment", "info")).toBe(false);
  });

  it("accepts only tasks and commitments as drop sources", () => {
    expect(isValidDropTarget("task", "commitment")).toBe(true);
    expect(isValidDropTarget("commitment", "commitment")).toBe(true);
    expect(isValidDropTarget("goal", "commitment")).toBe(false);
    expect(isValidDropTarget("info", "commitment")).toBe(true);
  });
});

describe("validParentKinds", () => {
  it("names the four kinds a Flow may hang from", () => {
    expect(validParentKinds("flow")).toEqual(["aspect", "domain", "project", "goal"]);
  });

  it("names the four kinds a Goal may sit under — never a Task", () => {
    expect(validParentKinds("goal")).toEqual(["aspect", "domain", "project", "goal"]);
  });

  it("restricts a Project to an Aspect or another Project", () => {
    expect(validParentKinds("project")).toEqual(["aspect", "project"]);
  });

  it("lets a Commitment sit anywhere a Task can, plus inside another Commitment", () => {
    expect(validParentKinds("commitment")).toEqual(["aspect", "domain", "project", "goal", "task", "commitment"]);
  });

  it("refuses a Commitment under a Tag or an Info, like every other real node", () => {
    expect(validParentKinds("commitment")).not.toContain("tag");
    expect(validParentKinds("commitment")).not.toContain("info");
  });

  it("restricts a Domain to an Aspect, Domain or Project", () => {
    expect(validParentKinds("domain")).toEqual(["aspect", "domain", "project"]);
  });

  it("lets a Task sit under a Goal, a Task or a Commitment as well as the containers", () => {
    expect(validParentKinds("task")).toEqual(["aspect", "domain", "project", "goal", "task", "commitment"]);
  });

  it("lets an Info sit under everything but a Tag", () => {
    expect(validParentKinds("info")).toEqual(["aspect", "domain", "project", "goal", "task", "commitment", "info"]);
  });

  // A flow item used to get an empty list, because the candidates were the real kinds only — so a
  // refusal could say a flow item cannot sit here without being able to say where it does sit.
  it("puts a flow item inside a Flow, which is the only place one lives", () => {
    expect(validParentKinds("flow_task")).toEqual(["flow", "flow_goal", "flow_task"]);
    expect(validParentKinds("flow_goal")).toEqual(["flow", "flow_goal"]);
  });

  it("keeps the flow world out of every real kind's answer", () => {
    for (const child of ["domain", "project", "goal", "task", "commitment", "info", "tag", "flow"] as const) {
      expect(validParentKinds(child).some(isFlowKind)).toBe(false);
    }
  });

  it("agrees with isValidDropTarget for every kind it lists and every kind it omits", () => {
    const everyParent = ["aspect", "domain", "project", "goal", "task", "commitment", "info", "tag"] as const;
    for (const child of TYPED_CHILD_KINDS) {
      const listed = validParentKinds(child);
      for (const parent of everyParent) {
        expect(listed.includes(parent)).toBe(isValidDropTarget(child, parent));
      }
    }
  });
});

describe("canParentNewTask", () => {
  function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}): MindmapNode {
    return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
  }

  it.each(["aspect", "domain", "project", "goal", "task", "commitment"] as const)(
    "accepts a %s, exactly as reparenting does",
    (kind) => {
      expect(canParentNewTask(node(`${kind}-1`, kind))).toBe(true);
    },
  );

  it.each(["info", "tag", "flow"] as const)("refuses a %s, exactly as reparenting does", (kind) => {
    expect(canParentNewTask(node(`${kind}-1`, kind))).toBe(false);
  });

  // A Habit repetition is derived at load time; there is no row behind it to parent anything to.
  it("refuses a virtual node whose kind would otherwise take a Task", () => {
    expect(canParentNewTask(node("habititem-flow_task-2-1-0-virtual", "task", { virtual: true }))).toBe(false);
  });

  it("refuses the synthetic root, which has no database row either", () => {
    expect(canParentNewTask(node("root", "domain"))).toBe(false);
  });
});

describe("isValidDropTarget — a folded run of Habit history", () => {
  // `habit_group` is a tally and a span drawn in place of many iterations. It used to fall through
  // to the function's trailing `return true`, which is how a folded run came to accept children.
  it.each(ALL_NODE_KINDS)("refuses a %s dropped onto a habit_group", (kind) => {
    expect(isValidDropTarget(kind, "habit_group")).toBe(false);
  });

  it.each(ALL_NODE_KINDS)("refuses a habit_group dropped onto a %s", (kind) => {
    expect(isValidDropTarget("habit_group", kind)).toBe(false);
  });
});

describe("canParentNewChild", () => {
  function node(id: string, kind: MindmapNode["kind"], extra: Partial<MindmapNode> = {}): MindmapNode {
    return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
  }

  const occurrence = (kind: MindmapNode["kind"]) =>
    node(`habit-3-0-virtual`, kind, {
      virtual: true,
      habitItem: { flowId: 3, itemType: "flow_root", itemId: 3, scopeId: 100, cycleId: 0 },
    });

  const foldedRun = node("habitgroup-3-run", "habit_group", {
    virtual: true,
    habitGroup: {
      flowId: 3, level: "run", passed: 3, done: 2, missed: 1,
      spanStart: "2026-09-14", spanEnd: "2026-09-16", spanLabel: "2026-09-14..2026-09-16",
    },
  });

  it("answers the kind rule for an ordinary row", () => {
    expect(canParentNewChild(node("goal-1", "goal"), "task")).toBe(true);
    expect(canParentNewChild(node("task-1", "task"), "goal")).toBe(false);
  });

  it.each(["task", "goal", "commitment", "info"] as const)(
    "lets a Goal occurrence hold a new %s, which the attachment path writes",
    (childKind) => {
      expect(canParentNewChild(occurrence("goal"), childKind)).toBe(true);
    },
  );

  // The bug Shift+F reproduced: a Habit whose instances are Goals draws a `goal` iteration root,
  // and a Flow may sit under a Goal — so the kind alone said yes and the editor posted a NaN parent.
  it("refuses a Flow on a Goal occurrence, though the kind rule would allow one under a Goal", () => {
    expect(isValidDropTarget("flow", "goal")).toBe(true);
    expect(canParentNewChild(occurrence("goal"), "flow")).toBe(false);
  });

  it("still applies the occurrence's own drawn kind — no Goal under a Task occurrence", () => {
    expect(canParentNewChild(occurrence("task"), "goal")).toBe(false);
    expect(canParentNewChild(occurrence("task"), "task")).toBe(true);
  });

  it.each(ALL_NODE_KINDS)("refuses a new %s under a folded run of Habit history", (childKind) => {
    expect(canParentNewChild(foldedRun, childKind)).toBe(false);
  });

  it("refuses everything under the synthetic root, which has no row", () => {
    expect(canParentNewChild(node("root", "domain"), "task")).toBe(false);
  });

  describe("canParentAnyNewChild", () => {
    it("says yes for a Project and no for a Tag, which is a label rather than a container", () => {
      expect(canParentAnyNewChild(node("domain-1", "project"))).toBe(true);
      expect(canParentAnyNewChild(node("domain-2", "tag"))).toBe(false);
    });

    it("says no for a folded run and yes for an occurrence, which holds children of its own", () => {
      expect(canParentAnyNewChild(foldedRun)).toBe(false);
      expect(canParentAnyNewChild(occurrence("task"))).toBe(true);
    });
  });

  describe("canAdoptChildren / canAdoptExistingChild", () => {
    // The one node the two predicates disagree about. Attaching writes the child and the link in
    // one call; a move only re-points an existing row's parent, and there is no id to point at.
    it("lets an occurrence hold a NEW child but not adopt an existing one", () => {
      expect(canParentNewChild(occurrence("task"), "task")).toBe(true);
      expect(canAdoptChildren(occurrence("task"))).toBe(false);
      expect(canAdoptExistingChild(occurrence("task"), "task")).toBe(false);
    });

    it("answers the kind rule for an ordinary row, exactly as creating does", () => {
      expect(canAdoptExistingChild(node("goal-1", "goal"), "task")).toBe(true);
      expect(canAdoptExistingChild(node("task-1", "task"), "goal")).toBe(false);
    });

    it("refuses a folded run and the synthetic root", () => {
      expect(canAdoptChildren(foldedRun)).toBe(false);
      expect(canAdoptChildren(node("root", "domain"))).toBe(false);
    });
  });
});
