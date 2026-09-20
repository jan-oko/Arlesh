import { createStore, type StoreApi } from "zustand";
import type { ListFilterState, ListPreset, PillDimension, PillMode, PillSide } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, pillSide } from "@/utils/list-filter";
import { tabStoreHook } from "@/stores/tab-stores-context";

export interface ListFilterStore {
  filter: ListFilterState;
  setPreset: (preset: ListPreset) => void;
  addPill: (dimension: PillDimension, value: string) => void;
  setPillMode: (dimension: PillDimension, value: string, mode: PillMode) => void;
  setPillSide: (dimension: PillDimension, value: string, side: PillSide) => void;
  removePill: (dimension: PillDimension, value: string) => void;
  reset: () => void;
}

/** One tab's List View filter state: its own preset selector and the List-View-exclusive pill
 * filters (antecedent/dependency/statuses/scope/blocked/agentic). Status preset, tag filters, and Info/Flow/Private
 * toggles are shared with that tab's Mindmap via its `useFilterStore`.
 *
 * `addPill` is the popover's verb — "this value is now a filter, start it neutral" — and it no-ops
 * on a value already filtered. `setPillSide` is the verb for a gesture that states an *answer*
 * ("filter to this", "filter this out"): it is idempotent rather than additive, so the same gesture
 * twice leaves the same filter, and the opposite gesture moves the pill across instead of adding a
 * second one for the same value. */
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
    setPillSide: (dimension, value, side) =>
      set((s) => {
        const existing = s.filter.pills[dimension];
        const current = existing.find((p) => p.value === value);
        // Already pointing the asked-for way: leave it alone rather than rewrite its mode. An `all`
        // pill and an `any` pill both keep the value in, so a second "filter to this" must not
        // quietly undo an intersection the user set on the chip — the gesture asks for a side, and
        // the side is already what it asks for.
        if (current !== undefined && pillSide(current.mode) === side) return {};
        const mode: PillMode = side === "exclude" ? "exclude" : "any";
        const next = current === undefined
          ? [...existing, { value, mode }]
          : existing.map((p) => (p.value === value ? { ...p, mode } : p));
        return { filter: { ...s.filter, pills: { ...s.filter.pills, [dimension]: next } } };
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
