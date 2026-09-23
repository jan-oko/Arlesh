/** Which pane of the triage the keyboard is acting in. */
export type PlanPane = "candidates" | "planned";

/**
 * What the Plan View has selected: a pane, the rows selected in it, and the row the cursor is on.
 * Every binding below reads its target off this, so it is the one slice every feature module
 * shares — the same arrangement the List View's bindings have, for the same reason.
 *
 * The **lead** and the **set** answer different questions and both are here. A gesture that acts on
 * one row — opening an editor — reads the lead, because a set of five has no one editor to open. A
 * gesture that writes reads the set, because planning is the thing multi-select exists for.
 */
export interface PlanSelectionContext {
  /** The pane the selection is in. A pane is always focused, even with nothing selected in it. */
  pane: PlanPane;
  /** The row the cursor is on, or null when nothing is selected. */
  selectedTaskId: string | null;
  /** Every selected row, in the order it is drawn. Holds the lead whenever the lead is set. */
  selectedTaskIds: readonly string[];
}
