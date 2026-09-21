import { useState } from "react";

interface Result {
  /** True once the × has been pressed. Nothing is written yet — the row only *reads* as dropped. */
  isCleared: boolean;
  /** Stages the drop. `undefined` where no clear is on offer, and the row is then read-only. */
  stageClear: (() => void) | undefined;
  /** Performs a staged clear, or nothing if none was staged. The editor's save calls it. */
  commitClear: () => Promise<void>;
}

/**
 * The staged half of the **Issue** row's ×, shared by the Task, Goal, Commitment and Project editors.
 *
 * The × used to drop the link the instant it was pressed, on the reasoning that one nullable column
 * needs no confirmation. What that missed is that Cancel then had nothing left to cancel: every
 * other field in these editors is held until Save, and a single field writing straight through made
 * Cancel a lie. So the × stages the clear here, **Save** performs it, and Cancel, Escape or closing
 * the editor discard it with the rest of the form — there is no undoing to do, because nothing was
 * written.
 *
 * `commitClear` runs **before** the update it is saved with, so that a refused clear leaves the node
 * exactly as it was rather than half-saved; see the editors' `handleSave`.
 */
export function useBeadsIdClear(onClearBeadsId: (() => Promise<void>) | undefined): Result {
  const [isCleared, setIsCleared] = useState(false);
  return {
    isCleared,
    stageClear: onClearBeadsId === undefined ? undefined : () => setIsCleared(true),
    commitClear: async () => {
      if (!isCleared || onClearBeadsId === undefined) return;
      await onClearBeadsId();
    },
  };
}
