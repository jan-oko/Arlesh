import type { MindmapNode } from "@/utils/tree-layout";

/** What the List View knows of a row for "going into" it: the node and the chain above it. */
export interface EnterableRow {
  node: MindmapNode;
  /** Every ancestor, root first and the immediate parent last. */
  ancestors: readonly MindmapNode[];
}

/**
 * The node the List View's double-tap narrows **Under** (`docs/spec/touch.md`).
 *
 * A row with rows beneath it is entered itself. A **leaf** has nothing beneath it, so narrowing
 * Under it would empty the list and leave nothing to look at; it is entered through its parent
 * instead, which keeps it on screen among its siblings. A leaf with no parent in the chain is
 * entered as itself.
 */
export function listEnterTarget(id: string, rows: readonly EnterableRow[]): string {
  if (rows.some((row) => row.ancestors.some((ancestor) => ancestor.id === id))) return id;
  const chain = rows.find((row) => row.node.id === id)?.ancestors ?? [];
  const parent = chain[chain.length - 1];
  return parent?.id ?? id;
}
