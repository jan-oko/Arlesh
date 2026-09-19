import type en_hotkeys from "@/i18n/locales/en/hotkeys.json";

/** Which surface a binding belongs to — also the cheat-sheet's grouping. */
export type Section = "global" | "tabs" | "mindmap" | "listView";

/**
 * A key of the `hotkeys` namespace. Typing it from the English locale means a binding referencing a
 * label that doesn't exist is a compile error, not something the cheat-sheet renders as a raw key.
 */
export type HotkeyLabelKey = keyof typeof en_hotkeys;

/**
 * A physical-key chord. Matching is strict: a modifier left unspecified must be ABSENT for the
 * chord to match, so `Ctrl+Shift+/` never fires a binding declared as `Ctrl+/`.
 */
export interface Chord {
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** The half of a binding the cheat-sheet needs — free of any context type, so it can list them all. */
export interface BindingMeta {
  id: string;
  section: Section;
  chord: Chord;
  /** Key within the `hotkeys` i18n namespace. */
  labelKey: HotkeyLabelKey;
  /**
   * Dispatchable but not listed on the sheet, for entries that duplicate a listed row:
   * the numpad zoom aliases, and the Shift+Arrow navigate/pan fall-throughs.
   */
  hidden?: boolean;
}

/** A binding plus the behaviour it dispatches, in some context `Ctx`. */
export interface Binding<Ctx> extends BindingMeta {
  when?: (ctx: Ctx) => boolean;
  run: (ctx: Ctx) => void;
  /** Defaults to true. Set false for actions that must not fire on key auto-repeat. */
  allowRepeat?: boolean;
}

export function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  return event.code === chord.code &&
    event.ctrlKey === (chord.ctrl ?? false) &&
    event.shiftKey === (chord.shift ?? false) &&
    event.altKey === (chord.alt ?? false) &&
    event.metaKey === (chord.meta ?? false);
}

/** Display names for codes whose readable form isn't derivable by trimming a prefix. */
const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Slash: "/",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
};

function keyLabel(code: string): string {
  if (Object.prototype.hasOwnProperty.call(KEY_LABELS, code)) {
    const label = KEY_LABELS[code];
    if (label !== undefined) return label;
  }
  // "KeyE" → "E", "Digit1" → "1"; anything else (Enter, Tab, Delete, F2) reads fine as-is.
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

/** Renders a chord for display, e.g. `{ code: "Slash", ctrl: true, shift: true }` → "Ctrl+Shift+/". */
export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl === true) parts.push("Ctrl");
  if (chord.shift === true) parts.push("Shift");
  if (chord.alt === true) parts.push("Alt");
  if (chord.meta === true) parts.push("Meta");
  parts.push(keyLabel(chord.code));
  return parts.join("+");
}
