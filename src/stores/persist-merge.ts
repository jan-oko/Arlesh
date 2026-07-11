function hasFilterKey(value: object): value is { filter: unknown } {
  return "filter" in value;
}

/** Zustand's default `persist` merge shallow-replaces each top-level slice wholesale
 * (`{...current, ...persisted}`), so a field added to a persisted slice's shape after a user already
 * has stored state rehydrates as `undefined` — a silent no-op, not a crash. Both filter stores
 * partialize to `{ filter: ... }`, so this backfills that slice field-by-field from `defaults`
 * instead, while still letting every previously-persisted field override its default. */
export function mergePersistedFilterSlice<T extends object>(persistedState: unknown, defaults: T): T {
  if (typeof persistedState !== "object" || persistedState === null) return defaults;
  if (!hasFilterKey(persistedState)) return defaults;
  const { filter } = persistedState;
  if (typeof filter !== "object" || filter === null) return defaults;
  return { ...defaults, ...filter };
}
