import { describe, it, expect } from "vitest";
import { computeLayout, computeSubtreeLayout, entityNodeId, HORIZONTAL_GAP } from "./tree-layout";
import type { MindmapNode } from "./tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, position: 0, tagIds: [], children };
}

describe("computeLayout", () => {
  it("places root at origin", () => {
    const root = node("root");
    const positions = computeLayout(root, new Set());
    expect(positions.get("root")).toEqual({ x: 0, y: 0, depth: 0 });
  });

  it("places a single child to the right of root", () => {
    const root = node("root", [node("a")]);
    const positions = computeLayout(root, new Set());
    const rootPos = positions.get("root")!;
    const childPos = positions.get("a")!;
    expect(childPos.x).toBeGreaterThan(rootPos.x);
  });

  it("splits two children left and right", () => {
    const root = node("root", [node("right"), node("left")]);
    const positions = computeLayout(root, new Set());
    const rootX = positions.get("root")!.x;
    expect(positions.get("right")!.x).toBeGreaterThan(rootX);
    expect(positions.get("left")!.x).toBeLessThan(rootX);
  });

  it("omits collapsed node children from layout", () => {
    const root = node("root", [node("parent", [node("hidden-child")])]);
    const positions = computeLayout(root, new Set(["parent"]));
    expect(positions.has("hidden-child")).toBe(false);
    expect(positions.has("parent")).toBe(true);
  });

  it("all nodes appear in layout for uncollapsed tree", () => {
    const root = node("root", [node("a", [node("a1"), node("a2")]), node("b")]);
    const positions = computeLayout(root, new Set());
    expect(positions.size).toBe(5);
  });
});

describe("computeSubtreeLayout", () => {
  it("places the root at the origin", () => {
    const root = node("r", [node("c")]);
    const positions = computeSubtreeLayout(root, new Set(), 1);
    expect(positions.get("r")).toEqual({ x: 0, y: 0, depth: 0 });
  });

  it("places children to the right when direction is 1", () => {
    const root = node("r", [node("c")]);
    const positions = computeSubtreeLayout(root, new Set(), 1);
    const childX = positions.get("c")?.x ?? 0;
    expect(childX).toBeGreaterThan(0);
  });

  it("places children to the left when direction is -1", () => {
    const root = node("r", [node("c")]);
    const positions = computeSubtreeLayout(root, new Set(), -1);
    const childX = positions.get("c")?.x ?? 0;
    expect(childX).toBeLessThan(0);
  });

  it("omits grandchildren when the root is collapsed", () => {
    const grandchild = node("gc");
    const child = node("c", [grandchild]);
    const root = node("r", [child]);
    const positions = computeSubtreeLayout(root, new Set(["r"]), 1);
    expect(positions.has("c")).toBe(false);
    expect(positions.has("gc")).toBe(false);
  });

  it("includes only root when it has no children", () => {
    const root = node("r");
    const positions = computeSubtreeLayout(root, new Set(), 1);
    expect(positions.size).toBe(1);
    expect(positions.has("r")).toBe(true);
  });
});

describe("entityNodeId", () => {
  it("maps every domain-table subtype into the shared domain-<id> namespace", () => {
    expect(entityNodeId("project", 96)).toBe("domain-96");
    expect(entityNodeId("aspect", 1)).toBe("domain-1");
    expect(entityNodeId("domain", 4)).toBe("domain-4");
    expect(entityNodeId("tag", 7)).toBe("domain-7");
  });

  it("keeps goal and task in their own namespaces", () => {
    expect(entityNodeId("goal", 5)).toBe("goal-5");
    expect(entityNodeId("task", 8)).toBe("task-8");
  });
});

describe("computeLayout — vertical orientation", () => {
  it("places root at origin", () => {
    const root = node("root");
    const positions = computeLayout(root, new Set(), "vertical");
    expect(positions.get("root")).toEqual({ x: 0, y: 0, depth: 0 });
  });

  it("places a single child below root", () => {
    const root = node("root", [node("a")]);
    const positions = computeLayout(root, new Set(), "vertical");
    expect(positions.get("a")!.y).toBeGreaterThan(positions.get("root")!.y);
  });

  it("splits two children below and above", () => {
    const root = node("root", [node("below"), node("above")]);
    const positions = computeLayout(root, new Set(), "vertical");
    const rootY = positions.get("root")!.y;
    expect(positions.get("below")!.y).toBeGreaterThan(rootY);
    expect(positions.get("above")!.y).toBeLessThan(rootY);
  });

  it("spreads same-depth siblings sideways at a shared depth line", () => {
    const root = node("root", [node("a"), node("b"), node("c")]);
    const positions = computeLayout(root, new Set(), "vertical");
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    expect(a.y).toBe(b.y);
    expect(a.x).not.toBe(b.x);
  });

  it("grows depth along y, not x", () => {
    const root = node("root", [node("a", [node("a1")])]);
    const positions = computeLayout(root, new Set(), "vertical");
    const a = positions.get("a")!;
    const a1 = positions.get("a1")!;
    expect(a1.y).toBeGreaterThan(a.y);
    expect(a1.x).toBe(a.x);
  });

  it("leaves same-side sibling spacing wide enough for the widest node", () => {
    // Three children: a and b share the downward half, c takes the upward one.
    const root = node("root", [node("a"), node("b"), node("c")]);
    const positions = computeLayout(root, new Set(), "vertical");
    const gap = Math.abs(positions.get("a")!.x - positions.get("b")!.x);
    expect(gap).toBeGreaterThanOrEqual(HORIZONTAL_GAP);
  });

  it("defaults to horizontal when no orientation is given", () => {
    const root = node("root", [node("a")]);
    expect(computeLayout(root, new Set())).toEqual(computeLayout(root, new Set(), "horizontal"));
  });
});

describe("computeSubtreeLayout — vertical orientation", () => {
  it("places children below when direction is 1", () => {
    const root = node("r", [node("c")]);
    const positions = computeSubtreeLayout(root, new Set(), 1, "vertical");
    expect(positions.get("c")!.y).toBeGreaterThan(0);
  });

  it("places children above when direction is -1", () => {
    const root = node("r", [node("c")]);
    const positions = computeSubtreeLayout(root, new Set(), -1, "vertical");
    expect(positions.get("c")!.y).toBeLessThan(0);
  });
});
