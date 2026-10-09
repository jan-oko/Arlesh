import type { FilterState } from "@/utils/filter-tree";
import { ZEN_VIEW_STATUS_MODE, isDelegated } from "@/utils/filter-tree";
import { isReview } from "@/utils/status-mapping";
import type {
  CommitmentListRow, ExpectationListRow, FocusFilteredRows, ListFilterState, PillFilter, TaskListRow,
} from "@/utils/list-filter";
import {
  DEFAULT_LIST_FILTER, filterCommitmentListWithFocus, filterExpectationListWithFocus, filterTaskListWithFocus,
} from "@/utils/list-filter";

/** The List View's rows, unfiltered — what the Zen View is read out of. */
export interface ZenSourceRows {
  tasks: readonly TaskListRow[];
  commitments: readonly CommitmentListRow[];
  expectations: readonly ExpectationListRow[];
}

/** What the tab asks of the Zen View besides the shared filter. */
export interface ZenOptions {
  /** Which of the two strips the tab shows. */
  commitments: boolean;
  expectations: boolean;
  /** The tab's **Agentic** pill — the one List View pill the Zen View reads. */
  agentic: readonly PillFilter[];
  /** The app-wide *Show Started tasks on the grid* setting: read in place of Do's own. */
  showsStarted: boolean;
  /** The app-wide *Show compound tasks on the grid* setting. Off, a Compound Task's card is not
   * drawn — its sub-items still are, by their own status — unless it is the focused one. */
  showsCompound: boolean;
}

/** What the Zen View draws: the grid's cards and each strip's, with the focus exemption applied. */
export interface ZenContents {
  tasks: FocusFilteredRows<TaskListRow>;
  commitments: FocusFilteredRows<CommitmentListRow>;
  expectations: FocusFilteredRows<ExpectationListRow>;
}

/**
 * The grid without its Compound Tasks, when the setting says so. The focused card stays, named as
 * exempted, so a card just changed does not vanish from under the cursor.
 */
function withoutCompounds(
  grid: FocusFilteredRows<TaskListRow>,
  options: ZenOptions,
  focusedId: string | null,
): FocusFilteredRows<TaskListRow> {
  if (options.showsCompound) return grid;
  const rows = grid.rows.filter((row) => row.node.compound !== true || row.node.id === focusedId);
  const focusedCompound = rows.some((row) => row.node.compound === true);
  if (!focusedCompound || focusedId === null) return { rows, exemptedIds: grid.exemptedIds };
  return { rows, exemptedIds: new Set([...grid.exemptedIds, focusedId]) };
}

/**
 * The grid with its **Review** cards first, each one an agent idle until the user answers, the rest
 * after in the order they came. A partition, not a sort: each half keeps its order.
 */
function reviewFirst(grid: FocusFilteredRows<TaskListRow>): FocusFilteredRows<TaskListRow> {
  const review = grid.rows.filter((row) => isReview(row.node.taskStatus));
  if (review.length === 0) return grid;
  return { rows: [...review, ...grid.rows.filter((row) => !isReview(row.node.taskStatus))], exemptedIds: grid.exemptedIds };
}

/**
 * The Expectations strip without the waits an agent raised: a question is drawn on its Review card,
 * and a wait on something else (CI, say) is the agent's own business. The strip carries the waits on
 * people. Both stay in the tree views, under their Task.
 */
function withoutAgenticWaits(strip: FocusFilteredRows<ExpectationListRow>): FocusFilteredRows<ExpectationListRow> {
  return { rows: strip.rows.filter((row) => row.node.agentWaiting === undefined), exemptedIds: strip.exemptedIds };
}

/**
 * The grid less every card `drops` names, under the focus exemption: the focused card stays, reported
 * as exempted, until the selection leaves it.
 */
function without(
  grid: FocusFilteredRows<TaskListRow>,
  drops: (row: TaskListRow) => boolean,
  focusedId: string | null,
): FocusFilteredRows<TaskListRow> {
  const exemptedIds = new Set(grid.exemptedIds);
  const rows = grid.rows.filter((row) => {
    if (!drops(row)) return true;
    if (row.node.id !== focusedId) return false;
    exemptedIds.add(row.node.id);
    return true;
  });
  return { rows, exemptedIds };
}

/**
 * The grid without its **delegated** Tasks — someone else holds them, and the Zen View shows only
 * what you hold. A card you have just delegated stays while it is focused.
 */
function withoutDelegated(grid: FocusFilteredRows<TaskListRow>, focusedId: string | null): FocusFilteredRows<TaskListRow> {
  return without(grid, (row) => isDelegated(row.node), focusedId);
}

/**
 * The grid without its **Review** cards unless the shared filter's Review pill (`showReview`) asks
 * for them. Do shows Review whatever the pill says; the Zen View alone reads it. A focused card stays.
 */
function withoutReview(
  grid: FocusFilteredRows<TaskListRow>,
  shared: FilterState,
  focusedId: string | null,
): FocusFilteredRows<TaskListRow> {
  if (shared.showReview === true) return grid;
  return without(grid, (row) => isReview(row.node.taskStatus), focusedId);
}

/** A hidden strip: no rows, nothing exempted. */
function none<Row>(): FocusFilteredRows<Row> {
  return { rows: [], exemptedIds: new Set<string>() };
}

/**
 * The List View's own filter as the Zen View asks it: the preset `mode`, every row kind, and of the
 * List View's pills **Agentic alone** — the one the Zen View's Filter menu offers. The others are the
 * List View's, as they are not the Plan View's or the Steps View's, and a pill this view's menu
 * cannot show must not narrow it. Agentic asks about Tasks, so only the grid answers it.
 */
function listFilterUnder(mode: FilterState["statusMode"], agentic: readonly PillFilter[]): ListFilterState {
  return { ...DEFAULT_LIST_FILTER, preset: mode, pills: { ...DEFAULT_LIST_FILTER.pills, agentic: [...agentic] } };
}

/** The shared filter read under `mode` rather than the tab's own preset. */
function sharedUnder(shared: FilterState, mode: FilterState["statusMode"]): FilterState {
  return { ...shared, statusMode: mode };
}

/**
 * The Zen View's contents, from the List View's rows.
 *
 * - **The grid** is the List View's Task rows under **Do**, in the order they came — plain board
 *   pre-order, with no Asynchronous-first partition — but with **Review** cards first, and **less
 *   every delegated Task**: Do still shows an in-progress Task someone else holds, the Zen View
 *   shows only what you hold. Whether a
 *   **Started** Task counts is the Zen View's own setting (`showsStarted`), not the Do preset's; an
 *   **On Agent** one shows only while the shared filter's `showOnAgent` asks for it, and a **Review**
 *   one only while its `showReview` does — the Zen View's own pill, which Do does not read.
 * - **The Commitments strip** is what the List View shows under Do: the unresolved ones.
 * - **The Expectations strip** is what **Start** shows — Do shows no Expectation at all, so this
 *   strip alone reads another preset — less every wait an agent raised. The shared filter already
 *   carries the app-wide *Start hides waits that have checks* setting.
 *
 * Everything else in the shared filter applies unchanged, and the Agentic pill narrows the grid. A
 * hidden strip is empty. `focusedId` is
 * the view's selection, kept on screen (and reported as exempted) whatever the filter says about it.
 */
export function zenContents(
  source: ZenSourceRows,
  shared: FilterState,
  options: ZenOptions,
  focusedId: string | null,
): ZenContents {
  const underDo = { ...sharedUnder(shared, ZEN_VIEW_STATUS_MODE), doShowsStarted: options.showsStarted };
  const doFilter = listFilterUnder(ZEN_VIEW_STATUS_MODE, options.agentic);
  return {
    tasks: reviewFirst(withoutReview(
      withoutDelegated(
        withoutCompounds(filterTaskListWithFocus(source.tasks, underDo, doFilter, focusedId), options, focusedId),
        focusedId,
      ),
      shared,
      focusedId,
    )),
    commitments: options.commitments
      ? filterCommitmentListWithFocus(source.commitments, underDo, doFilter, focusedId)
      : none(),
    expectations: options.expectations
      ? withoutAgenticWaits(filterExpectationListWithFocus(
        source.expectations, sharedUnder(shared, "start"), listFilterUnder("start", options.agentic), focusedId,
      ))
      : none(),
  };
}
