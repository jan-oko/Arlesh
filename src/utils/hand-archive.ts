import type { MindmapNode } from "@/utils/tree-layout";

/**
 * Whether a node takes the hand archive — Archive and Unarchive (Task 269): a **stored** Task or
 * Commitment. A Habit occurrence is archived through Delete instead, and a wait's check task, a
 * spawned or delegation wait and every other kind have no archive of their own to set.
 */
export function canArchiveByHand(node: MindmapNode): boolean {
  if (node.kind !== "task" && node.kind !== "commitment") return false;
  return node.rowId !== undefined && (node.origin === undefined || node.origin.kind === "manual");
}

/** What a context menu offers for the hand archive: Archive, Unarchive, or nothing. */
export type ArchiveOffer = "archive" | "unarchive" | null;

/** The hand-archive offer for a node: none unless it takes one, else Unarchive on the one archived. */
export function archiveOfferFor(node: MindmapNode): ArchiveOffer {
  if (!canArchiveByHand(node)) return null;
  return node.archivedByHand === true ? "unarchive" : "archive";
}
