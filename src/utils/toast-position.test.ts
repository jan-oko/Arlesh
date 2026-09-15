import { describe, it, expect } from "vitest";
import type { Position } from "@/utils/tree-layout";
import { resolveToastPosition, GLOBAL_TOAST_POSITION } from "./toast-position";

describe("resolveToastPosition", () => {
  it("returns the node's own position when it is laid out", () => {
    const nodePos: Position = { x: 42, y: 99, depth: 2 };
    const positions = new Map<string, Position>([["task-1", nodePos]]);
    expect(resolveToastPosition("task-1", positions)).toEqual(nodePos);
  });

  // This is the silent-drop bug: a toast anchored on a node with no laid-out position — because
  // it sits under a collapsed ancestor, or outside the current `enterSubtree` scope — used to
  // have nowhere to render and the caller (MindmapView) simply omitted the <StatusToast/>,
  // destroying the message with no fallback and no error. Any real Position here (not
  // `undefined`) proves the drop is closed.
  it("falls back to the global position instead of vanishing when the anchor node is not laid out", () => {
    const positions = new Map<string, Position>(); // anchor node absent — collapsed/out of scope
    const result = resolveToastPosition("task-not-on-screen", positions);
    expect(result).not.toBeUndefined();
    expect(result).toEqual(GLOBAL_TOAST_POSITION);
  });
});
