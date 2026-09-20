import type { MindmapNode } from "./tree-layout";
import { findNode, owningFlowId } from "./mindmap-tree";
import { isValidDropTarget } from "./node-meta";

/**
 * Why one node on the clipboard cannot be pasted onto a given target.
 *
 * Only one of these is about the destination. A paste used to report every skip with the same
 * "couldn't be pasted here", which sent the user off to find a different parent when the parent was
 * never the problem — the node was an Aspect, or a derived repetition, or a kind that has no copy at
 * all. Each member names a different thing, so each gets a different sentence.
 */
export const PASTE_REFUSAL = {
  /** The id on the clipboard is no longer in the tree — deleted, or filtered out, since the copy. */
  GONE: "gone",
  /** A Habit repetition: worked out from the template at load time, with no row behind it. */
  REPETITION: "repetition",
  /** An Aspect, which is fixed where it is — no destination would have taken it. */
  ASPECT: "aspect",
  /** The one refusal that really is about *here*: this kind cannot live under that parent. */
  HERE: "here",
  /** A COPY of a Commitment: what a copy of a recorded Verdict means has never been decided. */
  COMMITMENT: "commitment",
  /** A COPY of a flow item into another Flow: its Cycle Scope offsets into its own Flow's window. */
  OTHER_FLOW: "otherFlow",
} as const;

/** One reason a single node was left behind by a paste. */
export type PasteRefusal = (typeof PASTE_REFUSAL)[keyof typeof PASTE_REFUSAL];

/**
 * The `warnings` key each refusal reports itself with. Every one is pluralised, because a refusal
 * counts the nodes it applies to rather than naming them.
 */
export const PASTE_REFUSAL_KEY = {
  gone: "pasteSkippedGone",
  repetition: "pasteSkippedRepetition",
  aspect: "pasteSkippedAspect",
  here: "pasteSkippedHere",
  commitment: "pasteSkippedCommitment",
  otherFlow: "pasteSkippedOtherFlow",
} as const satisfies Record<PasteRefusal, string>;

/**
 * Report order, fixed so the same mixed selection always produces the same sentence. Destination
 * first because it is the one the user can act on where they are standing; the stale clipboard last
 * because it is about a gesture already finished.
 */
const REFUSAL_ORDER: readonly PasteRefusal[] = [
  PASTE_REFUSAL.HERE,
  PASTE_REFUSAL.ASPECT,
  PASTE_REFUSAL.REPETITION,
  PASTE_REFUSAL.COMMITMENT,
  PASTE_REFUSAL.OTHER_FLOW,
  PASTE_REFUSAL.GONE,
];

/**
 * Why `nodeId` cannot be pasted onto `target`, or `null` when it can.
 *
 * Order matters where a node trips more than one rule: the deeper fact wins. A repetition is
 * reported as a repetition even though its kind would also have been refused by the drop rule, and
 * an Aspect as an Aspect rather than as a destination mismatch, since no destination exists for it.
 */
export function pasteRefusal(
  tree: MindmapNode,
  nodeId: string,
  target: MindmapNode,
  isCopy: boolean,
): PasteRefusal | null {
  const node = findNode(tree, nodeId);
  if (node === undefined) return PASTE_REFUSAL.GONE;
  if (node.virtual === true) return PASTE_REFUSAL.REPETITION;
  if (node.kind === "aspect") return PASTE_REFUSAL.ASPECT;
  if (!isValidDropTarget(node.kind, target.kind)) return PASTE_REFUSAL.HERE;
  // Everything below is about duplication, so a CUT of the same node is fine and says nothing.
  if (!isCopy) return null;
  if (node.kind === "commitment") return PASTE_REFUSAL.COMMITMENT;
  if (
    (node.kind === "flow_goal" || node.kind === "flow_task") &&
    owningFlowId(tree, nodeId) !== owningFlowId(tree, target.id)
  ) {
    return PASTE_REFUSAL.OTHER_FLOW;
  }
  return null;
}

/** One refusal and how many of the pasted nodes hit it. */
export interface PasteRefusalCount {
  refusal: PasteRefusal;
  count: number;
}

/**
 * The refusals a paste collected, counted and in report order. Reasons nothing hit are dropped, so
 * an all-legal paste reports nothing at all.
 */
export function countPasteRefusals(refusals: readonly PasteRefusal[]): PasteRefusalCount[] {
  const counts: PasteRefusalCount[] = [];
  for (const refusal of REFUSAL_ORDER) {
    const count = refusals.filter((candidate) => candidate === refusal).length;
    if (count > 0) counts.push({ refusal, count });
  }
  return counts;
}
