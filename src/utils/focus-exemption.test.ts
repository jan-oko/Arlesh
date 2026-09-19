import { describe, it, expect } from "vitest";
import { focusExemptPath } from "./focus-exemption";
import type { MindmapNode, NodeKind } from "./tree-layout";

function n(id: string, kind: NodeKind, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children };
}

const tree = () =>
  n("root", "domain", [
    n("aspect-1", "aspect", [n("project-1", "project", [n("goal-1", "goal", [n("task-1", "task")])])]),
    n("aspect-2", "aspect", [n("task-2", "task")]),
  ]);

describe("focusExemptPath", () => {
  it("holds the focused node and every ancestor that reaches it, and nothing else", () => {
    expect(focusExemptPath(tree(), "task-1")).toEqual(new Set(["root", "aspect-1", "project-1", "goal-1", "task-1"]));
  });

  it("holds nothing when nothing is focused", () => {
    expect(focusExemptPath(tree(), null).size).toBe(0);
  });

  it("holds nothing when the focused node is not in this tree (it may be outside the subtree on screen)", () => {
    expect(focusExemptPath(tree(), "task-999").size).toBe(0);
  });

  it("holds the root alone when the root itself is focused", () => {
    expect(focusExemptPath(tree(), "root")).toEqual(new Set(["root"]));
  });
});
