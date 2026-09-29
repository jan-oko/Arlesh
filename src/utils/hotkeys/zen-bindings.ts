import type { Binding } from "./chord";
import { LIST_COMMITMENT_BINDINGS, type ListCommitmentContext } from "./list/commitment";
import { LIST_DELETE_BINDINGS, type ListDeleteContext } from "./list/delete";
import { LIST_DEPENDENCY_BINDINGS, type ListDependencyContext } from "./list/dependency";
import { LIST_DESELECT_BINDINGS, type ListDeselectContext } from "./list/deselect";
import { LIST_EDITOR_BINDINGS, type ListEditorContext } from "./list/editor";
import { LIST_EXPECTATION_BINDINGS, type ListExpectationContext } from "./list/expectation";
import { LIST_FLAGS_BINDINGS, type ListFlagsContext } from "./list/flags";
import { LIST_FULLSCREEN_BINDINGS, type ListFullscreenContext } from "./list/fullscreen";
import { LIST_HISTORY_BINDINGS, type ListHistoryContext } from "./list/history";
import { LIST_JUMP_BINDINGS, type ListJumpContext } from "./list/jump";
import { LIST_PLAN_BINDINGS, type ListPlanContext } from "./list/plan";
import { LIST_RENAME_BINDINGS, type ListRenameContext } from "./list/rename";
import { LIST_SCROLL_BINDINGS, type ListScrollContext } from "./list/scroll";
import { LIST_STATUS_BINDINGS, type ListStatusContext } from "./list/status";
import { asZenBindings } from "./zen/from-list";
import { ZEN_NAVIGATE_BINDINGS, type ZenNavigateContext } from "./zen/navigate";
import { ZEN_STATUS_PRESET_BINDINGS, type ZenStatusPresetContext } from "./zen/status-presets";

/**
 * What the Zen View bindings act on. The List View's own slices — the Zen View has one selection
 * that is a Task, a Commitment or an Expectation, exactly as the list's is — plus its own three.
 *
 * `ListExpectationContext` is carried whole even though two of its bindings are left out (below):
 * the context is what the kept bindings read, and splitting the list's module to spare two unused
 * callbacks would be changing the List View for this view's sake.
 */
export interface ZenContext extends
  ListCommitmentContext,
  ListDeleteContext,
  ListDependencyContext,
  ListDeselectContext,
  ListEditorContext,
  ListExpectationContext,
  ListFlagsContext,
  ListFullscreenContext,
  ListHistoryContext,
  ListJumpContext,
  ListPlanContext,
  ListRenameContext,
  ListScrollContext,
  ListStatusContext,
  ZenNavigateContext,
  ZenStatusPresetContext {}

/**
 * The List View's Expectation bindings the Zen View does **not** take: `Shift+E` creates a wait, and
 * `Alt+E` chooses the list's Expectations option — the Zen View creates nothing, and always reads
 * under Do, so `Alt+E` is refused with the presets (`zen/status-presets.ts`).
 */
const NOT_IN_ZEN: ReadonlySet<string> = new Set(["listView.createExpectation", "listView.preset.expectations"]);

/**
 * The Zen View's bindings: **the List View's, except every create key**, plus the grid's own
 * two-dimensional arrows and the preset refusals. The strips are switched from the Filter menu, as
 * the List View's row kinds are (`c` / `e` while it is open), not from a view binding.
 *
 * The List View's are borrowed from its modules rather than restated (see `asZenBindings`). Left out:
 * `list/create.ts` (`Tab`, `Shift+Enter`), `Shift+E`, and the list's presets (`Alt+A/P/S/D/B/U/E`),
 * which the Zen View answers with a refusal because it always reads under Do. Its row
 * navigation is replaced by `zen/navigate.ts`.
 *
 * Bare `Enter` is shared three ways, exactly as in the List View and on the same complementary
 * guards (a selection is one kind); `chord-sharing.test.ts` declares the group.
 */
export const ZEN_BINDINGS: readonly Binding<ZenContext>[] = [
  ...asZenBindings(LIST_FULLSCREEN_BINDINGS),
  ...ZEN_STATUS_PRESET_BINDINGS,
  ...ZEN_NAVIGATE_BINDINGS,
  ...asZenBindings(LIST_JUMP_BINDINGS, {
    "listView.jumpToFirst": "jumpToFirstCard",
    "listView.jumpToLast": "jumpToLastCard",
  }),
  ...asZenBindings(LIST_SCROLL_BINDINGS, { "listView.scrollDown": "scrollZenGrid", "listView.scrollUp": "scrollZenGrid" }),
  ...asZenBindings(LIST_STATUS_BINDINGS, { "listView.cycleStatus": "stepsCycleStatus" }),
  ...asZenBindings(LIST_COMMITMENT_BINDINGS),
  ...asZenBindings(LIST_EXPECTATION_BINDINGS.filter((binding) => !NOT_IN_ZEN.has(binding.id))),
  ...asZenBindings(LIST_EDITOR_BINDINGS),
  ...asZenBindings(LIST_RENAME_BINDINGS),
  ...asZenBindings(LIST_DELETE_BINDINGS),
  ...asZenBindings(LIST_FLAGS_BINDINGS),
  ...asZenBindings(LIST_PLAN_BINDINGS),
  ...asZenBindings(LIST_DEPENDENCY_BINDINGS),
  ...asZenBindings(LIST_DESELECT_BINDINGS),
  ...asZenBindings(LIST_HISTORY_BINDINGS),
];
