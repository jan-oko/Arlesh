// Time Scope value object, mirrored from the Rust `tasks::model::TimeScope`.

/** Duration parameters retained after snapshotting, so the UI can stay duration-shaped. */
export interface DurationSpec {
  n: number;
  kind: string;
}

/**
 * An item's relevance window: a resolved boundaries `[start, end]` scope range (equal ids
 * denote a single scope), optionally tagged with the Duration parameters it came from.
 */
export interface TimeScope {
  start_id: number;
  end_id: number;
  duration?: DurationSpec;
}
