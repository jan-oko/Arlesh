import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ListFilterState, ListPreset, PillDimension, PillMode } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, withCurrentPillDimensions } from "@/utils/list-filter";
import { mergePersistedFilterSlice } from "@/stores/persist-merge";

interface ListFilterStore {
  filter: ListFilterState;
  setPreset: (preset: ListPreset) => void;
  addPill: (dimension: PillDimension, value: string) => void;
  setPillMode: (dimension: PillDimension, value: string, mode: PillMode) => void;
  removePill: (dimension: PillDimension, value: string) => void;
  reset: () => void;
}

/** Persisted List View filter state: its own preset selector and the List-View-exclusive pill
 * filters (parent/dependency/statuses/scope/blocked/agentic). Status preset, tag filters, and Info/Flow/Private
 * toggles are shared with the Mindmap via useFilterStore. */
export const useListFilterStore = create<ListFilterStore>()(
  persist(
    (set) => ({
      filter: DEFAULT_LIST_FILTER,
      setPreset: (preset) => set((s) => ({ filter: { ...s.filter, preset } })),
      addPill: (dimension, value) =>
        set((s) => {
          const existing = s.filter.pills[dimension];
          if (existing.some((p) => p.value === value)) return {};
          return {
            filter: {
              ...s.filter,
              pills: { ...s.filter.pills, [dimension]: [...existing, { value, mode: "any" as PillMode }] },
            },
          };
        }),
      setPillMode: (dimension, value, mode) =>
        set((s) => ({
          filter: {
            ...s.filter,
            pills: {
              ...s.filter.pills,
              [dimension]: s.filter.pills[dimension].map((p) => (p.value === value ? { ...p, mode } : p)),
            },
          },
        })),
      removePill: (dimension, value) =>
        set((s) => ({
          filter: {
            ...s.filter,
            pills: { ...s.filter.pills, [dimension]: s.filter.pills[dimension].filter((p) => p.value !== value) },
          },
        })),
      reset: () => set({ filter: DEFAULT_LIST_FILTER }),
    }),
    {
      name: "arlesh-list-filter",
      partialize: (state) => ({ filter: state.filter }),
      // The persisted `pills` object replaces the default one wholesale, so it is also normalized
      // back to today's dimensions — a stale one (Antecedent, now subtree entry) would otherwise
      // keep narrowing the list with no chip to show it and no control to clear it.
      merge: (persistedState, currentState) => ({
        ...currentState,
        filter: withCurrentPillDimensions(mergePersistedFilterSlice(persistedState, DEFAULT_LIST_FILTER)),
      }),
    },
  ),
);
