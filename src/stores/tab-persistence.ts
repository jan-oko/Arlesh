import type { FilterState } from "@/utils/filter-tree";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { ListFilterState } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, isListPreset, withCurrentPillDimensions } from "@/utils/list-filter";
import type { ViewState } from "@/stores/use-view-store";
import type { TabState } from "@/stores/tab-stores";
import { DEFAULT_TAB_STATE } from "@/stores/tab-stores";
import { mergeFilterDefaults } from "@/stores/persist-merge";

/** Where the tab strip is written down. */
export const TABS_STORAGE_KEY = "arlesh-tabs";

/** The pre-tabs keys, read once to carry an existing session into its first tab. */
const LEGACY_VIEW_KEY = "arlesh-view";
const LEGACY_FILTER_KEY = "arlesh-filter";
const LEGACY_LIST_FILTER_KEY = "arlesh-list-filter";

/** One tab as it is written down: its identity, its label, and the state worth restoring. */
export interface PersistedTab {
  id: string;
  /** The subtree root's title when it was last on screen; `null` for the whole-tree tab. */
  title: string | null;
  state: TabState;
}

export interface PersistedTabs {
  tabs: PersistedTab[];
  activeTabId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads and parses a storage key, tolerating a missing key, a blocked store, and invalid JSON. */
function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Unwraps zustand's `persist` envelope (`{ state, version }`), which the legacy keys are written in. */
function persistedSlice(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const { state } = value;
  return isRecord(state) ? state : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readViewState(value: unknown): ViewState {
  const source = isRecord(value) ? value : {};
  const view = source["view"] === "list" ? "list" : "mindmap";
  const mindmapOrientation = source["mindmapOrientation"] === "vertical" ? "vertical" : "horizontal";
  return { view, mindmapOrientation };
}

/** A stored mindmap filter, with every field this build knows about present. */
function readFilterState(value: unknown): FilterState {
  return mergeFilterDefaults(value, DEFAULT_FILTER);
}

/**
 * A stored List View filter. Two backfills, because the shape has two levels: the flat fields come
 * from `mergeFilterDefaults`, and the pill map is rebuilt to today's dimensions on top — a stored
 * map replaces the default one wholesale, so a dimension added since would otherwise rehydrate as
 * `undefined` and a retired one would keep narrowing the list with no chip to clear it.
 */
function readListFilterState(value: unknown): ListFilterState {
  const merged = mergeFilterDefaults(value, DEFAULT_LIST_FILTER);
  const preset = isListPreset(merged.preset) ? merged.preset : DEFAULT_LIST_FILTER.preset;
  const pills = isRecord(merged.pills) ? merged.pills : {};
  return withCurrentPillDimensions({ preset, pills });
}

/** One tab's state as it comes back out of storage, rebuilt field by field so no stored shape
 * can leave a hole in it. The counterpart of `readTabState`, which reads a tab's *live* stores. */
export function parseTabState(value: unknown): TabState {
  const source = isRecord(value) ? value : {};
  return {
    subtreeRootId: readString(source["subtreeRootId"]),
    view: readViewState(source["view"]),
    filter: readFilterState(source["filter"]),
    listFilter: readListFilterState(source["listFilter"]),
  };
}

function readTab(value: unknown): PersistedTab | null {
  if (!isRecord(value)) return null;
  const id = readString(value["id"]);
  if (id === null) return null;
  return { id, title: readString(value["title"]), state: parseTabState(value["state"]) };
}

/** The pre-tabs path-icon preference, so turning tabs on does not silently reset it. */
export function legacyPathHeaderIcons(): boolean | null {
  const slice = persistedSlice(readJson(LEGACY_VIEW_KEY));
  if (slice === null) return null;
  const stored = slice["pathHeaderIcons"];
  return typeof stored === "boolean" ? stored : null;
}

/**
 * The single tab an existing user gets on their first run with tabs: the view, orientation and both
 * filter sets they already had. There was no stored subtree root before tabs, so it starts at the
 * whole tree — which is exactly where a pre-tabs session always reopened.
 */
export function legacyTabState(): TabState | null {
  const view = persistedSlice(readJson(LEGACY_VIEW_KEY));
  const filter = persistedSlice(readJson(LEGACY_FILTER_KEY));
  const listFilter = persistedSlice(readJson(LEGACY_LIST_FILTER_KEY));
  if (view === null && filter === null && listFilter === null) return null;
  return {
    subtreeRootId: null,
    view: readViewState(view),
    filter: readFilterState(filter?.["filter"]),
    listFilter: readListFilterState(listFilter?.["filter"]),
  };
}

/**
 * The stored tab strip, or `null` when there is nothing usable to restore — no key, a malformed
 * blob, or a tab list that came back empty. An `activeTabId` naming no surviving tab falls back to
 * the first, rather than leaving the app with no active tab at all.
 */
export function readPersistedTabs(): PersistedTabs | null {
  const raw = readJson(TABS_STORAGE_KEY);
  if (!isRecord(raw)) return null;
  const storedTabs = raw["tabs"];
  if (!Array.isArray(storedTabs)) return null;
  const tabs: PersistedTab[] = [];
  for (const value of storedTabs) {
    const tab = readTab(value);
    if (tab !== null) tabs.push(tab);
  }
  const first = tabs[0];
  if (first === undefined) return null;
  const storedActive = readString(raw["activeTabId"]);
  const activeTabId = storedActive !== null && tabs.some((t) => t.id === storedActive) ? storedActive : first.id;
  return { tabs, activeTabId };
}

/** Writes the strip down. A storage that refuses the write costs the restore, never the session. */
export function writePersistedTabs(value: PersistedTabs): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode, a full quota, or a blocked store: persistence is a convenience, not a dependency.
  }
}

/** The state a brand-new tab starts from, optionally rooted somewhere. */
export function freshTabState(subtreeRootId: string | null = null): TabState {
  return { ...DEFAULT_TAB_STATE, subtreeRootId };
}
