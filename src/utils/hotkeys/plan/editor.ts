import type { Binding } from "@/utils/hotkeys/chord";
import type { PlanSelectionContext } from "./selection";

/** What opening the editor acts on. */
export interface PlanEditorContext extends PlanSelectionContext {
  onOpenEditor: (id: string) => void;
}

export const PLAN_EDITOR_BINDINGS: readonly Binding<PlanEditorContext>[] = [
  {
    id: "planView.openEditor", section: "planView", chord: { code: "KeyE" },
    labelKey: "openEditor",
    when: (c) => c.selectedTaskId !== null,
    run: (c) => { if (c.selectedTaskId !== null) c.onOpenEditor(c.selectedTaskId); },
  },
];
