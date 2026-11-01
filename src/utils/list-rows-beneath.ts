import type { MindmapNode } from "@/utils/tree-layout";

/** What the List View knows of a row for "going into" it: the node and the chain above it. */
export interface EnterableRow {
  node: MindmapNode;
  /** Every ancestor, root first and the immediate parent last. */
  ancestors: readonly MindmapNode[];
}

/**
 * Whether any row sits beneath `id`: the List View's double-tap enters such a row as a subtree
 * (Under), and opens the editor of one with nothing beneath it (`docs/spec/touch.md`).
 */
export function hasRowsBeneath(id: string, rows: readonly EnterableRow[]): boolean {
  return rows.some((row) => row.ancestors.some((ancestor) => ancestor.id === id));
}
