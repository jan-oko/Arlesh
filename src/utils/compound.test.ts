import { describe, expect, it } from "vitest";
import { offersCompound, takesCompound } from "@/utils/compound";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";
import { DERIVED_WAIT_CAPABILITIES } from "@/test/capabilities";

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
    const check = node({ rowId: "00000000-0000-5000-8000-000000000001", origin: { kind: "check", wait_kind: "stored", wait_id: 4, due_at: "2026-01-05T09:00:00" }, capabilities: DERIVED_WAIT_CAPABILITIES });
    expect(takesCompound(check)).toBe(false);
    expect(takesCompound(node())).toBe(false);
  });
});

describe("offersCompound", () => {
  const child = node({ id: "c", rowId: 13 });

  it("offers the switch to a task with sub-items", () => {
    expect(offersCompound(node({ rowId: 12, children: [child] }))).toBe(true);
  });

  it("hides it on a task with no sub-items", () => {
    expect(offersCompound(node({ rowId: 12 }))).toBe(false);
  });

  it("does not count an info as a sub-item", () => {
    expect(offersCompound(node({ rowId: 12, children: [node({ id: "i", kind: "info" })] }))).toBe(false);
  });

  it("keeps the switch on a compound task that lost its sub-items, to turn it off", () => {
    expect(offersCompound(node({ rowId: 12, compound: true }))).toBe(true);
  });
});
