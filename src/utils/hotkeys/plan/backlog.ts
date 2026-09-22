import type { Binding } from "@/utils/hotkeys/chord";

/** What the backlogged-candidates switch acts on. */
export interface PlanBacklogContext {
  onToggleBacklogCandidates: () => void;
}

/**
 * `Shift+B` shows the work that was set aside, or hides it again.
 *
 * Shifted deliberately: bare `B` backlogs the selected Task in the List View, and a key that sets a
 * task aside in one view must not reveal a whole category of them in another.
 */
export const PLAN_BACKLOG_BINDINGS: readonly Binding<PlanBacklogContext>[] = [
  {
    id: "planView.toggleBacklogCandidates", section: "planView", chord: { code: "KeyB", shift: true },
    labelKey: "planToggleBacklog", allowRepeat: false, run: (c) => c.onToggleBacklogCandidates(),
  },
];
