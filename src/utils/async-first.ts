import type { TaskListRow } from "@/utils/list-filter";
import type { ListRowEntry, MixedListRow } from "@/utils/list-data";
import { groupMixedRowsByPath } from "@/utils/list-data";

/** The filtered rows split in two, each still in the pre-order it arrived in. */
interface AsynchronousSplit {
  /** Every asynchronous row, and everything hanging beneath one. */
  lifted: MixedListRow[];
  /** Everything else — the ordinary list, with the lifted rows taken out of it. */
  remaining: MixedListRow[];
}

/**
 * Splits the rows into the half the section collects and the half left below it.
 *
 * A row is lifted when its own Task is asynchronous, or when any ancestor of it has already been
 * lifted — so a subtree moves whole, indentation intact, and an asynchronous row nested inside
 * another asynchronous row's subtree rides up with the outer one rather than lifting a second time.
 * Pre-order means every ancestor is decided before the rows beneath it, so one pass is enough; the
 * ancestor chain is consulted rather than just the parent, so a descendant still follows its lifted
 * ancestor when the rows between them were filtered out.
 */
function splitAsynchronous(rows: readonly MixedListRow[]): AsynchronousSplit {
  const liftedIds = new Set<string>();
  const lifted: MixedListRow[] = [];
  const remaining: MixedListRow[] = [];
  for (const mixed of rows) {
    // Only a Task is asynchronous; a Commitment or an Expectation drawn as a row rides up only
    // because it hangs under one that is.
    const own = mixed.type === "task" && mixed.row.isAsynchronous;
    const ridesUp = own || mixed.row.ancestors.some((ancestor) => liftedIds.has(ancestor.id));
    if (!ridesUp) {
      remaining.push(mixed);
      continue;
    }
    liftedIds.add(mixed.row.node.id);
    lifted.push(mixed);
  }
  return { lifted, remaining };
}

/**
 * Collects the asynchronous work of the whole filtered set into **one section at the top of the
 * List View**, above every path header, and draws the ordinary list below it with those rows taken
 * out — a row is **moved**, never duplicated.
 *
 * Some tasks start a wait rather than finishing something — send the email, order the part, kick
 * off the build. Doing one of those first means the wait runs while you work on everything else, so
 * this is the ordering the List View offers for them. It is **opt-in**: the caller applies it only
 * while the *Asynchronous first* setting is on, and with it off the rows are left exactly as the
 * tree ordered them, with no section at all.
 *
 * A lifted row **brings its subtree with it**, because the indentation a row is drawn at names a
 * parent the reader expects to find above it. The two halves are then each grouped by path
 * independently, which is what keeps both readable: the section's own rows gain the parent they
 * left behind as a **path header** segment rather than as indentation under a row that is no longer
 * there, and the rows left below keep the header and the indentation their remaining ancestors give
 * them. So a path can head a run in both halves — the same location, named once per section.
 *
 * With nothing asynchronous there is no section header, not an empty one; with everything
 * asynchronous the ordinary list below is empty and draws neither a stray header nor the closing
 * rule, which would be a line drawn into empty space.
 *
 * The Mindmap is deliberately untouched. Sibling order there is set by hand with `Alt+↑`/`Alt+↓`,
 * which is a deliberate and visible thing; silently re-ordering a branch underneath it would
 * overwrite an answer the user already gave.
 */
export function withAsynchronousSection(rows: readonly TaskListRow[]): ListRowEntry[] {
  return withAsynchronousSectionMixed(rows.map((row) => ({ type: "task" as const, row })));
}

/** {@link withAsynchronousSection} over rows of every kind the list draws among the tasks. */
export function withAsynchronousSectionMixed(rows: readonly MixedListRow[]): ListRowEntry[] {
  const { lifted, remaining } = splitAsynchronous(rows);
  if (lifted.length === 0) return groupMixedRowsByPath(remaining);
  const below = groupMixedRowsByPath(remaining);
  // The closing rule is what makes the section read as a block rather than as a heading with the
  // whole list under it. It is drawn only when there is a list below to be closed off from.
  const closing: ListRowEntry[] = below.length === 0 ? [] : [{ type: "asynchronousEnd" }];
  return [{ type: "asynchronous" }, ...groupMixedRowsByPath(lifted), ...closing, ...below];
}
