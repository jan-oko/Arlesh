import { create } from "zustand";

export const CLIPBOARD_OP = {
  CUT: "cut",
  COPY: "copy",
} as const;

export type ClipboardOperation = "cut" | "copy";

export interface Clipboard {
  operation: ClipboardOperation;
  nodeIds: string[];
}

interface ClipboardStore {
  clipboard: Clipboard | null;
  setClipboard: (clipboard: Clipboard | null) => void;
}

/**
 * The cut/copy buffer — **app-wide**, not per tab.
 *
 * Almost everything about a view belongs to the tab showing it, but a clipboard does not: copying
 * a subtree in one tab and pasting it somewhere else is exactly why a second tab is open. Nothing
 * about a clipboard is specific to where it was filled, so it is one buffer for the whole app.
 *
 * Ephemeral — a pending cut is not worth restoring across a restart, and the nodes it names may
 * not survive one.
 */
export const useClipboardStore = create<ClipboardStore>()((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
}));
