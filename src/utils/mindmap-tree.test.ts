import { describe, it, expect } from "vitest";
import { connectedNodeIds, nearestInDirection, collectAllNodeIds, computeShiftSelectRange, parentAndChildrenIds, siblingIds, gatherSubtreeItems, collectSubtreePostOrder, conversionNeedsConfirm } from "./mindmap-tree";
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

  it("includes the tree root as parent so navigation can pass through it", () => {
    const connected = connectedNodeIds(TREE, "aspect-a");
    expect(connected.has("root")).toBe(true);
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

// Deeper tree for multi-select tests:
//   root
//   ├── A
//   │   ├── A1
//   │   ├── A2
//   │   └── A3
//   └── B
//       ├── B1
//       └── B2
const A1 = node("A1");
const A2 = node("A2");
const A3 = node("A3");
const B1 = node("B1");
const B2 = node("B2");
const A = node("A", [A1, A2, A3]);
const B = node("B", [B1, B2]);
const DEEP_TREE = node("root", [A, B]);

describe("collectAllNodeIds", () => {
  it("returns all node ids in depth-first pre-order", () => {
    const ids = collectAllNodeIds(DEEP_TREE);
    expect(ids).toEqual(["root", "A", "A1", "A2", "A3", "B", "B1", "B2"]);
  });

  it("returns just the root id for a leaf node", () => {
    expect(collectAllNodeIds(A1)).toEqual(["A1"]);
  });
});

describe("computeShiftSelectRange", () => {
  it("returns [anchorId] when anchor and target are the same node", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "A1", "A1")).toEqual(["A1"]);
  });

  it("selects siblings between anchor and target in forward order", () => {
    const range = computeShiftSelectRange(DEEP_TREE, "A1", "A3");
    expect(range).toEqual(["A1", "A2", "A3"]);
  });

  it("selects siblings between anchor and target in reverse order (always sibling order)", () => {
    const range = computeShiftSelectRange(DEEP_TREE, "A3", "A1");
    expect(range).toEqual(["A1", "A2", "A3"]);
  });

  it("selects exactly two adjacent siblings", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "A1", "A2")).toEqual(["A1", "A2"]);
  });

  it("selects anchor and its direct parent when target is parent", () => {
    const range = computeShiftSelectRange(DEEP_TREE, "A1", "A");
    expect(range).toEqual(["A1", "A"]);
  });

  it("selects anchor and ancestor chain up to target grandparent", () => {
    const range = computeShiftSelectRange(DEEP_TREE, "A1", "root");
    expect(range).toEqual(["A1", "A", "root"]);
  });

  it("returns null when target is a sibling of the anchor's parent (unrelated branch)", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "A1", "B")).toBeNull();
  });

  it("returns null when target is in an entirely different subtree", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "A1", "B2")).toBeNull();
  });

  it("returns null when anchor does not exist in tree", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "nonexistent", "A1")).toBeNull();
  });

  it("returns null when target does not exist in tree", () => {
    expect(computeShiftSelectRange(DEEP_TREE, "A1", "nonexistent")).toBeNull();
  });
});

describe("parentAndChildrenIds", () => {
  it("returns parent and all children for a mid-tree node", () => {
    const ids = parentAndChildrenIds(DEEP_TREE, "A");
    expect(ids.has("root")).toBe(true);
    expect(ids.has("A1")).toBe(true);
    expect(ids.has("A2")).toBe(true);
    expect(ids.has("A3")).toBe(true);
    expect(ids.size).toBe(4);
  });

  it("does not include siblings", () => {
    const ids = parentAndChildrenIds(DEEP_TREE, "A");
    expect(ids.has("B")).toBe(false);
  });

  it("returns only children for the root (no parent)", () => {
    const ids = parentAndChildrenIds(DEEP_TREE, "root");
    expect(ids.has("A")).toBe(true);
    expect(ids.has("B")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns only the parent for a leaf node with no children", () => {
    const ids = parentAndChildrenIds(DEEP_TREE, "A1");
    expect(ids.has("A")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("returns empty set for an unknown node", () => {
    expect(parentAndChildrenIds(DEEP_TREE, "unknown").size).toBe(0);
  });
});

describe("siblingIds", () => {
  it("returns all siblings (excluding self) for a mid-tree node", () => {
    const ids = siblingIds(DEEP_TREE, "A1");
    expect(ids.has("A2")).toBe(true);
    expect(ids.has("A3")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("does not include the node itself", () => {
    expect(siblingIds(DEEP_TREE, "A1").has("A1")).toBe(false);
  });

  it("does not include parent or children", () => {
    const ids = siblingIds(DEEP_TREE, "A");
    expect(ids.has("root")).toBe(false);
    expect(ids.has("A1")).toBe(false);
  });

  it("returns empty set for an only child", () => {
    const onlyChild = node("only");
    const parentNode = node("parent", [onlyChild]);
    const tree = node("root", [parentNode]);
    expect(siblingIds(tree, "only").size).toBe(0);
  });

  it("returns empty set for the root (no parent)", () => {
    expect(siblingIds(DEEP_TREE, "root").size).toBe(0);
  });

  it("returns empty set for an unknown node", () => {
    expect(siblingIds(DEEP_TREE, "unknown").size).toBe(0);
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

// Layout for gatherSubtreeItems tests:
//   subtree-root (0, 0, depth 0)
//   └── subtree-child (220, 0, depth 1)
const subtreeLayout = new Map([
  ["subtree-root", { x: 0, y: 0, depth: 0 }],
  ["subtree-child", { x: 220, y: 0, depth: 1 }],
]);
const SUBTREE_CHILD = node("subtree-child");
const SUBTREE_ROOT = node("subtree-root", [SUBTREE_CHILD]);

describe("gatherSubtreeItems", () => {
  it("does not push the root node itself (isRoot=true)", () => {
    const nodes: Parameters<typeof gatherSubtreeItems>[7] = [];
    const edges: Parameters<typeof gatherSubtreeItems>[8] = [];
    gatherSubtreeItems(SUBTREE_ROOT, subtreeLayout, new Set(), 0, 0, 0, true, nodes, edges);
    const rootEntry = nodes.find((n) => n.id === "subtree-root");
    expect(rootEntry).toBeUndefined();
  });

  it("pushes non-root descendant nodes with absolute positions", () => {
    const nodes: Parameters<typeof gatherSubtreeItems>[7] = [];
    const edges: Parameters<typeof gatherSubtreeItems>[8] = [];
    gatherSubtreeItems(SUBTREE_ROOT, subtreeLayout, new Set(), 0, 0, 0, true, nodes, edges);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: "subtree-child", x: 220, y: 0 });
  });

  it("pushes an edge from root to child", () => {
    const nodes: Parameters<typeof gatherSubtreeItems>[7] = [];
    const edges: Parameters<typeof gatherSubtreeItems>[8] = [];
    gatherSubtreeItems(SUBTREE_ROOT, subtreeLayout, new Set(), 0, 0, 0, true, nodes, edges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ key: "subtree-root-subtree-child", fx: 0, tx: 220 });
  });

  it("stops recursing into collapsed nodes", () => {
    const grandchild = node("grandchild");
    const child = node("child", [grandchild]);
    const root = node("subtree-r", [child]);
    const layout = new Map([
      ["subtree-r", { x: 0, y: 0, depth: 0 }],
      ["child", { x: 220, y: 0, depth: 1 }],
      ["grandchild", { x: 440, y: 0, depth: 2 }],
    ]);
    const nodes: Parameters<typeof gatherSubtreeItems>[7] = [];
    const edges: Parameters<typeof gatherSubtreeItems>[8] = [];
    gatherSubtreeItems(root, layout, new Set(["child"]), 0, 0, 0, true, nodes, edges);
    expect(nodes.find((n) => n.id === "grandchild")).toBeUndefined();
  });

  it("skips children whose position is absent from the layout", () => {
    const orphan = node("orphan");
    const root = node("subtree-r2", [orphan]);
    const layout = new Map([["subtree-r2", { x: 0, y: 0, depth: 0 }]]);
    const nodes: Parameters<typeof gatherSubtreeItems>[7] = [];
    const edges: Parameters<typeof gatherSubtreeItems>[8] = [];
    gatherSubtreeItems(root, layout, new Set(), 0, 0, 0, true, nodes, edges);
    expect(edges).toHaveLength(0);
  });
});

describe("conversionNeedsConfirm", () => {
  it("requires confirmation when the node has children (a subtree is lost)", () => {
    expect(conversionNeedsConfirm(A)).toBe(true);
  });

  it("skips confirmation for a childless leaf (nothing to remap)", () => {
    expect(conversionNeedsConfirm(A1)).toBe(false);
  });
});

describe("collectSubtreePostOrder", () => {
  it("returns leaf nodes before their parents (post-order)", () => {
    const result = collectSubtreePostOrder(A);
    const aIdx = result.findIndex((n) => n.id === "A");
    const a1Idx = result.findIndex((n) => n.id === "A1");
    expect(a1Idx).toBeLessThan(aIdx);
  });

  it("includes all nodes in the subtree", () => {
    const result = collectSubtreePostOrder(A);
    expect(result.map((n) => n.id)).toEqual(expect.arrayContaining(["A1", "A2", "A3", "A"]));
    expect(result).toHaveLength(4);
  });

  it("returns a single-item array for a leaf node", () => {
    const result = collectSubtreePostOrder(A1);
    expect(result).toEqual([{ id: "A1", kind: "domain" }]);
  });

  it("preserves kind in each result entry", () => {
    const taskLeaf = { id: "task-9", kind: "task" as const, title: "t", position: 0, tagIds: [], children: [] };
    const result = collectSubtreePostOrder(taskLeaf);
    expect(result[0]?.kind).toBe("task");
  });
});
