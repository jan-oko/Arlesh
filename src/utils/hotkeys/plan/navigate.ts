import type { Binding } from "@/utils/hotkeys/chord";
import type { PlanPane, PlanSelectionContext } from "./selection";

/** What moving around the two panes acts on. */
export interface PlanNavigateContext extends PlanSelectionContext {
  /** Moves the cursor. `extend` grows the selection from its anchor instead of replacing it. */
  onNavigate: (direction: 1 | -1, extend: boolean) => void;
  onFocusPane: (pane: PlanPane) => void;
}

/**
 * Up and down walk the focused pane; left and right cross between them.
 *
 * The axes are the layout's own: the panes sit side by side and their rows stack, so the arrow that
 * points at a pane focuses it and the arrow that points along a pane walks it. Moving a task across
 * is deliberately **not** on the horizontal arrows — a write and a cursor move must not share a
 * gesture — and lives on `Enter` instead.
 *
 * **Shifted, the vertical pair extends the selection** from its anchor, which is the keyboard's
 * half of multi-select and reads the same way it does in every list anyone has used. The horizontal
 * pair is deliberately not shifted: a selection belongs to one pane, so a range across both would
 * have to mean something, and there is nothing it could sensibly mean.
 */
export const PLAN_NAVIGATE_BINDINGS: readonly Binding<PlanNavigateContext>[] = [
  {
    id: "planView.navigateUp", section: "planView", chord: { code: "ArrowUp" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(-1, false),
  },
  {
    id: "planView.navigateDown", section: "planView", chord: { code: "ArrowDown" },
    labelKey: "navigateRows", run: (c) => c.onNavigate(1, false),
  },
  {
    id: "planView.extendUp", section: "planView", chord: { code: "ArrowUp", shift: true },
    labelKey: "planExtendSelection", run: (c) => c.onNavigate(-1, true),
  },
  {
    id: "planView.extendDown", section: "planView", chord: { code: "ArrowDown", shift: true },
    labelKey: "planExtendSelection", hidden: true, run: (c) => c.onNavigate(1, true),
  },
  {
    id: "planView.focusCandidates", section: "planView", chord: { code: "ArrowLeft" },
    labelKey: "planSwitchPane", run: (c) => c.onFocusPane("candidates"),
  },
  {
    id: "planView.focusPlanned", section: "planView", chord: { code: "ArrowRight" },
    labelKey: "planSwitchPane", run: (c) => c.onFocusPane("planned"),
  },
];
