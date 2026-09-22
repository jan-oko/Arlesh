import { create } from "zustand";
import { persist } from "zustand/middleware";
import { legacyPathHeaderIcons } from "@/stores/tab-persistence";
import {
  DEFAULT_HABIT_COLLAPSE_THRESHOLD,
  MAX_HABIT_COLLAPSE_THRESHOLD,
  MIN_HABIT_COLLAPSE_THRESHOLD,
} from "@/utils/habit-collapse";

interface DisplayStore {
  /** Whether a List View path header opens with its nearest ancestor's kind glyph. Default on. */
  pathHeaderIcons: boolean;
  togglePathHeaderIcons: () => void;
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
 * Path glyphs are a matter of taste about how the List View reads, the way the theme is: turning
 * them off in one tab and finding them back on in the next would read as a bug. They used to live
 * in `use-view-store`, which became per-tab when tabs landed, so they moved out rather than
 * silently becoming per-tab with it — `legacyPathHeaderIcons` carries a pre-tabs choice across.
 *
 * The Habit-history collapse threshold joins them for the same reason: how much of a Habit's past
 * you want to see at once is a preference about reading the map, not about where one tab is. So
 * does *Asynchronous first*: whether work that starts a wait should lead its run is a statement
 * about how you like to read a list, and finding it off again in the next tab would read as a bug.
 *
 * The Plan View's four kebab switches join them on the same reasoning, and deliberately did **not**
 * become per-tab when they moved out of the gear popover into the two panes' own menus. A filter is
 * a question about the board and belongs to the tab asking it; these are questions about how the
 * Plan View reads, and a pass that came up shaped differently because it was started from another
 * tab would read as a bug rather than as a setting.
 */
export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      pathHeaderIcons: legacyPathHeaderIcons() ?? true,
      togglePathHeaderIcons: () => set((s) => ({ pathHeaderIcons: !s.pathHeaderIcons })),
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
      planIncludePremorning: false,
      togglePlanIncludePremorning: () =>
        set((s) => ({ planIncludePremorning: !s.planIncludePremorning })),
    }),
    { name: "arlesh-display" },
  ),
);
