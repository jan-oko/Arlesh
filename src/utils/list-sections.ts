import type { FilterState } from "@/utils/filter-tree";
import type { ListFilterState } from "@/utils/list-filter";
import type { ListRowEntry, MixedListRow } from "@/utils/list-data";
import { groupMixedRowsByPath } from "@/utils/list-data";
import { isOverdue } from "@/utils/overdue";
import { isReview } from "@/utils/status-mapping";

/** Which of the List View's lifted sections to draw. Each is off unless its setting and its
 * conditions say so; the caller decides, this module only partitions. */
export interface ListSections {
  /** The **Review** section: every Agentic Task whose agent has a question open, and everything
   * beneath one. Drawn first of all. */
  review: boolean;
  /** The **Overdue** section: every Overdue row, and everything beneath one. */
  overdue: boolean;
  /** The **Asynchronous** section: every asynchronous Task's row, and everything beneath one. */
  asynchronous: boolean;
}

/** One section's opening heading and closing rule — the markers that bracket it in the stream. */
interface SectionMarkers {
  heading: ListRowEntry;
  end: ListRowEntry;
}

const REVIEW_MARKERS: SectionMarkers = { heading: { type: "review" }, end: { type: "reviewEnd" } };
const OVERDUE_MARKERS: SectionMarkers = { heading: { type: "overdue" }, end: { type: "overdueEnd" } };
const ASYNCHRONOUS_MARKERS: SectionMarkers = {
  heading: { type: "asynchronous" },
  end: { type: "asynchronousEnd" },
};

/** The rows split in two, each still in the pre-order it arrived in. */
interface SectionSplit {
  /** Every row the section claims by its own right, and everything hanging beneath one. */
  lifted: MixedListRow[];
  /** Everything else, with the lifted rows taken out of it. */
  remaining: MixedListRow[];
}

/**
 * Splits the rows into the half a section collects and the half left below it.
 *
 * A row is lifted when `claims` says so of the row itself, or when any ancestor of it has already been
 * lifted — so a subtree moves whole, indentation intact, and a row nested inside another lifted row's
 * subtree rides up with the outer one rather than lifting a second time. Pre-order means every
 * ancestor is decided before the rows beneath it, so one pass is enough; the ancestor chain is
 * consulted rather than just the parent, so a descendant still follows its lifted ancestor when the
 * rows between them were filtered out.
 */
function splitSection(rows: readonly MixedListRow[], claims: (mixed: MixedListRow) => boolean): SectionSplit {
  const liftedIds = new Set<string>();
  const lifted: MixedListRow[] = [];
  const remaining: MixedListRow[] = [];
  for (const mixed of rows) {
    const ridesUp = claims(mixed) || mixed.row.ancestors.some((ancestor) => liftedIds.has(ancestor.id));
    if (!ridesUp) {
      remaining.push(mixed);
      continue;
    }
    liftedIds.add(mixed.row.node.id);
    lifted.push(mixed);
  }
  return { lifted, remaining };
}

/** Only a Task is asynchronous; a Commitment or an Expectation drawn as a row rides up only because
 * it hangs under one that is. */
function claimsAsynchronous(mixed: MixedListRow): boolean {
  return mixed.type === "task" && mixed.row.isAsynchronous;
}

/** Only a Task reads Review — an Agentic one, On Agent with its agent's question open. */
function claimsReview(mixed: MixedListRow): boolean {
  return mixed.type === "task" && isReview(mixed.row.node.taskStatus);
}

/** A Task or a wait is claimed by its own Overdue flag; a Commitment is never Overdue, so it rides up
 * only under an Overdue row. */
function claimsOverdue(mixed: MixedListRow): boolean {
  return isOverdue(mixed.row.node);
}

/** One section as entries: its heading, its rows grouped by path on their own terms. The closing rule
 * is added by the caller, which knows whether anything follows. */
interface DrawnSection {
  markers: SectionMarkers;
  rows: MixedListRow[];
}

/**
 * Collects the List View's lifted work into **sections at the top of the list**, above every path
 * header, and draws the ordinary list below them with those rows taken out — a row is **moved**,
 * never duplicated.
 *
 * Three sections, in this order:
 *
 * - **Review** — Agentic Tasks whose agent is waiting on the user's answer: each one idles an agent,
 *   so it leads. The caller asks for it under Start and Do, whatever any setting says.
 * - **Overdue** — late work, drawn first because it is the most pressing thing on the list. The
 *   caller asks for it only under the Start preset and while its setting (on by default) is on.
 * - **Asynchronous** — work that starts a wait rather than finishing something (send the email, order
 *   the part): doing it first lets the wait run while you work on the rest. Opt-in, off by default.
 *
 * A row both Overdue and asynchronous goes to the **Overdue** section: sections claim in order, and
 * what the first has taken is not offered to the second. It still comes before everything the
 * Asynchronous section holds, so it loses nothing by it.
 *
 * A lifted row **brings its subtree with it**, because the indentation a row is drawn at names a
 * parent the reader expects to find above it. Each part is then grouped by path independently, which
 * keeps every part readable: a section's rows gain the parent they left behind as a **path header**
 * segment rather than as indentation under a row that is no longer there, and the rows left below
 * keep the header and indentation their remaining ancestors give them. So a path can head a run in
 * more than one part — the same location, named once per part.
 *
 * A section with nothing in it draws no heading, not an empty one. Each section is closed by a rule
 * only when something follows it — the next section or the ordinary list — so nothing draws a line
 * into empty space. Every part keeps **pre-order** within itself: this is a partition, not a sort.
 *
 * The Mindmap is deliberately untouched. Sibling order there is set by hand with `Alt+↑`/`Alt+↓`,
 * which is a deliberate and visible thing; silently re-ordering a branch underneath it would
 * overwrite an answer the user already gave.
 */
export function withListSections(rows: readonly MixedListRow[], sections: ListSections): ListRowEntry[] {
  const drawn: DrawnSection[] = [];
  let remaining: readonly MixedListRow[] = rows;
  if (sections.review) {
    const split = splitSection(remaining, claimsReview);
    drawn.push({ markers: REVIEW_MARKERS, rows: split.lifted });
    remaining = split.remaining;
  }
  if (sections.overdue) {
    const split = splitSection(remaining, claimsOverdue);
    drawn.push({ markers: OVERDUE_MARKERS, rows: split.lifted });
    remaining = split.remaining;
  }
  if (sections.asynchronous) {
    const split = splitSection(remaining, claimsAsynchronous);
    drawn.push({ markers: ASYNCHRONOUS_MARKERS, rows: split.lifted });
    remaining = split.remaining;
  }
  const below = groupMixedRowsByPath(remaining);
  const nonEmpty = drawn.filter((section) => section.rows.length > 0);
  const entries: ListRowEntry[] = [];
  nonEmpty.forEach((section, index) => {
    entries.push(section.markers.heading, ...groupMixedRowsByPath(section.rows));
    // The closing rule is what makes a section read as a block rather than as a heading with the
    // whole list under it. It is drawn only when there is something below to be closed off from.
    const followed = index < nonEmpty.length - 1 || below.length > 0;
    if (followed) entries.push(section.markers.end);
  });
  return [...entries, ...below];
}

/**
 * Whether the List View draws its **Review** section: whenever the list reads the **Start** or **Do**
 * preset — the two that show Review — and not under the Unblock and Expectations options, which
 * replace the preset's question. No setting switches it: a Review Task idles an agent.
 */
export function showsReviewSection(shared: FilterState, listFilter: ListFilterState): boolean {
  if (shared.statusMode !== "start" && shared.statusMode !== "do") return false;
  return listFilter.preset !== "unblock" && listFilter.preset !== "expectations";
}

/**
 * Whether the List View draws its **Overdue** section: while the setting is on, and only while the
 * list is reading the **Start** preset — the preset that asks what to begin now, which late work
 * answers first. The Unblock and Expectations options replace the preset's question for the list, so
 * neither draws it.
 */
export function showsOverdueSection(enabled: boolean, shared: FilterState, listFilter: ListFilterState): boolean {
  if (!enabled || shared.statusMode !== "start") return false;
  return listFilter.preset !== "unblock" && listFilter.preset !== "expectations";
}
