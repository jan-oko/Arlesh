import { describe, it, expect } from "vitest";
import { computeNodeDimensions, estimateWrappedLineCount, getNodeSize, validTypesForCycling, typeAcceptsChildren, isValidDropTarget, computeEditHeight } from "./node-meta";

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

describe("validTypesForCycling — kinds the filter hides", () => {
  it("drops Info from the ring under an aspect parent, leaving the other five in order", () => {
    expect(validTypesForCycling("task", "aspect", ["info"])).toEqual(["domain", "project", "tag", "goal", "task"]);
  });

  it("drops Info under a goal parent, leaving goal and task", () => {
    expect(validTypesForCycling("task", "goal", ["info"])).toEqual(["goal", "task"]);
  });

  it("restores Info once nothing is hidden", () => {
    expect(validTypesForCycling("task", "goal", [])).toContain("info");
    expect(validTypesForCycling("task", "goal")).toContain("info");
  });

  it("keeps an Info node's own kind in the ring so it can still be cycled out", () => {
    const cycle = validTypesForCycling("info", "domain", ["info"]);
    expect(cycle).toEqual(["domain", "tag", "goal", "task", "info"]);
  });

  it("leaves an Info node under an Info parent with nowhere to go rather than stranding it", () => {
    expect(validTypesForCycling("info", "info", ["info"])).toEqual(["info"]);
  });

  it("narrows the ring to the node's own kind when every other kind is hidden", () => {
    const everythingElse = ["domain", "project", "tag", "goal", "info"] as const;
    expect(validTypesForCycling("task", "aspect", everythingElse)).toEqual(["task"]);
  });

  it("only narrows — hiding Info never re-offers a kind the parent forbids", () => {
    const cycle = validTypesForCycling("domain", "tag", ["info"]);
    expect(cycle).not.toContain("project");
    expect(cycle).not.toContain("tag");
    expect(cycle).not.toContain("info");
  });

  it("ignores a hidden kind that was never in the ring anyway", () => {
    expect(validTypesForCycling("task", "goal", ["flow", "flow_goal", "flow_task"])).toEqual(
      validTypesForCycling("task", "goal"),
    );
  });

  it("leaves a flow item unable to retype while Flows are hidden", () => {
    expect(validTypesForCycling("flow_goal", "flow", ["flow", "flow_goal", "flow_task"])).toEqual(["flow_goal"]);
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
