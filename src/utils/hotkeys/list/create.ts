import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What creating a row acts on. */
export interface ListCreateContext extends ListSelectionContext {
  /** Creates a sibling of the selected Task — the Mindmap's Shift+Enter, flattened. */
  onCreateSibling: (id: string) => void;
  /** Creates a child of the selected Task — the Mindmap's Tab, flattened. */
  onCreateChild: (id: string) => void;
}

// Creation, on the Mindmap's two chords. They mean something in a flat list only because the
// list is nested, and both read the parent off the selection — so both need a *Task* selected: a
// Commitment is not one (List View creates Tasks and nothing else), and with nothing selected
// there is no parent at all, which is what the path header's `+` is for. Neither shadows an
// existing binding: chord matching is strict, so Shift+Enter never reaches the bare-Enter
// entries, and nothing else here claims Tab.
//
// `allowRepeat: false` because a held key would post a row per repeat, faster than the reload
// that puts the first one on screen — you would look up from one rename to find a column of
// blank tasks behind it.
export const LIST_CREATE_BINDINGS: readonly Binding<ListCreateContext>[] = [
  {
    id: "listView.createChild", section: "listView", chord: { code: "Tab" },
    labelKey: "createChildRow", allowRepeat: false,
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onCreateChild(c.selectedTaskId); },
  },
  {
    id: "listView.createSibling", section: "listView", chord: { code: "Enter", shift: true },
    labelKey: "createSiblingRow", allowRepeat: false,
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onCreateSibling(c.selectedTaskId); },
  },
];
