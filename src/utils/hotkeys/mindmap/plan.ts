import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What the quick Plan picker acts on. */
export interface MindmapPlanContext extends MindmapSelectionContext {
  /** Opens the Plan picker at the lead on every selected node, the lead first. */
  onQuickPlan: (ids: readonly string[]) => void;
}

/** The lead first, then the rest of the selection in the order it was made. */
function leadFirst(c: MindmapSelectionContext): string[] {
  const lead = c.selectedNodeId;
  if (lead === null) return [];
  return [lead, ...[...c.selectedNodeIds].filter((id) => id !== lead)];
}

export const MINDMAP_PLAN_BINDINGS: readonly Binding<MindmapPlanContext>[] = [
  {
    // P for **Plan**, bare, beside the other bare letters that act on the selected Task. Shift+P
    // creates a Project, Alt+P is the Plan status preset and Ctrl+P the Plan View; strict chord
    // matching keeps all four apart. It fires on any selection and the handler refuses a node that
    // holds no Plan by name, since an inert key reads as broken. A multi-selection is planned
    // whole, as one Gesture.
    id: "mindmap.quickPlan", section: "mindmap", chord: { code: "KeyP" },
    labelKey: "quickPlan",
    allowRepeat: false,
    when: hasSelection,
    run: (c) => c.onQuickPlan(leadFirst(c)),
  },
];
