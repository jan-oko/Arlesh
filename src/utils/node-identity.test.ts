import { describe, it, expect } from "vitest";
import { NotRowBackedError, rowIdOf, rowIdOfNodeId } from "@/utils/node-identity";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children: [], ...extra };
}

describe("rowIdOf", () => {
  it("reads task-12's row id off the node, not off its id", () => {
    expect(rowIdOf(node("task-12", { rowId: 12 }))).toBe(12);
  });

  it("returns the field even when the id spelling would decode to something else", () => {
    // The id is a display key; the field is the address. They must never be conflated.
    expect(rowIdOf(node("task-99", { rowId: 12 }))).toBe(12);
  });

  it("throws on a virtual Habit occurrence instead of yielding NaN", () => {
    const occurrence = node("habit-3-0-virtual", { virtual: true });
    expect(() => rowIdOf(occurrence)).toThrow(NotRowBackedError);
    expect(() => rowIdOf(occurrence)).toThrow(/habit-3-0-virtual/);
  });

  it("throws on the synthetic tree root", () => {
    expect(() => rowIdOf(node("root", { kind: "domain" }))).toThrow(NotRowBackedError);
  });
});

describe("rowIdOfNodeId", () => {
  const tree = node("root", {
    kind: "domain",
    children: [node("goal-4", { kind: "goal", rowId: 4, children: [node("task-9", { rowId: 9 })] })],
  });

  it("resolves a nested node id to its row id through the tree", () => {
    expect(rowIdOfNodeId(tree, "task-9")).toBe(9);
  });

  it("throws when the id is not in the tree", () => {
    expect(() => rowIdOfNodeId(tree, "task-10")).toThrow(/task-10/);
  });
});
