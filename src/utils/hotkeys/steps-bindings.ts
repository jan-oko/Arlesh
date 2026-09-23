import type { Binding } from "./chord";
import type { StepsSelectionContext, StepsTarget } from "./steps/selection";
import { STEPS_CREATE_BINDINGS, type StepsCreateContext } from "./steps/create";
import { STEPS_DELETE_BINDINGS, type StepsDeleteContext } from "./steps/delete";
import { STEPS_DESCEND_BINDINGS, type StepsDescendContext } from "./steps/descend";
import { STEPS_DESELECT_BINDINGS, type StepsDeselectContext } from "./steps/deselect";
import { STEPS_EDITOR_BINDINGS, type StepsEditorContext } from "./steps/editor";
import { STEPS_EXPECTATION_BINDINGS, type StepsExpectationContext } from "./steps/expectation";
import { STEPS_FLAGS_BINDINGS, type StepsFlagsContext } from "./steps/flags";
import { STEPS_FULLSCREEN_BINDINGS, type StepsFullscreenContext } from "./steps/fullscreen";
import { STEPS_HISTORY_BINDINGS, type StepsHistoryContext } from "./steps/history";
import { STEPS_NAVIGATE_BINDINGS, type StepsNavigateContext } from "./steps/navigate";
import { STEPS_PAGE_BINDINGS, type StepsPageContext } from "./steps/page";
import { STEPS_STATUS_BINDINGS, type StepsStatusContext } from "./steps/status";
import { STEPS_STATUS_PRESET_BINDINGS, type StepsStatusPresetContext } from "./steps/status-presets";
import { STEPS_ZOOM_BINDINGS, type StepsZoomContext } from "./steps/zoom";

export type { StepsSelectionContext, StepsTarget };

/**
 * What the Steps View bindings act on — the hook's options minus its gating flag.
 *
 * Assembled from one module per feature, exactly as the other three views' tables are (ADR 0003's
 * 2026-09-20 amendment): adding a keyboard action means a new module and one line in each list
 * below, not an edit inside an interface every other feature in flight is also editing.
 */
export interface StepsContext extends
  StepsCreateContext,
  StepsDeleteContext,
  StepsDescendContext,
  StepsDeselectContext,
  StepsEditorContext,
  StepsExpectationContext,
  StepsFlagsContext,
  StepsFullscreenContext,
  StepsHistoryContext,
  StepsNavigateContext,
  StepsPageContext,
  StepsStatusContext,
  StepsStatusPresetContext,
  StepsZoomContext {}

/**
 * The Steps View's bindings — the ones that are genuinely its own.
 *
 * The subtree exits, the node search and the filter menu are **absent on purpose**: they act on the
 * tab rather than on this view, they are declared once in `global-bindings.ts`, and a chord left in
 * both tables would fire twice, since the two are separate capture-phase listeners. That is
 * especially load-bearing here — `Shift+Escape` is how you climb out of a Step, and this view would
 * be the obvious place to declare it.
 *
 * Order is only significant between entries sharing a chord, and nothing here shares one.
 * `chord-sharing.test.ts` fails on any chord that becomes shared without being declared.
 */
export const STEPS_BINDINGS: readonly Binding<StepsContext>[] = [
  ...STEPS_FULLSCREEN_BINDINGS,
  ...STEPS_STATUS_PRESET_BINDINGS,
  ...STEPS_NAVIGATE_BINDINGS,
  ...STEPS_DESCEND_BINDINGS,
  ...STEPS_PAGE_BINDINGS,
  ...STEPS_ZOOM_BINDINGS,
  ...STEPS_STATUS_BINDINGS,
  ...STEPS_FLAGS_BINDINGS,
  ...STEPS_EXPECTATION_BINDINGS,
  ...STEPS_EDITOR_BINDINGS,
  ...STEPS_CREATE_BINDINGS,
  ...STEPS_DELETE_BINDINGS,
  ...STEPS_DESELECT_BINDINGS,
  ...STEPS_HISTORY_BINDINGS,
];
