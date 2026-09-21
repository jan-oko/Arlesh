import type { Binding } from "@/utils/hotkeys/chord";

/** What the row-to-row movement acts on. */
export interface ListNavigateContext {
  onNavigate: (direction: 1 | -1) => void;
}

export const LIST_NAVIGATE_BINDINGS: readonly Binding<ListNavigateContext>[] = [
  {
    id: "listView.navigateUp", section: "listView", chord: { code: "ArrowUp" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(-1),
  },
  {
    id: "listView.navigateDown", section: "listView", chord: { code: "ArrowDown" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(1),
  },
];
