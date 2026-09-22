// Interval arithmetic over resolved scope windows. The backend stays the source of truth for what
// a scope's window *is* (`resolve_scope`); this is only the comparison, kept pure and synchronous
// so the Plan View can partition a whole board per render without an IPC round trip per task.

/**
 * A scope resolved to its half-open `[start, end)` window, as `resolve_scope` returns it: local
 * wall-clock ISO datetimes, `YYYY-MM-DDTHH:MM:SS`.
 *
 * Both endpoints are fixed-width and zero-padded, so string order *is* chronological order and
 * every comparison below is a plain `<=`. That is a property of the format, not a coincidence —
 * anything that ever puts a non-padded or offset-carrying datetime in here breaks it silently.
 */
export interface ScopeInterval {
  start: string;
  end: string;
}

/** Whether `inner` lies wholly inside `outer` — the frontend's reading of `interval_contains`. */
export function intervalContains(outer: ScopeInterval, inner: ScopeInterval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * Whether two half-open windows share any instant.
 *
 * Half-open is what makes two adjacent scopes — a week ending `[…, Mon 00:00)` and the week
 * starting at `Mon 00:00` — read as not overlapping, which is the answer a planning pass wants:
 * next week's work is not this week's candidate.
 */
export function intervalsOverlap(a: ScopeInterval, b: ScopeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}
