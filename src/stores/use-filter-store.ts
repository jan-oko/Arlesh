import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FilterState, StatusMode, TagFilterMode } from "@/utils/filter-tree";
import { DEFAULT_FILTER, NEXT_ARCHIVED_MODE } from "@/utils/filter-tree";

interface FilterStore {
  filter: FilterState;
  /** Whether the top-bar filter popover is open (ephemeral UI state — not persisted). */
  popoverOpen: boolean;
  toggleFilterPopover: () => void;
  setFilterPopover: (open: boolean) => void;
  setStatusMode: (mode: StatusMode) => void;
  toggleModeFlows: () => void;
  addTagFilter: (tagId: number) => void;
  setTagFilterMode: (tagId: number, mode: TagFilterMode) => void;
  removeTagFilter: (tagId: number) => void;
  toggleShowInfo: () => void;
  toggleShowFlow: () => void;
  toggleWorkMode: () => void;
  cycleArchivedMode: () => void;
  reset: () => void;
}

/** Persisted mindmap filter state (status preset, tag filters, type visibility). */
export const useFilterStore = create<FilterStore>()(
  persist(
    (set) => ({
      filter: DEFAULT_FILTER,
      popoverOpen: false,
      toggleFilterPopover: () => set((s) => ({ popoverOpen: !s.popoverOpen })),
      setFilterPopover: (open) => set({ popoverOpen: open }),
      setStatusMode: (mode) => set((s) => ({ filter: { ...s.filter, statusMode: mode } })),
      toggleModeFlows: () => set((s) => ({ filter: { ...s.filter, modeIncludeFlows: !s.filter.modeIncludeFlows } })),
      addTagFilter: (tagId) =>
        set((s) =>
          s.filter.tagFilters.some((t) => t.tagId === tagId)
            ? {}
            : { filter: { ...s.filter, tagFilters: [...s.filter.tagFilters, { tagId, mode: "any" as TagFilterMode }] } },
        ),
      setTagFilterMode: (tagId, mode) =>
        set((s) => ({ filter: { ...s.filter, tagFilters: s.filter.tagFilters.map((t) => (t.tagId === tagId ? { ...t, mode } : t)) } })),
      removeTagFilter: (tagId) =>
        set((s) => ({ filter: { ...s.filter, tagFilters: s.filter.tagFilters.filter((t) => t.tagId !== tagId) } })),
      toggleShowInfo: () => set((s) => ({ filter: { ...s.filter, showInfo: !s.filter.showInfo } })),
      toggleShowFlow: () => set((s) => ({ filter: { ...s.filter, showFlow: !s.filter.showFlow } })),
      toggleWorkMode: () => set((s) => ({ filter: { ...s.filter, workMode: !s.filter.workMode } })),
      cycleArchivedMode: () =>
        set((s) => ({ filter: { ...s.filter, archivedMode: NEXT_ARCHIVED_MODE[s.filter.archivedMode] } })),
      reset: () => set({ filter: DEFAULT_FILTER }),
    }),
    { name: "arlesh-filter", partialize: (state) => ({ filter: state.filter }) },
  ),
);
