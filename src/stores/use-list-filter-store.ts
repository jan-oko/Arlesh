import { createStore, type StoreApi } from "zustand";
import type { ListFilterState, ListPreset, PillDimension, PillMode } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { tabStoreHook } from "@/stores/tab-stores-context";

export interface ListFilterStore {
  filter: ListFilterState;
  setPreset: (preset: ListPreset) => void;
  addPill: (dimension: PillDimension, value: string) => void;
  setPillMode: (dimension: PillDimension, value: string, mode: PillMode) => void;
  removePill: (dimension: PillDimension, value: string) => void;
  reset: () => void;
}

/** One tab's List View filter state: its own preset selector and the List-View-exclusive pill
 * filters (parent/dependency/statuses/scope/blocked/agentic). Status preset, tag filters, and Info/Flow/Private
 * toggles are shared with that tab's Mindmap via its `useFilterStore`. */
export function createListFilterStore(seed: ListFilterState = DEFAULT_LIST_FILTER): StoreApi<ListFilterStore> {
  return createStore<ListFilterStore>()((set) => ({
    filter: seed,
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
  }));
}

export const useListFilterStore = tabStoreHook<ListFilterStore>((stores) => stores.listFilter);
