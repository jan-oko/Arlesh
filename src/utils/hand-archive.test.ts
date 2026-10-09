import { describe, expect, it } from "vitest";
import { archiveOfferFor, canArchiveByHand } from "./hand-archive";
import type { MindmapNode } from "@/utils/tree-layout";
import { occurrenceRow } from "@/test/occurrence";

function node(overrides: Partial<MindmapNode>): MindmapNode {
  return { id: "task-1", kind: "task", title: "T", position: 0, tagIds: [], children: [], rowId: 1, ...overrides };
}

describe("canArchiveByHand", () => {
  it("takes a stored Task and a stored Commitment", () => {
    expect(canArchiveByHand(node({}))).toBe(true);
    expect(canArchiveByHand(node({ kind: "commitment", origin: { kind: "manual" } }))).toBe(true);
  });

  it("refuses a Habit occurrence, a wait's check task, and every other kind", () => {
    expect(canArchiveByHand(node({ ...occurrenceRow({ habitId: 3, itemType: "flow_task", itemId: 4 }) }))).toBe(false);
    expect(canArchiveByHand(node({ origin: { kind: "check", wait_kind: "stored", wait_id: 2, due_at: "2026-10-03T02:00:00" } }))).toBe(false);
    expect(canArchiveByHand(node({ kind: "goal" }))).toBe(false);
    expect(canArchiveByHand(node({ kind: "expectation" }))).toBe(false);
  });

  it("refuses a node with no row behind it", () => {
    const unsaved = node({});
    delete unsaved.rowId;
    expect(canArchiveByHand(unsaved)).toBe(false);
  });
});

describe("archiveOfferFor", () => {
  it("offers Archive on a live Task and Unarchive on the one archived by hand", () => {
    expect(archiveOfferFor(node({}))).toBe("archive");
    expect(archiveOfferFor(node({ archivedByHand: true }))).toBe("unarchive");
  });

  it("offers Archive on a Domain and Unarchive on an archived one, but nothing on a Project, Aspect or Tag", () => {
    expect(archiveOfferFor(node({ id: "domain-2", kind: "domain" }))).toBe("archive");
    expect(archiveOfferFor(node({ id: "domain-2", kind: "domain", status: "archived" }))).toBe("unarchive");
    expect(archiveOfferFor(node({ id: "domain-3", kind: "project", status: "archived" }))).toBeNull();
    expect(archiveOfferFor(node({ id: "domain-4", kind: "aspect" }))).toBeNull();
    expect(archiveOfferFor(node({ id: "domain-5", kind: "tag" }))).toBeNull();
  });

  it("offers nothing on a node beneath a hand archive, which is archived but not by hand", () => {
    expect(archiveOfferFor(node({ kind: "goal", archived: true }))).toBeNull();
  });
});
