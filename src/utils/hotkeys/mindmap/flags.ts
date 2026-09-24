import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { selectedNode } from "./selection";

/** What the flags on a Task act on. */
export interface MindmapFlagsContext extends MindmapSelectionContext {
  /** Puts the anchor Task in the backlog, or takes it out. Acts on the anchor, never the whole
   * multi-selection — setting work aside is a judgement about one thing at a time. */
  onToggleBacklog: (id: string) => void;
  /** Flips the anchor Task between Agentic and Not agentic, whichever it currently reads as. The
   * anchor only, for the same reason Backlog acts on one node. */
  onToggleAgentic: (id: string) => void;
  /** Flips the anchor Task's Asynchronous flag: whether doing it starts a wait. The anchor only,
   * for the same reason the other two act on one node. */
  onToggleAsynchronous: (id: string) => void;
}

/** A Task row — stored or a Habit occurrence — since these flags are columns on a task row. */
function isFlaggableTask(c: MindmapSelectionContext): boolean {
  const node = selectedNode(c);
  return node !== undefined && node.kind === "task" && node.virtual !== true;
}

export const MINDMAP_FLAGS_BINDINGS: readonly Binding<MindmapFlagsContext>[] = [
  {
    // Only a Task row has a backlog column — a Habit occurrence included. A drawn node (a wait's
    // check task) has no row to set aside, so it is excluded rather than silently no-oping.
    id: "mindmap.toggleBacklog", section: "mindmap", chord: { code: "KeyB" },
    labelKey: "toggleBacklog",
    when: isFlaggableTask,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleBacklog(c.selectedNodeId); },
  },
  {
    // Bare A, beside bare B for Backlog: a flag on the selected Task is a bare letter here, where
    // Alt+letter is a status preset. Alt+A staying "All" is not a collision — chord matching is
    // strict about modifiers, exactly as it already is for B and Alt+B.
    //
    // Excluded for the same reason Backlog is: a drawn node has no task row to flag.
    id: "mindmap.toggleAgentic", section: "mindmap", chord: { code: "KeyA" },
    labelKey: "toggleAgentic",
    when: isFlaggableTask,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleAgentic(c.selectedNodeId); },
  },
  {
    // W for **wait**, the thing an asynchronous Task starts. Bare, beside A and B, on the same
    // rule: a flag on the selected Task is a bare letter, Alt+letter is a status preset. Nothing
    // else binds W in either section.
    //
    // Excluded for the same reason the other two are: a drawn node has no task row to flag.
    id: "mindmap.toggleAsynchronous", section: "mindmap", chord: { code: "KeyW" },
    labelKey: "toggleAsynchronous",
    when: isFlaggableTask,
    run: (c) => { if (c.selectedNodeId !== null) c.onToggleAsynchronous(c.selectedNodeId); },
  },
];
