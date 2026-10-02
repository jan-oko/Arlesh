import { describe, expect, it } from "vitest";
import { takesCompound } from "@/utils/compound";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";

function node(extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: "n", kind: "task", title: "n", position: 0, tagIds: [], children: [], ...extra };
}

describe("takesCompound", () => {
  it("takes a stored task", () => {
    expect(takesCompound(node({ rowId: 12 }))).toBe(true);
  });

  it("takes an occurrence of a flow Task item", () => {
    expect(takesCompound(node(occurrenceRow({ itemType: "flow_task" })))).toBe(true);
  });

  it("takes an iteration's root, which reads it from its flow", () => {
    expect(takesCompound(node(occurrenceRow({ itemType: "flow_root" })))).toBe(true);
  });

  it("refuses a check task and a node that draws no row", () => {
    const check = node({ rowId: "00000000-0000-5000-8000-000000000001", origin: { kind: "check", wait_kind: "stored", wait_id: 4, due_at: "2026-01-05T09:00:00" } });
    expect(takesCompound(check)).toBe(false);
    expect(takesCompound(node())).toBe(false);
  });
});
