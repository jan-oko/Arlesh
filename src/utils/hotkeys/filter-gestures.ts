import type { Chord, HotkeyLabelKey } from "./chord";

/**
 * One cheat-sheet row for the filter gestures: the keys, and the mouse form where there is one.
 * These are not bindings — the Filter menu, the `Ctrl+F` search and the chips read them off the
 * key or click that adds or changes a value — so they are listed here rather than dispatched.
 */
export interface FilterGesture {
  labelKey: HotkeyLabelKey;
  chords: readonly Chord[];
  /** The label of the click that does the same, or `null` when there is none. */
  clickKey: HotkeyLabelKey | null;
}

/** How a filter value is added, and how an added one is changed or removed. */
export const FILTER_GESTURES: readonly FilterGesture[] = [
  { labelKey: "filterAddAll", chords: [{ code: "Enter" }], clickKey: "filterClick" },
  { labelKey: "filterAddAny", chords: [{ code: "Enter", shift: true }], clickKey: "filterShiftClick" },
  { labelKey: "filterAddNot", chords: [{ code: "Enter", alt: true }], clickKey: "filterAltClick" },
  { labelKey: "filterCycle", chords: [], clickKey: "filterClick" },
  { labelKey: "filterRemove", chords: [{ code: "Delete" }, { code: "Backspace" }], clickKey: null },
  { labelKey: "filterRemoveSearch", chords: [{ code: "Delete" }], clickKey: null },
  { labelKey: "filterKindKeys", chords: [{ code: "KeyT" }, { code: "KeyC" }, { code: "KeyE" }], clickKey: null },
  { labelKey: "filterFlagKeys", chords: [{ code: "KeyA" }, { code: "KeyW" }, { code: "KeyB" }, { code: "KeyP" }], clickKey: null },
  { labelKey: "filterPrivateMode", chords: [{ code: "KeyP", ctrl: true }], clickKey: null },
];
