import type { ListRowEntry } from "@/utils/list-data";

/** A task entry as {@link ListRowEntry} spells it — the half of the union this file reorders. */
type TaskEntry = Extract<ListRowEntry, { type: "task" }>;

/** One task entry together with the entries indented beneath it inside the same run. */
interface RunNode {
  entry: TaskEntry;
  children: RunNode[];
}

/**
 * Rebuilds a run's tree from the indentation the rows are drawn at.
 *
 * The rows arrive in pre-order with `visibleDepth` already computed, so a deeper row is a child of
 * the nearest shallower row before it. A run does not always start at depth 0 — a run can open with
 * a row whose parent row sits in an earlier run — so the stack is driven by relative depth rather
 * than by an assumed floor, and a row shallower than everything before it simply becomes another
 * root.
 */
function buildForest(entries: readonly TaskEntry[]): RunNode[] {
  const roots: RunNode[] = [];
  const stack: RunNode[] = [];
  for (const entry of entries) {
    const node: RunNode = { entry, children: [] };
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top !== undefined && top.entry.visibleDepth < entry.visibleDepth) break;
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * Moves the asynchronous nodes of each sibling group to the front of it, keeping every subtree
 * whole and every other pair in the order it arrived.
 *
 * A **stable** partition, not a sort: with the switch on, the only thing that changes is that
 * asynchronous work leads. Two asynchronous rows keep their order relative to each other, and so do
 * two synchronous ones.
 *
 * It moves a node *with* its children rather than lifting rows out of the flat list, because the
 * indentation a row is drawn at names a parent the reader expects to find above it. A child hoisted
 * over its parent would be indented under a row that is no longer there.
 */
function asynchronousFirst(nodes: readonly RunNode[]): RunNode[] {
  const leading = nodes.filter((node) => node.entry.row.isAsynchronous);
  const trailing = nodes.filter((node) => !node.entry.row.isAsynchronous);
  return [...leading, ...trailing].map((node) => ({
    entry: node.entry,
    children: asynchronousFirst(node.children),
  }));
}

/** Walks the reordered forest back out to the flat pre-order the list renders. */
function flatten(nodes: readonly RunNode[], out: ListRowEntry[]): void {
  for (const node of nodes) {
    out.push(node.entry);
    flatten(node.children, out);
  }
}

/**
 * Floats the asynchronous rows to the top of **their own path-header run**.
 *
 * Some tasks start a wait rather than finishing something — send the email, order the part, kick
 * off the build. Doing one of those first means the wait runs while you work on everything else, so
 * this is the ordering the List View offers for them. It is **opt-in**: the caller applies it only
 * while the *Asynchronous first* setting is on, and with it off the rows are left exactly as the
 * tree ordered them.
 *
 * A run — the rows between one path header and the next — is the unit, so **no run's membership or
 * header changes**: nothing crosses a header, and no header moves, appears or disappears. Inside a
 * run the reordering happens per sibling group, so a nested asynchronous row leads *its* siblings
 * rather than jumping over the parent that indents it.
 *
 * The Mindmap is deliberately untouched. Sibling order there is set by hand with `Alt+↑`/`Alt+↓`,
 * which is a deliberate and visible thing; silently re-ordering a branch underneath it would
 * overwrite an answer the user already gave.
 */
export function withAsynchronousFirst(entries: readonly ListRowEntry[]): ListRowEntry[] {
  const out: ListRowEntry[] = [];
  let run: TaskEntry[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    flatten(asynchronousFirst(buildForest(run)), out);
    run = [];
  };
  for (const entry of entries) {
    if (entry.type === "task") {
      run.push(entry);
      continue;
    }
    flushRun();
    out.push(entry);
  }
  flushRun();
  return out;
}
