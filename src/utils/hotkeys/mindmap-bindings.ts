import type { Binding } from "./chord";
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
import { MINDMAP_FILTER_BINDINGS, type MindmapFilterContext } from "./mindmap/filter";
import { MINDMAP_FLAGS_BINDINGS, type MindmapFlagsContext } from "./mindmap/flags";
import { MINDMAP_FULLSCREEN_BINDINGS, type MindmapFullscreenContext } from "./mindmap/fullscreen";
import { MINDMAP_HISTORY_BINDINGS, type MindmapHistoryContext } from "./mindmap/history";
import { MINDMAP_NAVIGATE_BINDINGS, type MindmapNavigateContext } from "./mindmap/navigate";
import { MINDMAP_RENAME_BINDINGS, type MindmapRenameContext } from "./mindmap/rename";
import { MINDMAP_REORDER_BINDINGS, type MindmapReorderContext } from "./mindmap/reorder";
import { MINDMAP_SEARCH_BINDINGS, type MindmapSearchContext } from "./mindmap/search";
import { MINDMAP_START_FLOW_BINDINGS, type MindmapStartFlowContext } from "./mindmap/start-flow";
import { MINDMAP_STATUS_PRESET_BINDINGS, type MindmapStatusPresetContext } from "./mindmap/status-presets";
import { MINDMAP_SUBTREE_BINDINGS, type MindmapSubtreeContext } from "./mindmap/subtree";
import { MINDMAP_TYPE_CYCLE_BINDINGS, type MindmapTypeCycleContext } from "./mindmap/type-cycle";
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
  MindmapFilterContext,
  MindmapFlagsContext,
  MindmapFullscreenContext,
  MindmapHistoryContext,
  MindmapNavigateContext,
  MindmapRenameContext,
  MindmapReorderContext,
  MindmapSearchContext,
  MindmapStartFlowContext,
  MindmapStatusPresetContext,
  MindmapSubtreeContext,
  MindmapTypeCycleContext,
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
  ...MINDMAP_FILTER_BINDINGS,
  ...MINDMAP_STATUS_PRESET_BINDINGS,
  ...MINDMAP_TYPE_CYCLE_BINDINGS,
  ...MINDMAP_REORDER_BINDINGS,
  ...MINDMAP_NAVIGATE_BINDINGS,
  ...MINDMAP_RENAME_BINDINGS,
  ...MINDMAP_CREATE_BINDINGS,
  ...MINDMAP_ENTER_BINDINGS,
  ...MINDMAP_COMMITMENT_BINDINGS,
  ...MINDMAP_DELETE_BINDINGS,
  ...MINDMAP_COLLAPSE_BINDINGS,
  ...MINDMAP_ZOOM_BINDINGS,
  ...MINDMAP_SUBTREE_BINDINGS,
  ...MINDMAP_DESELECT_BINDINGS,
  ...MINDMAP_CLIPBOARD_BINDINGS,
  ...MINDMAP_START_FLOW_BINDINGS,
  ...MINDMAP_CENTER_BINDINGS,
  ...MINDMAP_CONVERT_TO_FLOW_BINDINGS,
  ...MINDMAP_FULLSCREEN_BINDINGS,
  ...MINDMAP_EDITOR_BINDINGS,
  ...MINDMAP_FLAGS_BINDINGS,
  ...MINDMAP_SEARCH_BINDINGS,
  ...MINDMAP_HISTORY_BINDINGS,
];
