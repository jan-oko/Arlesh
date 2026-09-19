import { create } from "zustand";
import { persist } from "zustand/middleware";
import { legacyPathHeaderIcons } from "@/stores/tab-persistence";

interface DisplayStore {
  /** Whether a List View path header opens with its nearest ancestor's kind glyph. Default on. */
  pathHeaderIcons: boolean;
  togglePathHeaderIcons: () => void;
}

/**
 * Display preferences that belong to the **app**, not to any one tab.
 *
 * Path glyphs are a matter of taste about how the List View reads, the way the theme is: turning
 * them off in one tab and finding them back on in the next would read as a bug. They used to live
 * in `use-view-store`, which became per-tab when tabs landed, so they moved out rather than
 * silently becoming per-tab with it — `legacyPathHeaderIcons` carries a pre-tabs choice across.
 */
export const useDisplayStore = create<DisplayStore>()(
  persist(
    (set) => ({
      pathHeaderIcons: legacyPathHeaderIcons() ?? true,
      togglePathHeaderIcons: () => set((s) => ({ pathHeaderIcons: !s.pathHeaderIcons })),
    }),
    { name: "arlesh-display" },
  ),
);
