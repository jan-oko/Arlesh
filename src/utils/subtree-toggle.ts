// Opening — or shutting — a node and everything underneath it in one gesture.
//
// Three things make this more than a walk of the loaded tree.
//
// **There are two collapse mechanisms, and they are inverted relative to each other.** An ordinary
// node is drawn open unless its id is in `collapsedNodeIds`; a node the Habit fold draws — the run
// of passed iterations and each scope level inside it — is drawn *shut* unless its id is in
// `expandedHabitGroupIds` (see `habit-collapse.ts`). So expanding a subtree means clearing ids from
// one set and adding ids to the other, on the way down, node by node — and collapsing one means
// exactly the mirror. A walk that knew only about the first would appear to work everywhere except
// over the fold, which is where the gesture is worth the most.
//
// **The fold's nodes exist only in the drawn tree**, so the walk runs over the tree the canvas
// draws rather than the loaded one. It needs no fixed point to do it: `foldHabitRuns` builds a
// run's whole expansion eagerly — every level, and every iteration beneath them — and the two sets
// only decide how much of it the layout descends into. The nodes an expansion reveals are
// therefore already in the tree being walked, so one pass sees all of them.
//
// **Which way the gesture goes is read off one node: the one it was pressed on.** The state that
// decides it is already reconciled for us — `collapsedWithFoldedGroups` merges the two mechanisms
// into the single set the layout lays out with, so "drawn shut" is one lookup in it and neither
// polarity has to be re-derived here. A subtree is a mixture far more often than not, and picking
// the direction from a mixture would leave the gesture unable to say what a second press does; the
// pressed node's own state always flips, so a second press is always the other direction.

import { isHabitGroupNode } from "@/utils/habit-collapse";
import { findNode } from "@/utils/mindmap-tree";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * What one recursive toggle does to the two sets, each field named in the polarity its own set
 * reads in — the naming is what stops the two being merged by a later reader, since every field
 * here holds tree ids and nothing but the name says which set they belong to.
 */
export type SubtreeToggle =
  | {
      readonly direction: "expand";
      /** Ids to **clear** from `collapsedNodeIds` — the ordinary nodes, for which absent means open. */
      readonly collapsedIdsToClear: ReadonlySet<string>;
      /** Ids to **add** to `expandedHabitGroupIds` — the fold's nodes, for which absent means shut. */
      readonly habitGroupIdsToOpen: ReadonlySet<string>;
    }
  | {
      readonly direction: "collapse";
      /** Ids to **add** to `collapsedNodeIds` — present means shut, for the ordinary nodes. */
      readonly collapsedIdsToAdd: ReadonlySet<string>;
      /** Ids to **remove** from `expandedHabitGroupIds` — absent means shut, for the fold's nodes. */
      readonly habitGroupIdsToShut: ReadonlySet<string>;
    };

/** Nothing to do: the answer when the id names no drawn node. */
const NOTHING: SubtreeToggle = {
  direction: "expand",
  collapsedIdsToClear: new Set(),
  habitGroupIdsToOpen: new Set(),
};

/** A subtree's ids split by which of the two sets each node answers to, before a direction is put on them. */
interface SubtreeIds {
  readonly ordinary: ReadonlySet<string>;
  readonly habitGroups: ReadonlySet<string>;
}

/** Every id in the subtree rooted at `start`, itself included, split by mechanism. */
function subtreeIds(start: MindmapNode): SubtreeIds {
  const ordinary = new Set<string>();
  const habitGroups = new Set<string>();
  const stack: MindmapNode[] = [start];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isHabitGroupNode(node)) habitGroups.add(node.id);
    else ordinary.add(node.id);
    for (const child of node.children) stack.push(child);
  }
  return { ordinary, habitGroups };
}

/**
 * What pressing the recursive toggle on `id` should do: open the whole subtree if the node is
 * currently drawn shut, or shut the whole subtree if it is drawn open — the node it was pressed on
 * included either way, which is what makes a second press the other direction.
 *
 * `drawnCollapsedIds` is `collapsedWithFoldedGroups`' answer: the one set the canvas lays out with,
 * in which an id is present exactly when that node's children are hidden, whichever of the two
 * mechanisms is hiding them.
 *
 * Collapsing descends rather than just shutting the pressed node, because the two sets are also
 * what the single-node `Ctrl+/` reads: a shallow collapse would leave the inside of a run open for
 * the next press to reveal wholesale, instead of one level at a time.
 *
 * An id naming no node in `drawnRoot` does nothing rather than throwing: the selection can name a
 * node the filter has since dropped, and a keypress that finds nothing to act on is not an error.
 */
export function subtreeToggle(
  drawnRoot: MindmapNode,
  id: string,
  drawnCollapsedIds: ReadonlySet<string>,
): SubtreeToggle {
  const start = findNode(drawnRoot, id);
  if (start === undefined) return NOTHING;
  const { ordinary, habitGroups } = subtreeIds(start);
  if (drawnCollapsedIds.has(id)) {
    return { direction: "expand", collapsedIdsToClear: ordinary, habitGroupIdsToOpen: habitGroups };
  }
  return { direction: "collapse", collapsedIdsToAdd: ordinary, habitGroupIdsToShut: habitGroups };
}
