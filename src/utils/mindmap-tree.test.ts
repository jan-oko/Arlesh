import { describe, it, expect } from "vitest";
import { connectedNodeIds, nearestInDirection } from "./mindmap-tree";
import type { MindmapNode } from "./tree-layout";
import type { Position } from "./tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, position: 0, tagIds: [], children };
}

function pos(x: number, y: number): Position {
  return { x, y, depth: 0 };
}

// Tree shape used across most tests:
//   root
//   ├── aspect-a
//   │   ├── child-1
//   │   └── child-2
//   └── aspect-b
const CHILD_1 = node("child-1");
const CHILD_2 = node("child-2");
const ASPECT_A = node("aspect-a", [CHILD_1, CHILD_2]);
const ASPECT_B = node("aspect-b");
const TREE = node("root", [ASPECT_A, ASPECT_B]);

describe("connectedNodeIds", () => {
  it("returns children and siblings for a mid-tree node", () => {
    const connected = connectedNodeIds(TREE, "aspect-a");
    expect(connected.has("child-1")).toBe(true);
    expect(connected.has("child-2")).toBe(true);
    expect(connected.has("aspect-b")).toBe(true);
  });

  it("does not include the node itself", () => {
    const connected = connectedNodeIds(TREE, "aspect-a");
    expect(connected.has("aspect-a")).toBe(false);
  });

  it("does not include the virtual root", () => {
    const connected = connectedNodeIds(TREE, "aspect-a");
    expect(connected.has("root")).toBe(false);
  });

  it("returns parent and sibling for a leaf node", () => {
    const connected = connectedNodeIds(TREE, "child-1");
    expect(connected.has("aspect-a")).toBe(true);
    expect(connected.has("child-2")).toBe(true);
  });

  it("does not include nodes outside the connected subtree", () => {
    const connected = connectedNodeIds(TREE, "child-1");
    expect(connected.has("aspect-b")).toBe(false);
  });

  it("returns only children for root when root has no parent", () => {
    const connected = connectedNodeIds(TREE, "root");
    expect(connected.has("aspect-a")).toBe(true);
    expect(connected.has("aspect-b")).toBe(true);
    expect(connected.size).toBe(2);
  });

  it("returns empty set for an unknown node id", () => {
    const connected = connectedNodeIds(TREE, "does-not-exist");
    expect(connected.size).toBe(0);
  });
});

describe("nearestInDirection with candidateIds", () => {
  const positions = new Map<string, Position>([
    ["center", pos(0, 0)],
    ["right",  pos(100, 0)],
    ["left",   pos(-100, 0)],
    ["far-right", pos(300, 0)],
  ]);

  it("finds the nearest candidate in direction, ignoring non-candidates", () => {
    const candidates = new Set(["left", "far-right"]);
    const result = nearestInDirection("center", positions, "ArrowRight", candidates);
    // right is closer but not a candidate; far-right is the nearest candidate
    expect(result).toBe("far-right");
  });

  it("returns undefined when no candidate is in the requested direction", () => {
    const candidates = new Set(["left"]);
    const result = nearestInDirection("center", positions, "ArrowRight", candidates);
    expect(result).toBeUndefined();
  });

  it("behaves identically to unconstrained search when candidateIds is omitted", () => {
    const unconstrained = nearestInDirection("center", positions, "ArrowRight");
    expect(unconstrained).toBe("right");
  });
});
