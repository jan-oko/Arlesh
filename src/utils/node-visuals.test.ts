import { describe, it, expect } from "vitest";
import { aspectColorOf, computeNodeAppearance, statusTint } from "./node-visuals";
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

describe("statusTint — what a card's fill says", () => {
  it("says blocked first, whatever the stored status claims", () => {
    expect(statusTint(mkNode({ status: "in_progress", virtualBlockers: ["Blocked by Spec"] })))
      .toBe("--tint-blocked");
  });

  it("says archived over a stored status, the way the model already forces it", () => {
    expect(statusTint(mkNode({ status: "in_progress", archived: true }))).toBe("--tint-archived");
  });

  it("says frozen over the progress made before it", () => {
    expect(statusTint(mkNode({ kind: "goal", status: "frozen" }))).toBe("--tint-frozen");
  });

  it("says done, then in progress, then open", () => {
    expect(statusTint(mkNode({ status: "done" }))).toBe("--tint-done");
    expect(statusTint(mkNode({ kind: "goal", status: "achieved" }))).toBe("--tint-done");
    expect(statusTint(mkNode({ status: "in_progress" }))).toBe("--tint-progress");
    expect(statusTint(mkNode({ status: "todo" }))).toBe("--tint-open");
  });

  it("reads a Commitment on its Verdict, which is the state it actually has", () => {
    expect(statusTint(mkNode({ kind: "commitment", verdict: "broken" }))).toBe("--tint-blocked");
    expect(statusTint(mkNode({ kind: "commitment", verdict: "kept" }))).toBe("--tint-done");
    expect(statusTint(mkNode({ kind: "commitment", verdict: "unresolved" }))).toBe("--tint-open");
  });

  it("reads an Aspect as open — which is what finally makes its card legible", () => {
    expect(statusTint(mkNode({ kind: "aspect", color: "#e74c3c" }))).toBe("--tint-open");
  });

  it("does not depend on where the node sits, only on what state it is in", () => {
    const deep = mkNode({ status: "todo", color: "#2980b9" });
    expect(statusTint(deep)).toBe(statusTint(mkNode({ status: "todo" })));
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
