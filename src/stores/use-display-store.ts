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
 * How much of a Habit's past you want to see at once is a preference about reading the map, not
 * about where one tab is — finding a different threshold in the next tab would read as a bug. So
 * is *Asynchronous first*: whether work that starts a wait should lead its run is a statement
 * about how you like to read a list.
 *
 * A stored blob may still carry `pathHeaderIcons`, the path-header glyph switch that used to live
 * here. Nothing reads it any more; it is left where it lies rather than migrated away, because a
 * key nobody asks about costs nothing and rewriting someone's stored settings to drop one does.
 */
export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      habitCollapseThreshold: DEFAULT_HABIT_COLLAPSE_THRESHOLD,
      setHabitCollapseThreshold: (value) => set({ habitCollapseThreshold: clampThreshold(value) }),
      asynchronousFirst: false,
      toggleAsynchronousFirst: () => set((s) => ({ asynchronousFirst: !s.asynchronousFirst })),
    }),
    { name: "arlesh-display" },
  ),
);
