import type { FilterState } from "@/utils/filter-tree";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { ListFilterState } from "@/utils/list-filter";
import { DEFAULT_LIST_FILTER, isListPreset, withCurrentPillDimensions } from "@/utils/list-filter";
import type { ViewState } from "@/stores/use-view-store";
import type { TabState } from "@/stores/tab-stores";
import { DEFAULT_TAB_STATE } from "@/stores/tab-stores";
import { mergeFilterDefaults } from "@/stores/persist-merge";
import { BOOTSTRAP_WINDOW_LABEL } from "@/api/window-label";

/**
 * Where a window's tab strip is written down: one key per window, named after its label.
 *
 * Every window shares one `localStorage` — they are webviews on one origin — so the window's label
 * has to be in the key or the second window would overwrite the first's tabs. A key each rather
 * than one key holding every window's strip, because a key each is the only shape in which a
 * window writes **only its own**: read-modify-write on a shared key is a lost update the moment
 * two windows are edited at once, and two windows being used at once is the entire feature.
 *
 * The list of windows is deliberately *not* here. It is the backend's, because only the backend
 * can tell a window that was really closed from one hidden to the tray or taken down by a quit —
 * and a frontend that guessed would either resurrect a window the user closed or lose one they
 * did not. See `src-tauri/src/windows.rs`.
 */
export const WINDOW_TABS_KEY_PREFIX = "arlesh-window:";

/** The key `label`'s strip is stored under. */
export function windowTabsKey(label: string): string {
  return `${WINDOW_TABS_KEY_PREFIX}${label}`;
}

/**
 * Where the tab strip was written down when there was only ever one window.
 *
 * Read once, as the first window's strip, and then left alone. An upgrade must not cost anyone the
 * tabs they had open, and the window that inherits them is the one that would have had them: the
 * bootstrap window is the only window a pre-windows session ever had.
 */
export const TABS_STORAGE_KEY = "arlesh-tabs";

/** The pre-tabs keys, read once to carry an existing session into its first tab. */
const LEGACY_VIEW_KEY = "arlesh-view";
const LEGACY_FILTER_KEY = "arlesh-filter";
const LEGACY_LIST_FILTER_KEY = "arlesh-list-filter";

/** One tab as it is written down: its identity, its two labels, and the state worth restoring. */
export interface PersistedTab {
  id: string;
  /** The subtree root's title when it was last on screen; `null` for the whole-tree tab. */
  title: string | null;
  /** The name the user gave the tab, or `null` — including for a tab stored before names existed. */
  customTitle: string | null;
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

/** A stored list of node ids, tolerating a key written before the field existed. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
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
    expandedHabitGroupIds: readStringList(source["expandedHabitGroupIds"]),
  };
}

/** One tab as it comes back out of storage, or off a `tab-moved` event. `null` if it is neither. */
export function parsePersistedTab(value: unknown): PersistedTab | null {
  if (!isRecord(value)) return null;
  const id = readString(value["id"]);
  if (id === null) return null;
  // `customTitle` post-dates the first stored strips, so a blob written without it must read as an
  // unnamed tab rather than letting `undefined` through to a label that would render as nothing.
  return {
    id,
    title: readString(value["title"]),
    customTitle: readString(value["customTitle"]),
    state: parseTabState(value["state"]),
  };
}

/** The pre-tabs path-icon preference, so turning tabs on does not silently reset it. */
export function legacyPathHeaderIcons(): boolean | null {
  const slice = persistedSlice(readJson(LEGACY_VIEW_KEY));
  if (slice === null) return null;
  const stored = slice["pathHeaderIcons"];
  return typeof stored === "boolean" ? stored : null;
}

/**
 * The pre-windows strip, for the bootstrap window only. See {@link readPersistedTabs}.
 */
function legacyStrip(label: string): unknown {
  return label === BOOTSTRAP_WINDOW_LABEL ? readJson(TABS_STORAGE_KEY) : null;
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
    expandedHabitGroupIds: [],
  };
}

/**
 * The strip stored for `label`, or `null` when there is nothing usable to restore — no key, a
 * malformed blob, or a tab list that came back empty. An `activeTabId` naming no surviving tab
 * falls back to the first, rather than leaving the window with no active tab at all.
 *
 * The **bootstrap window** falls back to the pre-windows key when it has no strip of its own, so
 * that the first launch after this change opens the tabs the last launch before it had. No other
 * window does: a torn-off window with no stored strip is one whose strip was legitimately never
 * written, and handing it somebody else's tabs would be worse than giving it a fresh one.
 */
export function readPersistedTabs(label: string): PersistedTabs | null {
  const raw = readJson(windowTabsKey(label)) ?? legacyStrip(label);
  if (!isRecord(raw)) return null;
  const storedTabs = raw["tabs"];
  if (!Array.isArray(storedTabs)) return null;
  const tabs: PersistedTab[] = [];
  for (const value of storedTabs) {
    const tab = parsePersistedTab(value);
    if (tab !== null) tabs.push(tab);
  }
  const first = tabs[0];
  if (first === undefined) return null;
  const storedActive = readString(raw["activeTabId"]);
  const activeTabId = storedActive !== null && tabs.some((t) => t.id === storedActive) ? storedActive : first.id;
  return { tabs, activeTabId };
}

/** Writes `label`'s strip down. A storage that refuses the write costs the restore, never the session. */
export function writePersistedTabs(label: string, value: PersistedTabs): void {
  try {
    localStorage.setItem(windowTabsKey(label), JSON.stringify(value));
  } catch {
    // Private mode, a full quota, or a blocked store: persistence is a convenience, not a dependency.
  }
}

/** Drops `label`'s strip, for a window that is closing for good. */
export function forgetPersistedTabs(label: string): void {
  try {
    localStorage.removeItem(windowTabsKey(label));
  } catch {
    // As above: a store that will not answer costs the tidy-up, nothing else.
  }
}

/**
 * Every window label that currently has a strip in storage.
 *
 * For the tidy-up at startup: a window closed while another stayed open leaves its strip behind,
 * and over months of tearing tabs off those add up. It is a **synchronous snapshot** on purpose —
 * the live window list comes back from the backend a moment later, and deleting whatever is stale
 * *then* would be racing a tear-off, which writes a new window's strip before that window exists.
 * Only a label that was already stored before the question was asked can be answered about.
 */
export function persistedWindowLabels(): string[] {
  const labels: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null && key.startsWith(WINDOW_TABS_KEY_PREFIX)) {
        labels.push(key.slice(WINDOW_TABS_KEY_PREFIX.length));
      }
    }
  } catch {
    // As above: a store that will not answer has no strips to tidy up as far as we can tell.
  }
  return labels;
}

/** The state a brand-new tab starts from, optionally rooted somewhere. */
export function freshTabState(subtreeRootId: string | null = null): TabState {
  return { ...DEFAULT_TAB_STATE, subtreeRootId };
}
