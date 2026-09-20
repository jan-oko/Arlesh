import type { Binding } from "@/utils/hotkeys/chord";

/** What the filter menu binding acts on. */
export interface ListFilterContext {
  onToggleFilter: () => void;
}

export const LIST_FILTER_BINDINGS: readonly Binding<ListFilterContext>[] = [
  {
    id: "listView.toggleFilter", section: "listView", chord: { code: "KeyF", alt: true },
    labelKey: "toggleFilter", run: (c) => c.onToggleFilter(),
  },
];
