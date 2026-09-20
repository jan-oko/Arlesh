import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the verdict bindings act on. */
export interface ListCommitmentContext extends ListSelectionContext {
  /** Advances the selected Commitment's verdict: Unresolved → Kept → Broken → Unresolved. */
  onCycleVerdict: (id: string) => void;
  /** Records that it was not held to, or clears an existing Broken. */
  onMarkBroken: (id: string) => void;
}

export const LIST_COMMITMENT_BINDINGS: readonly Binding<ListCommitmentContext>[] = [
  {
    // Shares Enter with `listView.cycleStatus`, and the two cannot both fire: a selection is a
    // Task or a Commitment, never both. The same key means "advance the status" on one and
    // "advance the verdict" on the other, which is the same gesture read in each kind's own terms.
    id: "listView.cycleVerdict", section: "listView", chord: { code: "Enter" },
    labelKey: "cycleVerdict",
    when: (c) => c.selectedCommitmentId !== null,
    run: (c) => { if (c.selectedCommitmentId !== null) c.onCycleVerdict(c.selectedCommitmentId); },
  },
  {
    // Kept in its own right even though Enter now cycles past Broken: this is the one-press route
    // to Broken, so recording a broken commitment never has to pass through saying you kept it.
    id: "listView.markBroken", section: "listView", chord: { code: "KeyX" },
    labelKey: "markBroken",
    when: (c) => c.selectedCommitmentId !== null,
    run: (c) => { if (c.selectedCommitmentId !== null) c.onMarkBroken(c.selectedCommitmentId); },
  },
];
