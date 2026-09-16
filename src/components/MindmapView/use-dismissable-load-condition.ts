import { useState } from "react";
import type { FailedFlow, LoadCondition } from "./use-mindmap-data";

interface Result {
  /** The failed flows to show, or `[]` when there is nothing to show or the banner is dismissed. */
  visibleFailedFlows: FailedFlow[];
  /** Dismisses the banner for the current failure set. */
  dismiss: () => void;
}

/**
 * An order-independent content key for a load condition's failed-flow set, so a reordering in
 * the backend's response is never mistaken for a new condition. `null` when there is nothing to
 * key, distinguishing "no failures" from any concrete failure set.
 */
function failedFlowsKey(condition: LoadCondition): string | null {
  if (condition.failedFlows.length === 0) return null;
  return condition.failedFlows
    .map((flow) => flow.id)
    .sort((a, b) => a - b)
    .join(",");
}

/**
 * Tracks whether the Habit-load-failure banner should show.
 *
 * `useMindmapData`'s `load()` reruns after every mutation and always builds a brand-new
 * `LoadCondition` object, even when the failures are unchanged — so dismissal is keyed on the
 * *content* of the failure set (its sorted flow ids), not the object itself. The dismissal:
 * - survives a reload that reports the identical set of failed flows;
 * - is lifted by a load that changes the set — a flow added, or a different flow failing;
 * - is spent by a load that clears the condition entirely, so a later recurrence of the very
 *   same failure is not silently swallowed by a dismissal from before it ever cleared.
 *
 * The "condition cleared, so forget the dismissal" rule needs one render's worth of memory (the
 * previous key) to detect the clearing edge; adjusting state during render off a ref-tracked
 * previous value is the documented alternative to an effect for this kind of derived reset.
 */
export function useDismissableLoadCondition(condition: LoadCondition): Result {
  const currentKey = failedFlowsKey(condition);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(currentKey);

  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    if (currentKey === null) setDismissedKey(null);
  }

  const visible = currentKey !== null && currentKey !== dismissedKey;
  return {
    visibleFailedFlows: visible ? condition.failedFlows : [],
    dismiss: () => setDismissedKey(currentKey),
  };
}
