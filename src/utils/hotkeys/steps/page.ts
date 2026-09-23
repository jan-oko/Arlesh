import type { Binding } from "@/utils/hotkeys/chord";

/** What moving between a Step's pages acts on. */
export interface StepsPageContext {
  onStepPage: (direction: 1 | -1) => void;
}

/**
 * A wide Step **paginates** rather than scrolling, and turning a page is its own gesture.
 *
 * `PageUp` / `PageDown`, which mean exactly this everywhere else and collide with nothing here.
 * Deliberately not an arrow — an arrow that sometimes moved the cursor and sometimes replaced every
 * card on screen would be the one movement in this view you could not predict — and deliberately
 * not `Enter` or `Escape`, which are the two ways depth changes. The staircase has landings, and
 * walking along one is not the same as taking a step.
 */
export const STEPS_PAGE_BINDINGS: readonly Binding<StepsPageContext>[] = [
  {
    id: "stepsView.pagePrevious", section: "stepsView", chord: { code: "PageUp" },
    labelKey: "stepsPage", run: (c) => c.onStepPage(-1),
  },
  {
    id: "stepsView.pageNext", section: "stepsView", chord: { code: "PageDown" },
    labelKey: "stepsPage", run: (c) => c.onStepPage(1),
  },
];
