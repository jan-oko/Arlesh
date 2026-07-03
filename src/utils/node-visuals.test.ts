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
    expect(a.scopeLifecycle).toBeUndefined();
    expect(a.nodeOpacity).toBe(1);
  });

  it("keeps an overdue node opaque but exposes the lifecycle for the accent", () => {
    const a = computeNodeAppearance(mkNode({ scopeLifecycle: "overdue" }), 1);
    expect(a.scopeLifecycle).toBe("overdue");
    expect(a.nodeOpacity).toBe(1);
  });

  it("dims a lapsed node so it reads as dropped from the active view", () => {
    const a = computeNodeAppearance(mkNode({ scopeLifecycle: "lapsed" }), 1);
    expect(a.scopeLifecycle).toBe("lapsed");
    expect(a.nodeOpacity).toBeLessThan(1);
  });
});
