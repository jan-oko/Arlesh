import type { Binding } from "./chord";
import type { PlanPane, PlanSelectionContext } from "./plan/selection";
import { PLAN_BACKLOG_BINDINGS, type PlanBacklogContext } from "./plan/backlog";
import { PLAN_DESELECT_BINDINGS, type PlanDeselectContext } from "./plan/deselect";
import { PLAN_EDITOR_BINDINGS, type PlanEditorContext } from "./plan/editor";
import { PLAN_FILTER_BINDINGS, type PlanFilterContext } from "./plan/filter";
import { PLAN_FULLSCREEN_BINDINGS, type PlanFullscreenContext } from "./plan/fullscreen";
import { PLAN_HISTORY_BINDINGS, type PlanHistoryContext } from "./plan/history";
import { PLAN_MOVE_BINDINGS, type PlanMoveContext } from "./plan/move";
import { PLAN_NAVIGATE_BINDINGS, type PlanNavigateContext } from "./plan/navigate";
import { PLAN_SCOPE_BINDINGS, type PlanScopeContext } from "./plan/scope";
import { PLAN_STATUS_PRESET_BINDINGS, type PlanStatusPresetContext } from "./plan/status-presets";
import { PLAN_SUBTREE_BINDINGS, type PlanSubtreeContext } from "./plan/subtree";

export type { PlanPane, PlanSelectionContext };

/**
 * What the Plan View bindings act on — the hook's options minus its gating flag.
 *
 * Assembled from one module per feature, exactly as the other two views' tables are (ADR 0003's
 * 2026-09-20 amendment): adding a keyboard action means a new module and one line in each list
 * below, not an edit inside an interface every other feature in flight is also editing.
 */
export interface PlanContext extends
  PlanBacklogContext,
  PlanDeselectContext,
  PlanEditorContext,
  PlanFilterContext,
  PlanFullscreenContext,
  PlanHistoryContext,
  PlanMoveContext,
  PlanNavigateContext,
  PlanScopeContext,
  PlanStatusPresetContext,
  PlanSubtreeContext {}

/**
 * The Plan View's bindings.
 *
 * Order is only significant between entries sharing a chord, and nothing here shares one: the two
 * `Escape` variants carry different modifiers, which chord matching treats as different chords
 * altogether. `chord-sharing.test.ts` fails on any chord that becomes shared without being
 * declared, so a second module quietly shadowing one of these is a red test rather than a key that
 * silently stops working.
 */
export const PLAN_BINDINGS: readonly Binding<PlanContext>[] = [
  ...PLAN_FILTER_BINDINGS,
  ...PLAN_FULLSCREEN_BINDINGS,
  ...PLAN_STATUS_PRESET_BINDINGS,
  ...PLAN_NAVIGATE_BINDINGS,
  ...PLAN_SCOPE_BINDINGS,
  ...PLAN_MOVE_BINDINGS,
  ...PLAN_BACKLOG_BINDINGS,
  ...PLAN_EDITOR_BINDINGS,
  ...PLAN_SUBTREE_BINDINGS,
  ...PLAN_DESELECT_BINDINGS,
  ...PLAN_HISTORY_BINDINGS,
];
