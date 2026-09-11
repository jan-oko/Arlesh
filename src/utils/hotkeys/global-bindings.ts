import type { Binding } from "./chord";

/** What the app-level bindings act on. */
export interface GlobalContext {
  onToggleView: () => void;
  onToggleHotkeys: () => void;
}

/** Bindings that apply everywhere, regardless of which view is showing. */
export const GLOBAL_BINDINGS: readonly Binding<GlobalContext>[] = [
  {
    id: "global.toggleView",
    section: "global",
    chord: { code: "KeyL", alt: true },
    labelKey: "toggleView",
    run: (c) => c.onToggleView(),
  },
  {
    id: "global.toggleHotkeys",
    section: "global",
    chord: { code: "Slash", ctrl: true, shift: true },
    labelKey: "toggleHotkeys",
    run: (c) => c.onToggleHotkeys(),
  },
];
