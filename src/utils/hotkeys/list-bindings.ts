import type { Binding } from "./chord";
import type { ListSelectionContext } from "./list/selection";
import { LIST_COMMITMENT_BINDINGS, type ListCommitmentContext } from "./list/commitment";
import { LIST_CREATE_BINDINGS, type ListCreateContext } from "./list/create";
import { LIST_DELETE_BINDINGS, type ListDeleteContext } from "./list/delete";
import { LIST_DESELECT_BINDINGS, type ListDeselectContext } from "./list/deselect";
import { LIST_EDITOR_BINDINGS, type ListEditorContext } from "./list/editor";
import { LIST_EXPECTATION_BINDINGS, type ListExpectationContext } from "./list/expectation";
import { LIST_FLAGS_BINDINGS, type ListFlagsContext } from "./list/flags";
import { LIST_FULLSCREEN_BINDINGS, type ListFullscreenContext } from "./list/fullscreen";
import { LIST_HISTORY_BINDINGS, type ListHistoryContext } from "./list/history";
import { LIST_NAVIGATE_BINDINGS, type ListNavigateContext } from "./list/navigate";
import { LIST_RENAME_BINDINGS, type ListRenameContext } from "./list/rename";
import { LIST_SCROLL_BINDINGS, type ListScrollContext } from "./list/scroll";
import { LIST_STATUS_BINDINGS, type ListStatusContext } from "./list/status";
import { LIST_STATUS_PRESET_BINDINGS, type ListStatusPresetContext } from "./list/status-presets";
import { LIST_UNBLOCK_PRESET_BINDINGS, type ListUnblockPresetContext } from "./list/unblock-preset";

export type { ListSelectionContext };
export { SCROLL_DOWN_CODE, SCROLL_UP_CODE } from "./list/scroll";

/**
 * What the List View bindings act on — the hook's options minus its gating flag.
 *
 * Each feature module in `list/` declares the slice its own bindings read, and this is all of them
 * at once. Adding a keyboard action means a new module and one line in each list below; it does
 * not mean editing a member some other in-flight feature is also editing.
 */
export interface ListContext extends
  ListCommitmentContext,
  ListCreateContext,
  ListDeleteContext,
  ListDeselectContext,
  ListEditorContext,
  ListExpectationContext,
  ListFlagsContext,
  ListFullscreenContext,
  ListHistoryContext,
  ListNavigateContext,
  ListRenameContext,
  ListScrollContext,
  ListStatusContext,
  ListStatusPresetContext,
  ListUnblockPresetContext {}

/**
 * List View's bindings, mirroring the Mindmap's where they translate to a flat list.
 *
 * Order is only significant between entries sharing a chord — the dispatcher takes the first whose
 * chord matches *and* whose guard passes (ADR 0003). Only bare `Enter` is shared here, by
 * `list/status.ts`, `list/commitment.ts` and `list/expectation.ts`, whose guards are complementary; `chord-sharing.test.ts`
 * declares that pair and fails on any new one, so a second module quietly shadowing an existing
 * chord is a red test rather than a silent no-op.
 */
export const LIST_BINDINGS: readonly Binding<ListContext>[] = [
  ...LIST_FULLSCREEN_BINDINGS,
  ...LIST_STATUS_PRESET_BINDINGS,
  ...LIST_UNBLOCK_PRESET_BINDINGS,
  ...LIST_NAVIGATE_BINDINGS,
  ...LIST_SCROLL_BINDINGS,
  ...LIST_STATUS_BINDINGS,
  ...LIST_COMMITMENT_BINDINGS,
  ...LIST_EXPECTATION_BINDINGS,
  ...LIST_EDITOR_BINDINGS,
  ...LIST_RENAME_BINDINGS,
  ...LIST_CREATE_BINDINGS,
  ...LIST_DELETE_BINDINGS,
  ...LIST_FLAGS_BINDINGS,
  ...LIST_DESELECT_BINDINGS,
  ...LIST_HISTORY_BINDINGS,
];
