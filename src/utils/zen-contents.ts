import type { FilterState } from "@/utils/filter-tree";
import { ZEN_VIEW_STATUS_MODE, isDelegated } from "@/utils/filter-tree";
import { isDelegatedToAgent } from "@/utils/delegation";
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
  /** Whether the Expectations strip draws the waits a Task delegated to the **Agent** has. */
  agentWaits: boolean;
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
 * Drops the rows `hides` names from what a filter kept, under the same **focus exemption**: the
 * focused row stays, reported as exempted, whatever `hides` says about it.
 */
function without<Row extends { node: { id: string } }>(
  kept: FocusFilteredRows<Row>,
  hides: (row: Row) => boolean,
  focusedId: string | null,
): FocusFilteredRows<Row> {
  const exemptedIds = new Set(kept.exemptedIds);
  const rows = kept.rows.filter((row) => {
    if (!hides(row)) return true;
    if (row.node.id !== focusedId) return false;
    exemptedIds.add(row.node.id);
    return true;
  });
  return { rows, exemptedIds };
}

/** A wait that exists because the Task it hangs under is delegated to the Agent. */
function isAgentDelegationWait(row: ExpectationListRow): boolean {
  return row.node.origin?.kind === "delegation_wait" && isDelegatedToAgent(row.ancestors[row.ancestors.length - 1]?.delegate);
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
 *   pre-order, with no Asynchronous-first partition — **less every delegated Task**: Do still shows
 *   an in-progress Task someone else holds, the Zen View shows only what you hold. Whether a
 *   **Started** Task counts is the Zen View's own setting (`showsStarted`), not the Do preset's.
 * - **The Commitments strip** is what the List View shows under Do: the unresolved ones.
 * - **The Expectations strip** is what **Start** shows — Do shows no Expectation at all, so this
 *   strip alone reads another preset. The shared filter already carries the app-wide *Start hides
 *   waits that have checks* setting. With `agentWaits` off it leaves out the waits of Tasks
 *   delegated to the Agent.
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
    tasks: without(
      withoutCompounds(filterTaskListWithFocus(source.tasks, underDo, doFilter, focusedId), options, focusedId),
      (row) => isDelegated(row.node),
      focusedId,
    ),
    commitments: options.commitments
      ? filterCommitmentListWithFocus(source.commitments, underDo, doFilter, focusedId)
      : none(),
    expectations: options.expectations
      ? without(
        filterExpectationListWithFocus(
          source.expectations, sharedUnder(shared, "start"), listFilterUnder("start", options.agentic), focusedId,
        ),
        (row) => !options.agentWaits && isAgentDelegationWait(row),
        focusedId,
      )
      : none(),
  };
}
