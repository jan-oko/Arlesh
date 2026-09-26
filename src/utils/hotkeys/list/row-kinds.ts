import type { Binding, Chord, HotkeyLabelKey } from "@/utils/hotkeys/chord";
import { LIST_ROW_KINDS, type ListRowKind } from "@/utils/list-filter";

/** What the row-kind toggles act on. */
export interface ListRowKindsContext {
  /** Shows or hides one row kind — or, when that is refused, says why. */
  onToggleRowKind: (kind: ListRowKind) => void;
}

/**
 * `Shift+Alt+letter` (the cheat-sheet's spelling of Alt+Shift) — show or hide one row kind, by its initial.
 *
 * The same family as the `Alt+letter` presets, one modifier over: the presets choose *which state*
 * of row the list shows, these choose *which kind*, and both are the List View's filter keys. Shift
 * reads as "the other axis" rather than a new scheme, and every Alt+Shift chord was free. `E` also
 * sits beside `Alt+E`, the Expectations option — the one that shows that kind and nothing else.
 *
 * Declared here as well as bound, so the filter popover's toggles name the very chord that fires.
 */
export const ROW_KIND_CHORDS: Readonly<Record<ListRowKind, Chord>> = {
  task: { code: "KeyT", alt: true, shift: true },
  commitment: { code: "KeyC", alt: true, shift: true },
  expectation: { code: "KeyE", alt: true, shift: true },
};

const LABEL_KEYS: Readonly<Record<ListRowKind, HotkeyLabelKey>> = {
  task: "toggleKindTasks",
  commitment: "toggleKindCommitments",
  expectation: "toggleKindExpectations",
};

export const LIST_ROW_KINDS_BINDINGS: readonly Binding<ListRowKindsContext>[] =
  LIST_ROW_KINDS.map((kind) => ({
    id: `listView.kind.${kind}`,
    section: "listView" as const,
    chord: ROW_KIND_CHORDS[kind],
    labelKey: LABEL_KEYS[kind],
    allowRepeat: false,
    run: (c: ListRowKindsContext) => c.onToggleRowKind(kind),
  }));
