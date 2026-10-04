import { createStore, type StoreApi } from "zustand";
import type { FilterState, OverrideMode, StatusMode, TagFilterMode } from "@/utils/filter-tree";
import { DEFAULT_FILTER, NEXT_OVERRIDE_MODE, delegatedModeOf } from "@/utils/filter-tree";
import { tabStoreHook } from "@/stores/tab-stores-context";
import { nextMode } from "@/utils/filter-modes";
import type { ScopeKey } from "@/api/scopes";

export interface FilterStore {
  filter: FilterState;
  /** Whether the top-bar filter popover is open (ephemeral UI state — not persisted). */
  popoverOpen: boolean;
  toggleFilterPopover: () => void;
  setFilterPopover: (open: boolean) => void;
  /** Whether the `Ctrl+F` filter search is open (ephemeral UI state — not persisted). */
  searchOpen: boolean;
  setFilterSearch: (open: boolean) => void;
  setStatusMode: (mode: StatusMode) => void;
  toggleModeFlows: () => void;
  /** Sets or clears (`null`) the Plan preset's scope narrowing. */
  setPlanScope: (scope: ScopeKey | null) => void;
  /** Adds a tag filter in `mode`; no-op when the tag is already filtered. */
  addTagFilter: (tagId: number, mode: TagFilterMode) => void;
  setTagFilterMode: (tagId: number, mode: TagFilterMode) => void;
  /** Moves a tag filter one step along All → Any → Not. */
  cycleTagFilter: (tagId: number) => void;
  removeTagFilter: (tagId: number) => void;
  toggleShowInfo: () => void;
  toggleShowFlow: () => void;
  /** Shows or hides Agentic Tasks an agent holds (On Agent) under Start, Do and the Zen View. */
  toggleShowOnAgent: () => void;
  togglePrivateMode: () => void;
  setPrivateMode: (on: boolean) => void;
  cycleArchivedMode: () => void;
  cycleBacklogMode: () => void;
  setArchivedMode: (mode: OverrideMode) => void;
  setBacklogMode: (mode: OverrideMode) => void;
  /** The Delegated pill: off → include → exclude. */
  cycleDelegatedMode: () => void;
  setDelegatedMode: (mode: OverrideMode) => void;
  reset: () => void;
}

/** One tab's mindmap filter state (status preset, tag filters, type visibility). */
export function createFilterStore(seed: FilterState = DEFAULT_FILTER): StoreApi<FilterStore> {
  return createStore<FilterStore>()((set) => ({
    filter: seed,
    popoverOpen: false,
    toggleFilterPopover: () => set((s) => ({ popoverOpen: !s.popoverOpen })),
    setFilterPopover: (open) => set({ popoverOpen: open }),
    searchOpen: false,
    setFilterSearch: (open) => set({ searchOpen: open }),
    setStatusMode: (mode) => set((s) => ({ filter: { ...s.filter, statusMode: mode } })),
    toggleModeFlows: () => set((s) => ({ filter: { ...s.filter, modeIncludeFlows: !s.filter.modeIncludeFlows } })),
    setPlanScope: (scope) => set((s) => ({ filter: { ...s.filter, planScope: scope } })),
    addTagFilter: (tagId, mode) =>
      set((s) =>
        s.filter.tagFilters.some((t) => t.tagId === tagId)
          ? {}
          : { filter: { ...s.filter, tagFilters: [...s.filter.tagFilters, { tagId, mode }] } },
      ),
    cycleTagFilter: (tagId) =>
      set((s) => ({
        filter: {
          ...s.filter,
          tagFilters: s.filter.tagFilters.map((t) => (t.tagId === tagId ? { ...t, mode: nextMode(t.mode) } : t)),
        },
      })),
    setTagFilterMode: (tagId, mode) =>
      set((s) => ({ filter: { ...s.filter, tagFilters: s.filter.tagFilters.map((t) => (t.tagId === tagId ? { ...t, mode } : t)) } })),
    removeTagFilter: (tagId) =>
      set((s) => ({ filter: { ...s.filter, tagFilters: s.filter.tagFilters.filter((t) => t.tagId !== tagId) } })),
    toggleShowInfo: () => set((s) => ({ filter: { ...s.filter, showInfo: !s.filter.showInfo } })),
    toggleShowFlow: () => set((s) => ({ filter: { ...s.filter, showFlow: !s.filter.showFlow } })),
    toggleShowOnAgent: () => set((s) => ({ filter: { ...s.filter, showOnAgent: s.filter.showOnAgent !== true } })),
    togglePrivateMode: () => set((s) => ({ filter: { ...s.filter, privateMode: !s.filter.privateMode } })),
    setPrivateMode: (on) => set((s) => ({ filter: { ...s.filter, privateMode: on } })),
    setArchivedMode: (mode) => set((s) => ({ filter: { ...s.filter, archivedMode: mode } })),
    setBacklogMode: (mode) => set((s) => ({ filter: { ...s.filter, backlogMode: mode } })),
    cycleArchivedMode: () =>
      set((s) => ({ filter: { ...s.filter, archivedMode: NEXT_OVERRIDE_MODE[s.filter.archivedMode] } })),
    cycleBacklogMode: () =>
      set((s) => ({ filter: { ...s.filter, backlogMode: NEXT_OVERRIDE_MODE[s.filter.backlogMode] } })),
    setDelegatedMode: (mode) => set((s) => ({ filter: { ...s.filter, delegatedMode: mode } })),
    cycleDelegatedMode: () =>
      set((s) => ({ filter: { ...s.filter, delegatedMode: NEXT_OVERRIDE_MODE[delegatedModeOf(s.filter)] } })),
    reset: () => set({ filter: DEFAULT_FILTER }),
  }));
}

export const useFilterStore = tabStoreHook<FilterStore>((stores) => stores.filter);
