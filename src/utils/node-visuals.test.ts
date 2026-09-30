import { describe, it, expect } from "vitest";
import { aspectColorOf, aspectWashStyle, computeNodeAppearance, nodeStrokeColor } from "./node-visuals";
import type { MindmapNode } from "./tree-layout";

function mkNode(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "task-1",
    kind: "task",
    title: "Task",
    position: 0,
    tagIds: [],
    children: [],
    ...overrides,
  };
}

describe("computeNodeAppearance — scope lifecycle", () => {
  it("leaves a node with no lifecycle fully opaque and unmarked", () => {
    const a = computeNodeAppearance(mkNode(), 1);
    expect(a.overdue).toBe(false);
    expect(a.nodeOpacity).toBe(1);
  });

  it("keeps an overdue node opaque but exposes the flag for the accent", () => {
    const a = computeNodeAppearance(mkNode({ timing: "lapsed", overdue: true }), 1);
    expect(a.overdue).toBe(true);
    expect(a.nodeOpacity).toBe(1);
  });

  it("dims an archived node so it reads as dropped from the active view", () => {
    const a = computeNodeAppearance(mkNode({ timing: "lapsed", resolution: "missed", archived: true }), 1);
    expect(a.overdue).toBe(false);
    expect(a.nodeOpacity).toBeLessThan(1);
  });

  it("dims a completed-but-past-window node too (the original bug report)", () => {
    const a = computeNodeAppearance(mkNode({ status: "done", timing: "lapsed", resolution: "completed", archived: true }), 1);
    expect(a.nodeOpacity).toBeLessThan(1);
  });
});

describe("aspectWashStyle", () => {
  it("carries the aspect colour for the wash to mix from", () => {
    expect(aspectWashStyle("#e74c3c")).toEqual({ "--card-aspect": "#e74c3c" });
  });

  it("gives Self and Flow a strength of their own, so the two greys stop looking the same", () => {
    expect(aspectWashStyle("#bdc3c7")).toEqual({
      "--card-aspect": "#bdc3c7", "--card-aspect-strength": "var(--card-aspect-strength-self)",
    });
    expect(aspectWashStyle("#95A5A6")).toEqual({
      "--card-aspect": "#95A5A6", "--card-aspect-strength": "var(--card-aspect-strength-flow)",
    });
  });

  it("is empty outside any aspect, leaving the card its base surface", () => {
    expect(aspectWashStyle(undefined)).toEqual({});
  });
});

describe("aspectColorOf", () => {
  const tree: MindmapNode = {
    ...mkNode({ id: "root", kind: "domain", title: "Arlesh" }),
    children: [{
      ...mkNode({ id: "domain-1", kind: "aspect", title: "Green", color: "#27ae60" }),
      children: [mkNode({ id: "task-9", title: "Deep" })],
    }],
  };

  it("takes the nearest colour on the way down, so a node with none uses its ancestors'", () => {
    expect(aspectColorOf(tree, "task-9")).toBe("#27ae60");
  });

  it("is undefined outside any aspect", () => {
    expect(aspectColorOf(tree, "root")).toBeUndefined();
  });
});

describe("nodeStrokeColor — a Mindmap node's outline", () => {
  const plain = { isSelected: false, isDragTarget: false, overdue: false };

  it("draws the amber border on an Overdue node", () => {
    expect(nodeStrokeColor({ ...plain, overdue: true })).toBe("var(--overdue)");
  });

  it("gives a selected Overdue node a selection colour of its own, neither the plain selection nor the amber", () => {
    const both = nodeStrokeColor({ ...plain, isSelected: true, overdue: true });
    expect(both).toBe("var(--overdue-selected)");
    expect(both).not.toBe(nodeStrokeColor({ ...plain, isSelected: true }));
    expect(both).not.toBe(nodeStrokeColor({ ...plain, overdue: true }));
  });

  it("keeps the plain selection colour on a selected node that is not Overdue", () => {
    expect(nodeStrokeColor({ ...plain, isSelected: true })).toBe("var(--node-border-selected)");
  });

  it("lets a drop target's accent win over the amber", () => {
    expect(nodeStrokeColor({ ...plain, isDragTarget: true, overdue: true })).toBe("var(--accent)");
  });

  it("draws the ordinary border otherwise", () => {
    expect(nodeStrokeColor(plain)).toBe("var(--node-border)");
  });
});
