import type { FilterState } from "@/utils/filter-tree";
import { ZEN_VIEW_STATUS_MODE } from "@/utils/filter-tree";
import type { CommitmentListRow, ExpectationListRow, FocusFilteredRows, ListFilterState, TaskListRow } from "@/utils/list-filter";
import {
  DEFAULT_LIST_FILTER, filterCommitmentListWithFocus, filterExpectationListWithFocus, filterTaskListWithFocus,
} from "@/utils/list-filter";

/** The List View's rows, unfiltered — what the Zen View is read out of. */
export interface ZenSourceRows {
  tasks: readonly TaskListRow[];
  commitments: readonly CommitmentListRow[];
  expectations: readonly ExpectationListRow[];
}

/** Which of the two strips the tab shows. */
export interface ZenStripsShown {
  commitments: boolean;
  expectations: boolean;
}

/** What the Zen View draws: the grid's cards and each strip's, with the focus exemption applied. */
export interface ZenContents {
  tasks: FocusFilteredRows<TaskListRow>;
  commitments: FocusFilteredRows<CommitmentListRow>;
  expectations: FocusFilteredRows<ExpectationListRow>;
}

/** A hidden strip: no rows, nothing exempted. */
function none<Row>(): FocusFilteredRows<Row> {
  return { rows: [], exemptedIds: new Set<string>() };
}

/**
 * The List View's own filter as the Zen View asks it: the preset `mode`, every row kind, and **none**
 * of the List View's pills — those are the List View's, as they are not the Plan View's or the Steps
 * View's, and a pill no chip in this view names must not narrow it.
 */
function listFilterUnder(mode: FilterState["statusMode"]): ListFilterState {
  return { ...DEFAULT_LIST_FILTER, preset: mode };
}

/** The shared filter read under `mode` rather than the tab's own preset. */
function sharedUnder(shared: FilterState, mode: FilterState["statusMode"]): FilterState {
  return { ...shared, statusMode: mode };
}

/**
 * The Zen View's contents, from the List View's rows.
 *
 * - **The grid** is the List View's Task rows under **Do**, in the order they came — plain board
 *   pre-order, with no Asynchronous-first partition.
 * - **The Commitments strip** is what the List View shows under Do: the unresolved ones.
 * - **The Expectations strip** is what **Start** shows — Do shows no Expectation at all, so this
 *   strip alone reads another preset. The shared filter already carries the app-wide *Start hides
 *   waits that have checks* setting.
 *
 * Everything else in the shared filter applies unchanged. A hidden strip is empty. `focusedId` is
 * the view's selection, kept on screen (and reported as exempted) whatever the filter says about it.
 */
export function zenContents(
  source: ZenSourceRows,
  shared: FilterState,
  strips: ZenStripsShown,
  focusedId: string | null,
): ZenContents {
  const underDo = sharedUnder(shared, ZEN_VIEW_STATUS_MODE);
  const doFilter = listFilterUnder(ZEN_VIEW_STATUS_MODE);
  return {
    tasks: filterTaskListWithFocus(source.tasks, underDo, doFilter, focusedId),
    commitments: strips.commitments
      ? filterCommitmentListWithFocus(source.commitments, underDo, doFilter, focusedId)
      : none(),
    expectations: strips.expectations
      ? filterExpectationListWithFocus(source.expectations, sharedUnder(shared, "start"), listFilterUnder("start"), focusedId)
      : none(),
  };
}
