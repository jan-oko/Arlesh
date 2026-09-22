// One Plan View pane, ready to draw: the runs it is made of, and the row order the keyboard walks.
//
// A pane is **flat**. Headers — a bucket's, a path's — are entries in the same stream the cards are
// in rather than wrappers around them, so `Down` steps from the last card of one bucket to the
// first card of the next and never lands on a heading. `rows` below is that stream with the
// headings taken out, and it is the one axis the selection moves along.

import type { MindmapNode } from "@/utils/tree-layout";
import type { TaskListRow } from "@/utils/list-filter";
import type { PlanSection } from "@/utils/plan-sections";

/** One drawn thing in a pane. */
export type PaneEntry =
  /** The run below hangs directly off the frame — the board's root, or the subtree you entered. */
  | { type: "root" }
  | { type: "path"; pathKey: string; segments: readonly MindmapNode[] }
  | { type: "task"; row: TaskListRow };

/** One drawn run of a pane: an optional bucket header, and the entries under it. */
export interface PaneBlock {
  key: string;
  section: PlanSection | null;
  entries: PaneEntry[];
}

/** A pane, ready to draw, plus the row order the keyboard walks. */
export interface PaneModel {
  blocks: PaneBlock[];
  /** Every task row in the pane, in the order it is drawn. Headers are not in here. */
  rows: TaskListRow[];
  /** Whether buckets are drawn, which decides if an empty pane says so or shows empty buckets. */
  sectioned: boolean;
}

/** Identity of a path: the ancestors it names, in order. Empty for a row hanging off the frame. */
function pathKeyOf(ancestors: readonly MindmapNode[]): string {
  return ancestors.map((ancestor) => ancestor.id).join("\u0000");
}

/**
 * Heads each contiguous run of rows sharing a location with that location.
 *
 * A header carries a row's **whole** ancestor chain, unlike the List View's, which leaves out any
 * ancestor drawn as a row above it because the indentation is already saying so. Nothing is
 * indented here: the two panes answer "what could go in" and "what is in", and a card's place in
 * the tree is not a reason to move it right. So the header says all of it, and the card below says
 * none of it.
 *
 * A run with **nothing** above it gets a root header rather than no header. The alternative leaves
 * one run in the pane whose location is the only one not named, which reads as a bug rather than as
 * "this is the top".
 */
function groupByPath(rows: readonly TaskListRow[]): PaneEntry[] {
  const entries: PaneEntry[] = [];
  let lastKey: string | null = null;
  for (const row of rows) {
    const key = pathKeyOf(row.ancestors);
    if (key !== lastKey) {
      entries.push(row.ancestors.length === 0 ? { type: "root" } : { type: "path", pathKey: key, segments: row.ancestors });
    }
    lastKey = key;
    entries.push({ type: "task", row });
  }
  return entries;
}

/** Path headers are the caller's choice; without them a run is just its rows. */
function entriesFor(rows: readonly TaskListRow[], grouped: boolean): PaneEntry[] {
  if (grouped) return groupByPath(rows);
  return rows.map((row) => ({ type: "task", row }));
}

/** Assembles a pane from its buckets, or from one flat run when it is not split. */
export function buildPaneModel(
  sections: readonly PlanSection[] | null,
  rows: readonly TaskListRow[],
  grouped: boolean,
): PaneModel {
  if (sections === null) {
    return {
      blocks: [{ key: "all", section: null, entries: entriesFor(rows, grouped) }],
      rows: [...rows],
      sectioned: false,
    };
  }
  return {
    blocks: sections.map((section) => ({ key: section.key, section, entries: entriesFor(section.rows, grouped) })),
    rows: sections.flatMap((section) => section.rows),
    sectioned: true,
  };
}
