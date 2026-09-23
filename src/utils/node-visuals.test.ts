import { describe, it, expect } from "vitest";
import { aspectColorOf, aspectWashStyle, computeNodeAppearance } from "./node-visuals";
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
    expect(a.resolution).toBeUndefined();
    expect(a.nodeOpacity).toBe(1);
  });

  it("keeps an overdue node opaque but exposes the resolution for the accent", () => {
    const a = computeNodeAppearance(mkNode({ timing: "lapsed", resolution: "overdue" }), 1);
    expect(a.resolution).toBe("overdue");
    expect(a.nodeOpacity).toBe(1);
  });

  it("dims an archived node so it reads as dropped from the active view", () => {
    const a = computeNodeAppearance(mkNode({ timing: "lapsed", resolution: "missed", archived: true }), 1);
    expect(a.resolution).toBe("missed");
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
