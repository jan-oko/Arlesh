/**
 * What List View has selected. Every binding below reads its target off this, so it is the one
 * slice every feature module shares — and the only one. A feature's own callbacks live with its
 * bindings, which is what keeps two features out of each other's files.
 */
export interface ListSelectionContext {
  /** The selected row when it is a Task; null when a Commitment is selected, or nothing is. */
  selectedTaskId: string | null;
  /** The selected row when it is a Commitment. Never set at the same time as `selectedTaskId`:
   * List View has one selection, and which kind it is decides what Enter means. */
  selectedCommitmentId: string | null;
  /** Whichever of the two is set — for the bindings that do not care which kind it is. */
  selectedRowId: string | null;
}
