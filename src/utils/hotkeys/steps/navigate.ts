import type { Binding } from "@/utils/hotkeys/chord";
import type { StepDirection } from "@/utils/steps-grid";
import type { StepsSelectionContext } from "./selection";

/** What moving around a Step's grid acts on. */
export interface StepsNavigateContext extends StepsSelectionContext {
  onNavigate: (direction: StepDirection) => void;
}

/**
 * All four arrows move the selection within one grid — the header card and the children are cells
 * of the same one, so arrowing up from the top row lands on the thing you are standing on.
 *
 * **Depth is not on an axis.** `→` never means "descend": descending is `Enter`, climbing is
 * `Shift+Escape`, and moving between pages is `PageUp`/`PageDown`. Three movements, three
 * gestures, none of them an arrow key — which is what stops a wide Step from reading as a deep one.
 */
const DIRECTIONS: ReadonlyArray<{ code: string; direction: StepDirection }> = [
  { code: "ArrowUp", direction: "up" },
  { code: "ArrowDown", direction: "down" },
  { code: "ArrowLeft", direction: "left" },
  { code: "ArrowRight", direction: "right" },
];

export const STEPS_NAVIGATE_BINDINGS: readonly Binding<StepsNavigateContext>[] =
  DIRECTIONS.map(({ code, direction }) => ({
    id: `stepsView.navigate.${code}`,
    section: "stepsView" as const,
    chord: { code },
    labelKey: "navigate" as const,
    run: (c: StepsNavigateContext) => c.onNavigate(direction),
  }));
