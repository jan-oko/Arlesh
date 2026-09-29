import type { Binding } from "@/utils/hotkeys/chord";
import type { MindmapSelectionContext } from "./selection";
import { hasSelection } from "./selection";

/** What the quick dependency picker acts on. */
export interface MindmapDependencyContext extends MindmapSelectionContext {
  /** Opens the dependency picker on the selection, the lead first; more than one is refused. */
  onQuickDependency: (ids: readonly string[]) => void;
}

/** The lead first, then the rest of the selection in the order it was made. */
function leadFirst(c: MindmapSelectionContext): string[] {
  const lead = c.selectedNodeId;
  if (lead === null) return [];
  return [lead, ...[...c.selectedNodeIds].filter((id) => id !== lead)];
}

export const MINDMAP_DEPENDENCY_BINDINGS: readonly Binding<MindmapDependencyContext>[] = [
  {
    // D for **Depends on**, bare, beside `P` and the other bare letters that act on the selected
    // Task. Shift+D creates a Domain and Alt+D is the Do preset; strict chord matching keeps the
    // three apart. It fires on any selection and the handler refuses what cannot hold a dependency
    // by name — and a multi-selection, which it asks to narrow — since an inert key reads as broken.
    id: "mindmap.quickDependency", section: "mindmap", chord: { code: "KeyD" },
    labelKey: "quickDependency",
    allowRepeat: false,
    when: hasSelection,
    run: (c) => c.onQuickDependency(leadFirst(c)),
  },
];
