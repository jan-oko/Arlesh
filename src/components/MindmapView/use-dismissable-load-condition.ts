import { useState } from "react";
import type { FailedFlow, LoadCondition } from "./use-mindmap-data";

interface Result {
  /** The failed flows to show, or `[]` when there is nothing to show or the banner is dismissed. */
  visibleFailedFlows: FailedFlow[];
  /** The commitment Habits whose template cannot be rendered, under the same dismissal. */
  visibleUnrenderableCommitmentFlows: FailedFlow[];
  /** Dismisses the banner for the current condition. */
  dismiss: () => void;
}

/**
 * An order-independent content key for a load condition, so a reordering in the backend's response
 * is never mistaken for a new condition. `null` when there is nothing to key, distinguishing "no
 * condition" from any concrete one. The two kinds of flow are keyed separately, so a flow that
 * appears in both lists still reads as two distinct facts about it.
 */
function conditionKey(condition: LoadCondition): string | null {
  const ids = (flows: readonly FailedFlow[]): string =>
    flows.map((flow) => flow.id).sort((a, b) => a - b).join(",");
  if (condition.failedFlows.length === 0 && condition.unrenderableCommitmentFlows.length === 0) {
    return null;
  }
  return `${ids(condition.failedFlows)}|${ids(condition.unrenderableCommitmentFlows)}`;
}

/**
 * Tracks whether the load-condition banner should show.
 *
 * `useMindmapData`'s `load()` reruns after every mutation and always builds a brand-new
 * `LoadCondition` object, even when the condition is unchanged — so dismissal is keyed on the
 * *content* of the condition (its sorted flow ids), not the object itself. The dismissal:
 * - survives a reload that reports the identical condition;
 * - is lifted by a load that changes it — a flow added, or a different flow failing;
 * - is spent by a load that clears it entirely, so a later recurrence of the very same condition
 *   is not silently swallowed by a dismissal from before it ever cleared.
 *
 * The "condition cleared, so forget the dismissal" rule needs one render's worth of memory (the
 * previous key) to detect the clearing edge; adjusting state during render off a ref-tracked
 * previous value is the documented alternative to an effect for this kind of derived reset.
 */
export function useDismissableLoadCondition(condition: LoadCondition): Result {
  const currentKey = conditionKey(condition);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(currentKey);

  if (currentKey !== lastKey) {
    setLastKey(currentKey);
    if (currentKey === null) setDismissedKey(null);
  }

  const visible = currentKey !== null && currentKey !== dismissedKey;
  return {
    visibleFailedFlows: visible ? condition.failedFlows : [],
    visibleUnrenderableCommitmentFlows: visible ? condition.unrenderableCommitmentFlows : [],
    dismiss: () => setDismissedKey(currentKey),
  };
}
