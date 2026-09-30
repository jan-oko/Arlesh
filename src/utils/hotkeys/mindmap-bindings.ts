import { inGroup, type Binding } from "./chord";
import type { MindmapSelectionContext } from "./mindmap/selection";
import { MINDMAP_CENTER_BINDINGS, type MindmapCenterContext } from "./mindmap/center";
import { MINDMAP_CLIPBOARD_BINDINGS, type MindmapClipboardContext } from "./mindmap/clipboard";
import { MINDMAP_COLLAPSE_BINDINGS, type MindmapCollapseContext } from "./mindmap/collapse";
import { MINDMAP_COMMITMENT_BINDINGS, type MindmapCommitmentContext } from "./mindmap/commitment";
import { MINDMAP_CONVERT_TO_FLOW_BINDINGS, type MindmapConvertToFlowContext } from "./mindmap/convert-to-flow";
import { MINDMAP_CREATE_BINDINGS, type MindmapCreateContext } from "./mindmap/create";
import { MINDMAP_DELETE_BINDINGS, type MindmapDeleteContext } from "./mindmap/delete";
import { MINDMAP_DESELECT_BINDINGS, type MindmapDeselectContext } from "./mindmap/deselect";
import { MINDMAP_EDITOR_BINDINGS, type MindmapEditorContext } from "./mindmap/editor";
import { MINDMAP_ENTER_BINDINGS, type MindmapEnterContext } from "./mindmap/enter";
import { MINDMAP_EXPECTATION_BINDINGS, type MindmapExpectationContext } from "./mindmap/expectation";
import { MINDMAP_FLAGS_BINDINGS, type MindmapFlagsContext } from "./mindmap/flags";
import { MINDMAP_FULLSCREEN_BINDINGS, type MindmapFullscreenContext } from "./mindmap/fullscreen";
import { MINDMAP_HISTORY_BINDINGS, type MindmapHistoryContext } from "./mindmap/history";
import { MINDMAP_NAVIGATE_BINDINGS, type MindmapNavigateContext } from "./mindmap/navigate";
import { MINDMAP_DEPENDENCY_BINDINGS, type MindmapDependencyContext } from "./mindmap/dependency";
import { MINDMAP_PLAN_BINDINGS, type MindmapPlanContext } from "./mindmap/plan";
import { MINDMAP_RENAME_BINDINGS, type MindmapRenameContext } from "./mindmap/rename";
import { MINDMAP_REORDER_BINDINGS, type MindmapReorderContext } from "./mindmap/reorder";
import { MINDMAP_START_FLOW_BINDINGS, type MindmapStartFlowContext } from "./mindmap/start-flow";
import { MINDMAP_STATUS_PRESET_BINDINGS, type MindmapStatusPresetContext } from "./mindmap/status-presets";
import { MINDMAP_ZOOM_BINDINGS, type MindmapZoomContext } from "./mindmap/zoom";

export type { MindmapSelectionContext };
export type { ArrowKey } from "./mindmap/navigate";
export type { ClipboardEntry } from "./mindmap/clipboard";
export { DOUBLE_TAP_MS } from "./mindmap/enter";

/**
 * What the Mindmap bindings act on — the hook's options minus its gating flags, plus Enter state.
 *
 * Each feature module in `mindmap/` declares the slice its own bindings read, and this is all of
 * them at once. Adding a keyboard action means a new module and one line in each list below; it
 * does not mean editing a member some other in-flight feature is also editing.
 */
export interface MindmapContext extends
  MindmapCenterContext,
  MindmapClipboardContext,
  MindmapCollapseContext,
  MindmapCommitmentContext,
  MindmapConvertToFlowContext,
  MindmapCreateContext,
  MindmapDeleteContext,
  MindmapDeselectContext,
  MindmapEditorContext,
  MindmapEnterContext,
  MindmapExpectationContext,
  MindmapFlagsContext,
  MindmapFullscreenContext,
  MindmapHistoryContext,
  MindmapNavigateContext,
  MindmapPlanContext,
  MindmapDependencyContext,
  MindmapRenameContext,
  MindmapReorderContext,
  MindmapStartFlowContext,
  MindmapStatusPresetContext,
  MindmapZoomContext {}

/**
 * The Mindmap's bindings.
 *
 * Order is only significant between entries sharing a chord — the dispatcher takes the first whose
 * chord matches *and* whose guard passes (ADR 0003). Two modules share a chord in exactly two
 * places here, both on complementary guards: bare `Enter` inside `mindmap/enter.ts`, and bare `F`
 * across `mindmap/convert-to-flow.ts` and `mindmap/fullscreen.ts`, declared in that order. The
 * arrow families are a genuine ordered fall-through and therefore live entirely inside
 * `mindmap/navigate.ts`, where nothing can be interleaved into them. `chord-sharing.test.ts`
 * declares every shared chord and fails on a new one, so a second module quietly shadowing an
 * existing chord is a red test rather than a silent no-op.
 */
export const MINDMAP_BINDINGS: readonly Binding<MindmapContext>[] = [
  ...inGroup("groupPresets", MINDMAP_STATUS_PRESET_BINDINGS),
  ...inGroup("groupMove", MINDMAP_REORDER_BINDINGS),
  ...inGroup("groupMove", MINDMAP_NAVIGATE_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_RENAME_BINDINGS),
  ...inGroup("groupCreate", MINDMAP_CREATE_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_ENTER_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_COMMITMENT_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_EXPECTATION_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_DELETE_BINDINGS),
  ...inGroup("groupDisplay", MINDMAP_COLLAPSE_BINDINGS),
  ...inGroup("groupDisplay", MINDMAP_ZOOM_BINDINGS),
  ...inGroup("groupMove", MINDMAP_DESELECT_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_CLIPBOARD_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_START_FLOW_BINDINGS),
  ...inGroup("groupDisplay", MINDMAP_CENTER_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_CONVERT_TO_FLOW_BINDINGS),
  ...inGroup("groupDisplay", MINDMAP_FULLSCREEN_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_EDITOR_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_FLAGS_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_PLAN_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_DEPENDENCY_BINDINGS),
  ...inGroup("groupEdit", MINDMAP_HISTORY_BINDINGS),
];
