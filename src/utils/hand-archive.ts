import type { MindmapNode } from "@/utils/tree-layout";

/** The status an archived Domain carries — the Project status it shares (Task bd3). */
export const DOMAIN_ARCHIVED_STATUS = "archived";

/**
 * Whether a node takes the hand archive — Archive and Unarchive: a **stored** Task or Commitment
 * (Task 269), or a Domain (Task bd3), which is archived through the status a Project already has.
 * A Habit occurrence is archived through Delete instead; a Project is archived through its own
 * status in its editor; a wait's check task, a spawned or delegation wait and every other kind
 * have no archive of their own to set.
 */
export function canArchiveByHand(node: MindmapNode): boolean {
  if (node.kind !== "task" && node.kind !== "commitment" && node.kind !== "domain") return false;
  return node.rowId !== undefined && (node.origin === undefined || node.origin.kind === "manual");
}

/** Whether `node` is the one put away by hand: its own archive, not one it inherits. */
export function isArchivedByHand(node: MindmapNode): boolean {
  if (node.kind === "domain") return node.status === DOMAIN_ARCHIVED_STATUS;
  return node.archivedByHand === true;
}

/** What a context menu offers for the hand archive: Archive, Unarchive, or nothing. */
export type ArchiveOffer = "archive" | "unarchive" | null;

/** The hand-archive offer for a node: none unless it takes one, else Unarchive on the one archived. */
export function archiveOfferFor(node: MindmapNode): ArchiveOffer {
  if (!canArchiveByHand(node)) return null;
  return isArchivedByHand(node) ? "unarchive" : "archive";
}
