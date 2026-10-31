import { describe, expect, it } from "vitest";
import type { MindmapNode } from "@/utils/tree-layout";
import { archivePlanFor, openCheckOf } from "./board-writes";

function node(over: Partial<MindmapNode>): MindmapNode {
  return { id: "n", kind: "task", title: "t", children: [], ...over } as MindmapNode;
}
const check = (id: string, dueAt: string, done = false) => node({
  id, kind: "task", rowId: 1,
  origin: { kind: "check", wait_kind: "stored", wait_id: 9, due_at: dueAt },
  taskStatus: { kind: "ordinary", status: done ? "done" : "todo" },
});

describe("openCheckOf", () => {
  it("finds the earliest-due check that is not done", () => {
    const wait = node({ kind: "expectation", children: [check("late", "2026-02-01T00:00:00"), check("early", "2026-01-01T00:00:00"), check("old", "2025-01-01T00:00:00", true)] });
    expect(openCheckOf(wait)?.id).toBe("early");
  });

  it("is none for a wait with every check done, and for anything but a wait", () => {
    expect(openCheckOf(node({ kind: "expectation", children: [check("a", "2026-01-01T00:00:00", true)] }))).toBeUndefined();
    expect(openCheckOf(node({ kind: "task", children: [check("a", "2026-01-01T00:00:00")] }))).toBeUndefined();
  });
});

describe("archivePlanFor", () => {
  const stored = (over: Partial<MindmapNode>) => node({ rowId: 1, origin: { kind: "manual" }, ...over });

  it("archives what takes the archive and counts what does not", () => {
    const plan = archivePlanFor([stored({ id: "a" }), node({ id: "g", kind: "goal", rowId: 2 })]);
    expect(plan).toMatchObject({ archive: true, skipped: 1 });
    expect(plan?.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("brings the selection back when every node is already archived", () => {
    expect(archivePlanFor([stored({ archivedByHand: true }), stored({ archivedByHand: true })])?.archive).toBe(false);
  });

  it("is none when nothing takes the archive", () => {
    expect(archivePlanFor([node({ kind: "goal", rowId: 2 })])).toBeNull();
  });
});
