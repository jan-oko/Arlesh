import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the two flags on a Task act on. */
export interface ListFlagsContext extends ListSelectionContext {
  /** Puts the selected Task in the backlog, or takes it out. */
  onToggleBacklog: (id: string) => void;
  /** Flips the selected Task between Agentic and Not agentic, whichever it currently reads as. */
  onToggleAgentic: (id: string) => void;
}

export const LIST_FLAGS_BINDINGS: readonly Binding<ListFlagsContext>[] = [
  {
    id: "listView.toggleBacklog", section: "listView", chord: { code: "KeyB" },
    labelKey: "toggleBacklog",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onToggleBacklog(c.selectedTaskId); },
  },
  {
    // Bare A beside bare B, matching the Mindmap: a flag on the selected Task is a bare letter,
    // Alt+letter is a status preset, and strict chord matching keeps A and Alt+A apart.
    // Habit instances are turned away in the hook, exactly as Backlog turns them away.
    id: "listView.toggleAgentic", section: "listView", chord: { code: "KeyA" },
    labelKey: "toggleAgentic",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onToggleAgentic(c.selectedTaskId); },
  },
];
