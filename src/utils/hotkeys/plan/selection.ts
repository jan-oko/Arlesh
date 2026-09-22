/** Which pane of the triage the keyboard is acting in. */
export type PlanPane = "candidates" | "planned";

/**
 * What the Plan View has selected: a pane, and a row inside it. Every binding below reads its
 * target off this, so it is the one slice every feature module shares — the same arrangement the
 * List View's bindings have, for the same reason.
 */
export interface PlanSelectionContext {
  /** The pane the selection is in. A pane is always focused, even with nothing selected in it. */
  pane: PlanPane;
  /** The selected task's node id, or null when nothing is selected. */
  selectedTaskId: string | null;
}
