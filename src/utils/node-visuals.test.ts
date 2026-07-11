import { describe, it, expect } from "vitest";
import { computeNodeAppearance } from "./node-visuals";
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
