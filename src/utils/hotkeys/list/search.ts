import type { Binding } from "@/utils/hotkeys/chord";

/** What the node search acts on. */
export interface ListSearchContext {
  /** Opens the node search; picking a result enters that node's subtree. */
  onOpenSearch: () => void;
}

export const LIST_SEARCH_BINDINGS: readonly Binding<ListSearchContext>[] = [
  {
    id: "listView.openSearch", section: "listView", chord: { code: "KeyO", ctrl: true },
    labelKey: "enterBySearch", run: (c) => c.onOpenSearch(),
  },
];
