import type { Binding } from "@/utils/hotkeys/chord";

/** Which end of the list a jump lands on. */
export type ListEdge = "first" | "last";

/** What jumping to either end of the list acts on. */
export interface ListJumpContext {
  /** Selects the first or last row the list draws and scrolls the list to that end. */
  onJumpToEdge: (edge: ListEdge) => void;
}

// The document-editor chords for "top" and "bottom". The webview would otherwise scroll the page on
// them itself; the dispatcher's `preventDefault` keeps that from doubling the list's own scroll.
export const LIST_JUMP_BINDINGS: readonly Binding<ListJumpContext>[] = [
  {
    id: "listView.jumpToFirst", section: "listView", chord: { code: "Home", ctrl: true },
    labelKey: "jumpToFirstRow", run: (c) => c.onJumpToEdge("first"),
  },
  {
    id: "listView.jumpToLast", section: "listView", chord: { code: "End", ctrl: true },
    labelKey: "jumpToLastRow", run: (c) => c.onJumpToEdge("last"),
  },
];
