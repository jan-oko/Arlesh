function hasFilterKey(value: object): value is { filter: unknown } {
  return "filter" in value;
}

/**
 * Backfills one persisted filter object from `defaults`, field by field.
 *
 * A stored object replaces a default one **wholesale** wherever it is spread in, so a field added
 * to a filter's shape after a user already has stored state comes back `undefined` — a silent
 * no-op at best, and a crash in anything that reads it without checking. Every filter read out of
 * storage goes through here so that a field the stored blob has never heard of keeps its default.
 *
 * It is one level deep by design. A filter with nested structure of its own — the List View's pill
 * map — needs its own rebuild on top (`withCurrentPillDimensions`).
 */
export function mergeFilterDefaults<T extends object>(filter: unknown, defaults: T): T {
  if (typeof filter !== "object" || filter === null) return defaults;
  return { ...defaults, ...filter };
}

/** The same backfill for a zustand slice that partializes to `{ filter: ... }`. */
export function mergePersistedFilterSlice<T extends object>(persistedState: unknown, defaults: T): T {
  if (typeof persistedState !== "object" || persistedState === null) return defaults;
  if (!hasFilterKey(persistedState)) return defaults;
  return mergeFilterDefaults(persistedState.filter, defaults);
}
