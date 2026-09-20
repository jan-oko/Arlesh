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
 * you want to see at once is a preference about reading the map, not about where one tab is.
 */
export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      pathHeaderIcons: legacyPathHeaderIcons() ?? true,
      togglePathHeaderIcons: () => set((s) => ({ pathHeaderIcons: !s.pathHeaderIcons })),
      habitCollapseThreshold: DEFAULT_HABIT_COLLAPSE_THRESHOLD,
      setHabitCollapseThreshold: (value) => set({ habitCollapseThreshold: clampThreshold(value) }),
    }),
    { name: "arlesh-display" },
  ),
);
