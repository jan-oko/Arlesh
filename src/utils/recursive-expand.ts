// Opening a node and everything underneath it in one gesture.
//
// Two things make this more than a walk of the loaded tree.
//
// **There are two collapse mechanisms, and they are inverted relative to each other.** An ordinary
// node is drawn open unless its id is in `collapsedNodeIds`; a node the Habit fold draws — the run
// of passed iterations and each scope level inside it — is drawn *shut* unless its id is in
// `expandedHabitGroupIds` (see `habit-collapse.ts`). So expanding a subtree means clearing ids from
// one set and adding ids to the other, on the way down, node by node. A walk that knew only about
// the first would appear to work everywhere except over the fold, which is where the gesture is
// worth the most.
//
// **The fold's nodes exist only in the drawn tree**, so the walk runs over the tree the canvas
// draws rather than the loaded one. It needs no fixed point to do it: `foldHabitRuns` builds a
// run's whole expansion eagerly — every level, and every iteration beneath them — and the two sets
// only decide how much of it the layout descends into. The nodes an expansion reveals are
// therefore already in the tree being walked, so one pass sees all of them.

import { isHabitGroupNode } from "@/utils/habit-collapse";
import { findNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/** The two sets one recursive expansion touches, each named in the polarity its own set reads in. */
export interface SubtreeExpansion {
  /** Ids to **clear** from `collapsedNodeIds` — the ordinary nodes, for which absent means open. */
  readonly collapsedIdsToClear: ReadonlySet<string>;
  /** Ids to **add** to `expandedHabitGroupIds` — the fold's nodes, for which absent means shut. */
  readonly habitGroupIdsToOpen: ReadonlySet<string>;
}

/** Nothing to expand: the answer when the id names no drawn node. */
const NOTHING: SubtreeExpansion = { collapsedIdsToClear: new Set(), habitGroupIdsToOpen: new Set() };

/**
 * Everything `id` opens when it is expanded recursively: itself and every node beneath it in the
 * **drawn** tree, split by which of the two sets each one answers to.
 *
 * An id naming no node in `drawnRoot` expands nothing rather than throwing: the selection can name
 * a node the filter has since dropped, and a keypress that finds nothing to act on is not an error.
 */
export function subtreeExpansion(drawnRoot: MindmapNode, id: string): SubtreeExpansion {
  const start = findNode(drawnRoot, id);
  if (start === undefined) return NOTHING;
  const collapsedIdsToClear = new Set<string>();
  const habitGroupIdsToOpen = new Set<string>();
  const stack: MindmapNode[] = [start];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isHabitGroupNode(node)) habitGroupIdsToOpen.add(node.id);
    else collapsedIdsToClear.add(node.id);
    for (const child of node.children) stack.push(child);
  }
  return { collapsedIdsToClear, habitGroupIdsToOpen };
}
