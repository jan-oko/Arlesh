/** What system back can do, each answering whether it did something. */
export interface BackActions {
  /** Closes the topmost sheet (modal or inline editor), if one is open. */
  dismissSheet: () => boolean;
  /** Leaves the node the view is stepped into, one level up, if it is stepped into one. */
  leaveSubtree: () => boolean;
  /** Fills the parent scope in the Plan View, if there is one. */
  upScope: () => boolean;
  /** Leaves the app. */
  exit: () => void;
}

/**
 * One press of system back: the first of closing a sheet, leaving a stepped-into node and going up
 * a scope that applies, and only at the root, leaving the app. It never deselects: a selection is
 * not a place the user navigated to, so back has no business undoing it.
 */
export function stepBack(actions: BackActions): void {
  if (actions.dismissSheet()) return;
  if (actions.leaveSubtree()) return;
  if (actions.upScope()) return;
  actions.exit();
}
