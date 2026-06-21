import { describe, it, expect } from "vitest";
import { computeLayout } from "./tree-layout";
import type { MindmapNode } from "./tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, tagIds: [], children };
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
