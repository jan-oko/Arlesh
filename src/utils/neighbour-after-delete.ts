/**
 * Where a selection lands once `id` and everything deleted with it are gone: the next item in
 * `order`, or the one before it when nothing after survives, or `null` when nothing does.
 *
 * Stepping along the order is what the arrows already do, and it is where a reader's eye is — the
 * List View's rows and a Steps View's cards both land this way. Resolved against the order as it
 * stands **before** the write, because afterwards the item is gone and there is nothing left to
 * measure from.
 */
export function neighbourAfterDelete(
  order: readonly string[],
  id: string,
  deletedIds: ReadonlySet<string>,
): string | null {
  const index = order.indexOf(id);
  if (index === -1) return null;
  const after = order.slice(index + 1).find((candidate) => !deletedIds.has(candidate));
  if (after !== undefined) return after;
  const before = order.slice(0, index).reverse().find((candidate) => !deletedIds.has(candidate));
  return before ?? null;
}
