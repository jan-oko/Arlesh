// What the Plan View has selected, as pure functions over the **drawn** row order.
//
// The first cut of the view held a single node id and walked it with Up and Down. Planning in batch
// makes that a *set* with an anchor, but the thing it walks is unchanged: the order the rows are
// drawn in, which under a subscope split is the sections' order rather than the triage's. Sectioning
// must never make `Down` jump buckets, and a range must never gather rows that are not between the
// two ends on screen — both of which fall out of taking the rendered order as the one axis.

/** A set of selected rows, an anchor a range grows from, and the row the cursor is on. */
export interface PlanSelection {
  /** Every selected row. Unordered — `selectedInOrder` reads it against what is drawn. */
  ids: ReadonlySet<string>;
  /** Where a `Shift` range starts. Set by every gesture that establishes a new cursor. */
  anchorId: string | null;
  /**
   * The row the cursor is on: what `Up`/`Down` move, what a range extends *to*, and what the
   * single-row guards (the editor, the refusal that leaves the selection where it was) read.
   */
  leadId: string | null;
}

/** Nothing selected. */
export const EMPTY_PLAN_SELECTION: PlanSelection = { ids: new Set(), anchorId: null, leadId: null };

/** One row, alone: the anchor moves with it, so a `Shift` range afterwards grows from here. */
export function selectOnly(id: string): PlanSelection {
  return { ids: new Set([id]), anchorId: id, leadId: id };
}

/** Every id from `from` to `to` inclusive, in drawn order. Either end missing selects neither. */
function between(order: readonly string[], from: string, to: string): Set<string> {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return new Set();
  return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
}

/**
 * A `Shift` gesture: the run from the anchor to `id`.
 *
 * With no anchor yet there is nothing to reach *from*, so this is the gesture that sets one — a
 * `Shift+click` into an empty pane selects the one row, exactly as a bare click would.
 */
export function selectRange(selection: PlanSelection, order: readonly string[], id: string): PlanSelection {
  const anchor = selection.anchorId;
  if (anchor === null) return selectOnly(id);
  return { ids: between(order, anchor, id), anchorId: anchor, leadId: id };
}

/**
 * A `Ctrl` gesture: `id` joins the selection, or leaves it.
 *
 * The anchor follows the row that was touched even when the touch *removed* it, because the anchor
 * answers "where would a range start", and the last place you pointed at is that place whichever
 * way the toggle went.
 */
export function toggleSelected(selection: PlanSelection, id: string): PlanSelection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchorId: id, leadId: id };
}

/** Where the cursor lands after one step, or `null` when there is nowhere to land. */
function steppedLead(order: readonly string[], leadId: string | null, direction: 1 | -1): string | null {
  if (order.length === 0) return null;
  const current = leadId === null ? -1 : order.indexOf(leadId);
  if (current === -1) return (direction === 1 ? order[0] : order[order.length - 1]) ?? null;
  const moved = current + direction;
  if (moved < 0 || moved >= order.length) return leadId;
  return order[moved] ?? null;
}

/**
 * `Up`/`Down`, and their shifted forms.
 *
 * Unshifted, the cursor *replaces* the selection: walking a list with one row lit is the gesture the
 * view opened with, and a step that quietly left the previous row selected would make every
 * subsequent `Enter` act on more than the one row under the cursor. Shifted, the cursor moves and
 * the range from the anchor follows it, which is the only way to grow a selection without the mouse.
 */
export function navigateSelection(
  selection: PlanSelection,
  order: readonly string[],
  direction: 1 | -1,
  extend: boolean,
): PlanSelection {
  const lead = steppedLead(order, selection.leadId, direction);
  if (lead === null) return EMPTY_PLAN_SELECTION;
  if (!extend) return selectOnly(lead);
  const anchor = selection.anchorId ?? selection.leadId ?? lead;
  return { ids: between(order, anchor, lead), anchorId: anchor, leadId: lead };
}

/** The selected rows in the order they are drawn — what a batch acts on, and what it reports. */
export function selectedInOrder(selection: PlanSelection, order: readonly string[]): string[] {
  return order.filter((id) => selection.ids.has(id));
}

/**
 * The selection kept to rows that are still drawn.
 *
 * Planning a batch removes its rows from the pane, and a stale id left in the set would make the
 * *next* gesture act on work that is no longer in front of you. Dropping the lead drops the whole
 * selection with it rather than leaving a set with no cursor: after a move the caller places the
 * cursor deliberately, on the row that came next.
 */
export function pruneSelection(selection: PlanSelection, order: readonly string[]): PlanSelection {
  const drawn = new Set(order);
  const ids = new Set([...selection.ids].filter((id) => drawn.has(id)));
  if (ids.size === selection.ids.size) return selection;
  const leadId = selection.leadId !== null && drawn.has(selection.leadId) ? selection.leadId : null;
  const anchorId = selection.anchorId !== null && drawn.has(selection.anchorId) ? selection.anchorId : leadId;
  return { ids, anchorId, leadId };
}
