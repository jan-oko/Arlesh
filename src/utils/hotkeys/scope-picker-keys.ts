import type { Chord, HotkeyLabelKey } from "./chord";
import { matchesChord } from "./chord";

/** What a key does inside a Scope Picker. */
export type ScopePickerAction =
  | "moveLeft" | "moveRight" | "moveUp" | "moveDown"
  | "previousPeriod" | "nextPeriod" | "up"
  | "pick" | "enter" | "apply" | "close";

/** One key of the Scope Picker's keyboard, and its cheat-sheet row. */
export interface ScopePickerKey {
  action: ScopePickerAction;
  chord: Chord;
  labelKey: HotkeyLabelKey;
}

/**
 * The Scope Picker's own keyboard — every picker, the editor fields' and the `P` quick picker's.
 *
 * Not bindings in the registry: they act on the focused picker, not on a view, and only while focus
 * is inside it (the picker marks itself `data-owns-keys`, so the view's own `[` `]` `\` and arrows
 * stand aside). The picker dispatches from this table and the cheat-sheet lists it, so the two
 * cannot disagree.
 *
 * `[` `]` `\` are the Plan View's scope keys, meaning the same here — previous / next period, and up
 * one rung. The arrows walk the cells as the grid draws them; **Space** picks the highlighted cell,
 * exactly as a click does (in a range picker, a second pick closes the range and a third starts a
 * new one); **Enter** steps *into* it, as a double-click does. Applying is therefore its own chord,
 * `Ctrl+Enter`, beside the Apply button.
 */
export const SCOPE_PICKER_KEYS: readonly ScopePickerKey[] = [
  { action: "moveLeft", chord: { code: "ArrowLeft" }, labelKey: "pickerMove" },
  { action: "moveRight", chord: { code: "ArrowRight" }, labelKey: "pickerMove" },
  { action: "moveUp", chord: { code: "ArrowUp" }, labelKey: "pickerMove" },
  { action: "moveDown", chord: { code: "ArrowDown" }, labelKey: "pickerMove" },
  { action: "previousPeriod", chord: { code: "BracketLeft" }, labelKey: "pickerStepPeriod" },
  { action: "nextPeriod", chord: { code: "BracketRight" }, labelKey: "pickerStepPeriod" },
  { action: "up", chord: { code: "Backslash" }, labelKey: "pickerUp" },
  { action: "pick", chord: { code: "Space" }, labelKey: "pickerPick" },
  { action: "enter", chord: { code: "Enter" }, labelKey: "pickerEnter" },
  { action: "apply", chord: { code: "Enter", ctrl: true }, labelKey: "pickerApply" },
  // Listed, not dispatched: Escape belongs to whatever holds the picker — the quick picker closes,
  // an editor closes itself — so the picker lets it pass.
  { action: "close", chord: { code: "Escape" }, labelKey: "pickerClose" },
];

/** The `data-owns-keys` list the picker claims beyond the control keys the dispatcher already cedes. */
export const SCOPE_PICKER_OWNED_CODES = "BracketLeft BracketRight Backslash Ctrl+Enter";

/** The action a keydown names, or `null` when it is not one of the picker's keys. */
export function scopePickerAction(event: KeyboardEvent): ScopePickerAction | null {
  return SCOPE_PICKER_KEYS.find((key) => matchesChord(event, key.chord))?.action ?? null;
}

/** How many cells a row of the picker's grid holds — its stylesheet draws four columns. */
export const SCOPE_GRID_COLUMNS = 4;

/**
 * The cell an arrow moves the highlight to, in a grid of `count` cells drawn `SCOPE_GRID_COLUMNS`
 * wide. It stops at the edges rather than wrapping: `[` and `]` are what leave the period.
 */
export function movedIndex(index: number, action: ScopePickerAction, count: number): number {
  const last = count - 1;
  switch (action) {
    case "moveLeft": return Math.max(0, index - 1);
    case "moveRight": return Math.min(last, index + 1);
    case "moveUp": return index - SCOPE_GRID_COLUMNS >= 0 ? index - SCOPE_GRID_COLUMNS : index;
    case "moveDown": return index + SCOPE_GRID_COLUMNS <= last ? index + SCOPE_GRID_COLUMNS : index;
    default: return index;
  }
}
