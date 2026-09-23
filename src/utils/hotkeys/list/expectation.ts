import type { Binding } from "@/utils/hotkeys/chord";
import type { ListSelectionContext } from "./selection";

/** What the Expectation bindings act on. */
export interface ListExpectationContext extends ListSelectionContext {
  /** Whether the selected Task row is a wait's virtual check task. */
  isSelectedCheckTask: boolean;
  /** Releases the selected Expectation, or takes a release back. */
  onToggleRelease: (id: string) => void;
  /** Completes the check: clears the check-by of the selected wait, or of the check task's wait. */
  onCompleteCheck: (id: string) => void;
  /** Selects the List View's **Expectations** option, leaving the shared status preset untouched. */
  onSetExpectationsPreset: () => void;
  /** Marks the selected Task Asynchronous and binds it to a new wait it depends on. */
  onBindWait: (id: string) => void;
  /** Opens the new-Expectation editor for a wait under the selected row. */
  onCreateExpectation: (id: string) => void;
}

export const LIST_EXPECTATION_BINDINGS: readonly Binding<ListExpectationContext>[] = [
  {
    // The Mindmap's create chord for a wait. The List View otherwise creates Tasks alone; a wait is
    // configured in its editor before it exists, since a row has no inline title to fill.
    id: "listView.createExpectation", section: "listView", chord: { code: "KeyE", shift: true },
    labelKey: "createExpectationChild", allowRepeat: false,
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onCreateExpectation(c.selectedRowId); },
  },
  {
    id: "listView.bindWait", section: "listView", chord: { code: "KeyW", shift: true },
    labelKey: "bindWait", allowRepeat: false,
    when: (c) => c.selectedRowId !== null,
    run: (c) => { if (c.selectedRowId !== null) c.onBindWait(c.selectedRowId); },
  },
  {
    // Shares Enter with `listView.cycleStatus` and `listView.cycleVerdict`, on a complementary
    // guard: a selection is a Task, a Commitment or an Expectation, never two of them. Enter
    // advances each in its own terms — a wait's only step is being released.
    id: "listView.toggleReleaseEnter", section: "listView", chord: { code: "Enter" },
    labelKey: "toggleRelease",
    when: (c) => c.selectedExpectationId !== null,
    run: (c) => { if (c.selectedExpectationId !== null) c.onToggleRelease(c.selectedExpectationId); },
  },
  {
    // The Mindmap's key for it, on the same reasoning: L for "reLease", free in both views.
    id: "listView.toggleRelease", section: "listView", chord: { code: "KeyL" },
    labelKey: "toggleRelease",
    when: (c) => c.selectedExpectationId !== null,
    run: (c) => { if (c.selectedExpectationId !== null) c.onToggleRelease(c.selectedExpectationId); },
  },
  {
    // D for "done checking", as on the Mindmap. On a wait, or on its check task's row.
    id: "listView.completeCheck", section: "listView", chord: { code: "KeyD" },
    labelKey: "completeCheck",
    when: (c) => c.selectedExpectationId !== null || (c.selectedTaskId !== null && c.isSelectedCheckTask),
    run: (c) => {
      const id = c.selectedExpectationId ?? c.selectedTaskId;
      if (id !== null) c.onCompleteCheck(id);
    },
  },
  {
    // Alt+E, the List View's second option that is not a status preset — Unblock's neighbour, and
    // like it, it writes the list's own preset and leaves the shared one for the Mindmap.
    id: "listView.preset.expectations", section: "listView", chord: { code: "KeyE", alt: true },
    labelKey: "statusExpectations", run: (c) => c.onSetExpectationsPreset(),
  },
];
