// Where a node sits in the tree **as it is drawn**, rather than as it is loaded.
//
// The two differ in exactly one way: a run of passed Habit iterations is folded into one node, and
// expands into scope levels (see `habit-collapse.ts`). Those nodes have no counterpart in the loaded
// tree, so `pathToNode` cannot find them — and a tab whose subtree root is one of them would be
// bounced to the true root on the next load. This module finds them by doing what drew them: it
// folds the Habit's host again and looks there.
//
// A fold id is therefore an **address**, not a pointer. The run is `habitrun-{flow}-virtual`; a
// scope level is `habitrun-{flow}-{level}-{first day of its span}-virtual`. The flow names the host
// to fold, and folding it is deterministic, so the id resolves after a reload exactly as it did
// before — for as long as the run it names is still drawn.

import { findNode, pathToNode } from "@/utils/mindmap-tree";
import {
  foldHabitRuns, habitGroupFlowId, habitRunId, pathToHabitHost,
} from "@/utils/habit-collapse";
import type { HabitCollapseLabels } from "@/utils/habit-collapse";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * How a view draws a Habit's host before folding it: the fold runs **after** the filter, so the
 * drawn run holds whichever iterations the filter kept.
 */
export interface FoldReading {
  /** "Collapse habit history after N". */
  threshold: number;
  labels: HabitCollapseLabels;
  /** The host as the view draws it — filtered, with whatever exemption the view applies. */
  drawHost: (host: MindmapNode) => MindmapNode;
}

/** The fold's own nodes from the run down to `id`, as drawn under `host`; `[]` when not there. */
function foldPathUnder(host: MindmapNode, id: string, reading: FoldReading): readonly MindmapNode[] {
  const folded = foldHabitRuns(reading.drawHost(host), reading.threshold, reading.labels);
  return pathToNode(folded, id).slice(1);
}

/** The drawn path to a fold node: the loaded path to its host, then the fold's own nodes. */
function pathToFoldNode(tree: MindmapNode, id: string, flowId: number, reading: FoldReading): readonly MindmapNode[] {
  const hostPath = pathToHabitHost(tree, flowId);
  const host = hostPath[hostPath.length - 1];
  if (host === undefined) return [];
  const fold = foldPathUnder(host, id, reading);
  return fold.length === 0 ? [] : [...hostPath, ...fold];
}

/**
 * The loaded path, with the fold's nodes put back between a host and a passed iteration the fold
 * draws inside a run — so a Step inside an iteration names the levels you walked down through, and
 * climbing out of it lands on the level rather than skipping to the host.
 */
function spliceFoldIntoPath(path: readonly MindmapNode[], reading: FoldReading): readonly MindmapNode[] {
  const index = path.findIndex((node, at) => at > 0 && node.habitIteration?.passed === true);
  const host = path[index - 1];
  const iteration = path[index];
  if (index === -1 || host === undefined || iteration === undefined) return path;
  // The fold path ends at the iteration itself; a run shorter than the threshold draws it bare.
  const fold = foldPathUnder(host, iteration.id, reading);
  if (fold.length <= 1) return path;
  return [...path.slice(0, index), ...fold.slice(0, -1), ...path.slice(index)];
}

/**
 * The path from `tree`'s root to `id` as the tree is drawn: `[]` when `id` is not drawn at all.
 *
 * For a stored or derived node it is the loaded path, with a folded run's nodes between the host and
 * a folded iteration. For a fold node it is the path to its host followed by the fold's own nodes
 * down to it.
 */
export function drawnPathToNode(tree: MindmapNode, id: string, reading: FoldReading): readonly MindmapNode[] {
  const flowId = habitGroupFlowId(id);
  if (flowId !== undefined) return pathToFoldNode(tree, id, flowId, reading);
  return spliceFoldIntoPath(pathToNode(tree, id), reading);
}

/**
 * Where a view rooted at `id` stands when `id` is no longer drawn: the nearest thing still there,
 * or `null` for the true root.
 *
 * A stored node that has gone has nothing above it to climb to — its parent is not recorded
 * anywhere once it is gone — so it goes to the root, as it always has. A fold node's address still
 * names its Habit, so a level that stopped being drawn (the filter took its iterations, or the run
 * now spans one unit fewer) climbs to the **run**, and a run that stopped being drawn (it fell
 * under the threshold) to the Habit's **host**, where its iterations now stand on their own.
 */
export function fallbackRootFor(tree: MindmapNode, id: string, reading: FoldReading): string | null {
  const flowId = habitGroupFlowId(id);
  if (flowId === undefined) return null;
  const runId = habitRunId(flowId);
  if (runId !== id && drawnPathToNode(tree, runId, reading).length > 0) return runId;
  const hostPath = pathToHabitHost(tree, flowId);
  const host = hostPath[hostPath.length - 1];
  return host === undefined || host.id === tree.id ? null : host.id;
}

/**
 * The **stored** node a view that cannot draw a fold node roots itself at: the node itself when it
 * is loaded, a fold node's Habit host otherwise, and the whole tree when neither is on the board.
 *
 * The Mindmap and the List View draw a subtree from the loaded tree. Neither can stand on a folded
 * run — so a tab rooted at one, from the Steps View, shows the run where it lives.
 */
export function storedSubtreeBase(tree: MindmapNode, id: string | null): MindmapNode {
  if (id === null) return tree;
  const found = findNode(tree, id);
  if (found !== undefined) return found;
  const flowId = habitGroupFlowId(id);
  if (flowId === undefined) return tree;
  const hostPath = pathToHabitHost(tree, flowId);
  return hostPath[hostPath.length - 1] ?? tree;
}
