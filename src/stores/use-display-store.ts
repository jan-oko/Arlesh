import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_HABIT_COLLAPSE_THRESHOLD,
  MAX_HABIT_COLLAPSE_THRESHOLD,
  MIN_HABIT_COLLAPSE_THRESHOLD,
} from "@/utils/habit-collapse";

interface DisplayStore {
  /**
   * How many consecutive passed Habit iterations it takes before the Mindmap folds them into one
   * node. Applies to every Habit; a run shorter than this draws its iterations directly.
   */
  habitCollapseThreshold: number;
  setHabitCollapseThreshold: (value: number) => void;
  /**
   * Whether the List View collects the asynchronous work into its own section at the top.
   *
   * **Off by default.** Row order is something the tree already answers, and quietly rearranging it
   * for everyone would be a change nobody asked for — so manual ordering is untouched, and no
   * section is drawn, until this is turned on.
   */
  asynchronousFirst: boolean;
  toggleAsynchronousFirst: () => void;
  /**
   * Whether the Plan View's **candidates** pane draws a path header above each run of rows sharing
   * a location, as the List View does.
   *
   * **On by default**, and the candidates pane only: that pane is read for *where* work lives, and
   * the planned pane opposite it is read for *when*, which is the question its own switch answers.
   *
   * The name is not `planPathGrouping`, which this replaces, so that the stored preference of
   * anyone who used the first cut of the view is ignored and this default actually applies —
   * `persist` merges what it finds over the initial state, and what it found was an off switch
   * nobody chose.
   */
  planCandidatesPathGrouping: boolean;
  togglePlanCandidatesPathGrouping: () => void;
  /**
   * Whether the **candidates** pane shows only the work planned to the parent scope — the work this
   * pass has not placed yet — rather than that plus the unplanned pool.
   *
   * **On by default**, so a pass opens on *what still needs placing*. Untick to see unplanned work
   * too. The other way round — always showing the unplanned pool and merely adding the
   * parent-planned work to it — was considered and rejected: the pool is the same however long the
   * pass runs, and it would bury the one list that shrinks as you work.
   */
  planCandidatesParentOnly: boolean;
  togglePlanCandidatesParentOnly: () => void;
  /**
   * Whether the Plan View's **planned** pane splits into one section per subscope: the weeks of a
   * month, the days of a week, the bands of a day.
   *
   * **Off by default.** The candidates pane is never split — the work waiting there sits in no
   * subscope, which is exactly why it is waiting.
   */
  planSubscopeSplit: boolean;
  togglePlanSubscopeSplit: () => void;
  /**
   * Whether the List View draws Commitments and Expectations in **bands** above the task rows
   * (on, the default — the shape the Commitments band already had) or as **ordinary rows** among
   * them, at their place in the tree. One switch for both kinds: they are the two non-task kinds
   * the list shows, and a list mixing the two shapes would read as two different lists. Either way
   * a row looks and works the same; only where it sits changes.
   */
  listBands: boolean;
  toggleListBands: () => void;
  /**
   * Whether marking a Task **Asynchronous** opens the new-Expectation editor for the wait it
   * starts, which the Task then depends on. **Off by default**: the flag says only that doing the
   * Task starts a wait, and naming the wait is a step not everyone wants every time.
   */
  asynchronousOpensExpectation: boolean;
  toggleAsynchronousOpensExpectation: () => void;
  /**
   * Whether completing an Asynchronous Task that has no Expectation yet offers to create one.
   * **Off by default**, for the same reason.
   */
  offerExpectationOnAsyncDone: boolean;
  toggleOfferExpectationOnAsyncDone: () => void;
  /**
   * Whether a Day's **Premorning** band is drawn as a bucket of the split.
   *
   * **Off by default**: 02:00–06:00 is not where work gets planned, and a bucket nobody fills is a
   * sixth of the pane spent saying so. It appears regardless while something is planned into it.
   */
  planIncludePremorning: boolean;
  togglePlanIncludePremorning: () => void;
}

/** Keeps a stored or typed threshold inside the range the setting offers. */
function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HABIT_COLLAPSE_THRESHOLD;
  const whole = Math.round(value);
  if (whole < MIN_HABIT_COLLAPSE_THRESHOLD) return MIN_HABIT_COLLAPSE_THRESHOLD;
  if (whole > MAX_HABIT_COLLAPSE_THRESHOLD) return MAX_HABIT_COLLAPSE_THRESHOLD;
  return whole;
}

/**
 * Display preferences that belong to the **app**, not to any one tab.
 *
 * The Habit-history collapse threshold is here for that reason: how much of a Habit's past you want
 * to see at once is a preference about reading the map, not about where one tab is. So is
 * *Asynchronous first*: whether work that starts a wait should lead its run is a statement about
 * how you like to read a list, and finding it off again in the next tab would read as a bug.
 *
 * The Plan View's four kebab switches join them on the same reasoning, and deliberately did **not**
 * become per-tab when they moved out of the gear popover into the two panes' own menus. A filter is
 * a question about the board and belongs to the tab asking it; these are questions about how the
 * Plan View reads, and a pass that came up shaped differently because it was started from another
 * tab would read as a bug rather than as a setting.
 *
 * A stored blob may still carry `pathHeaderIcons`, the path-header glyph switch that used to live
 * here, and `planPathGrouping`, the first cut of the Plan View's path switch. Nothing reads either
 * any more; they are left where they lie rather than migrated away, because a key nobody asks about
 * costs nothing and rewriting someone's stored settings to drop one does.
 */
export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      habitCollapseThreshold: DEFAULT_HABIT_COLLAPSE_THRESHOLD,
      setHabitCollapseThreshold: (value) => set({ habitCollapseThreshold: clampThreshold(value) }),
      asynchronousFirst: false,
      toggleAsynchronousFirst: () => set((s) => ({ asynchronousFirst: !s.asynchronousFirst })),
      planCandidatesPathGrouping: true,
      togglePlanCandidatesPathGrouping: () =>
        set((s) => ({ planCandidatesPathGrouping: !s.planCandidatesPathGrouping })),
      planCandidatesParentOnly: true,
      togglePlanCandidatesParentOnly: () =>
        set((s) => ({ planCandidatesParentOnly: !s.planCandidatesParentOnly })),
      planSubscopeSplit: false,
      togglePlanSubscopeSplit: () => set((s) => ({ planSubscopeSplit: !s.planSubscopeSplit })),
      listBands: true,
      toggleListBands: () => set((s) => ({ listBands: !s.listBands })),
      asynchronousOpensExpectation: false,
      toggleAsynchronousOpensExpectation: () =>
        set((s) => ({ asynchronousOpensExpectation: !s.asynchronousOpensExpectation })),
      offerExpectationOnAsyncDone: false,
      toggleOfferExpectationOnAsyncDone: () =>
        set((s) => ({ offerExpectationOnAsyncDone: !s.offerExpectationOnAsyncDone })),
      planIncludePremorning: false,
      togglePlanIncludePremorning: () =>
        set((s) => ({ planIncludePremorning: !s.planIncludePremorning })),
    }),
    { name: "arlesh-display" },
  ),
);
