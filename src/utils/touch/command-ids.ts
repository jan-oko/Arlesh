/**
 * The same action in each view's own binding ids, for a surface that runs "this action, whichever
 * view is mounted" — the action bar's slots and the touch gestures (`docs/spec/touch.md`). Only one
 * view is mounted at a time, and a binding's guard says whether it applies to what is selected, so
 * running the first of a list that can act is running the right one.
 */

/** The same binding suffix in every view that has it. */
export function everyView(suffix: string): string[] {
  return [`mindmap.${suffix}`, `listView.${suffix}`, `planView.${suffix}`, `stepsView.${suffix}`, `zenView.${suffix}`];
}

/** Plain Enter's advance: a Task's status, a Commitment's verdict, a wait's release. */
export const ADVANCE_IDS: readonly string[] = [
  "mindmap.enter",
  ...everyView("cycleStatus"),
  "listView.cycleVerdict", "zenView.cycleVerdict",
  "listView.toggleReleaseEnter", "zenView.toggleReleaseEnter",
];

/** `Alt+Enter`: Started, or back to In Progress. */
export const TOGGLE_STARTED_IDS: readonly string[] = everyView("toggleStarted");

/** `E`: the selection's editor. */
export const OPEN_EDITOR_IDS: readonly string[] = everyView("openEditor");
