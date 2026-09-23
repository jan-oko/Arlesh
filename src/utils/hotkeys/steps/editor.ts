import type { Binding } from "@/utils/hotkeys/chord";
import type { StepsSelectionContext } from "./selection";
import { hasSelection, withNode } from "./selection";

/** What opening the editor acts on. */
export interface StepsEditorContext extends StepsSelectionContext {
  onOpenEditor: (id: string) => void;
}

/**
 * `E` opens the selected card's real editor.
 *
 * Cards are **read-only**: inspecting and descending are different gestures, and editing in a card
 * would be a second editing surface with a different field set from the one every other view sends
 * you to. `E` is that one surface, reached from here exactly as it is reached from the Mindmap.
 */
export const STEPS_EDITOR_BINDINGS: readonly Binding<StepsEditorContext>[] = [
  {
    id: "stepsView.openEditor", section: "stepsView", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: (c) => hasSelection(c),
    run: (c) => withNode(c, c.onOpenEditor),
  },
];
