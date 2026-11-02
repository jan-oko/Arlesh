import type { MindmapNode } from "@/utils/tree-layout";
import { checkOrigin } from "@/api/node-id";
import { canArchiveByHand, isArchivedByHand } from "@/utils/hand-archive";

/**
 * The open check on a wait, if it has one: the earliest-due check task drawn beneath it that is not
 * yet done. Completing it is what the action bar's *Check done* does.
 */
export function openCheckOf(wait: MindmapNode): MindmapNode | undefined {
  if (wait.kind !== "expectation" && wait.kind !== "flow_expectation") return undefined;
  const open = wait.children.filter((child) => (
    child.kind === "task" && checkOrigin(child.origin) !== undefined && child.taskStatus?.status !== "done"
  ));
  const dueAt = (node: MindmapNode) => checkOrigin(node.origin)?.due_at ?? "";
  return open.sort((a, b) => dueAt(a).localeCompare(dueAt(b)))[0];
}

/** What archiving a selection does: the nodes to write, the direction, and how many it skips. */
export interface ArchivePlan {
  /** The nodes that take the hand archive. */
  nodes: MindmapNode[];
  /** True to archive; false when every one of them is already archived, so the gesture brings them back. */
  archive: boolean;
  /** How many selected nodes take no hand archive and are left as they are. */
  skipped: number;
}

/** The plan for archiving `selection`, or `null` when none of it takes the hand archive. */
export function archivePlanFor(selection: readonly MindmapNode[]): ArchivePlan | null {
  const nodes = selection.filter(canArchiveByHand);
  if (nodes.length === 0) return null;
  return {
    nodes,
    archive: !nodes.every(isArchivedByHand),
    skipped: selection.length - nodes.length,
  };
}
