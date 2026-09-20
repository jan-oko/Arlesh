import type { GestureSummary } from "@/api/gesture";

/** The verb that best names a Gesture, when the Gesture has no name of its own. */
export type GestureVerb = "create" | "update" | "delete" | "change";

/** A verb and the number of rows it applies to — everything the toast needs to phrase a Gesture. */
export interface GestureChanges {
  verb: GestureVerb;
  count: number;
}

/**
 * Names an unnamed Gesture from its row counts: "delete 4 items" rather than a list of tables.
 *
 * Only Gestures nobody opened by hand reach this — a lone status toggle, a rename — so the counts
 * are small and a verb plus a number reads the way the user remembers the action. A Gesture whose
 * rows were not all the same kind of change gets the neutral "change", because claiming it was a
 * delete when it also created something would be worse than saying less.
 *
 * Undo speaks in rows, not intentions (ADR 0006), so `count` is rows and not nodes: deleting one
 * tagged task is several rows. The explicit name a `withGesture` sets is what says "5 nodes"; this
 * is the honest fallback for everything else.
 */
export function describeChanges(summary: GestureSummary): GestureChanges {
  const { inserted, updated, deleted, rows } = summary;
  if (inserted > 0 && updated === 0 && deleted === 0) return { verb: "create", count: inserted };
  if (updated > 0 && inserted === 0 && deleted === 0) return { verb: "update", count: updated };
  if (deleted > 0 && inserted === 0 && updated === 0) return { verb: "delete", count: deleted };
  return { verb: "change", count: rows };
}
