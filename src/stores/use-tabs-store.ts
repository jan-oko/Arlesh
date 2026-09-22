import { create } from "zustand";
import type { TabState, TabStores } from "@/stores/tab-stores";
import { createTabStores, readTabState } from "@/stores/tab-stores";
import { setActiveTabStores } from "@/stores/tab-stores-context";
import type { PersistedTab } from "@/stores/tab-persistence";
import {
  freshTabState, legacyTabState, readPersistedTabs, writePersistedTabs,
} from "@/stores/tab-persistence";
import { BOOTSTRAP_WINDOW_LABEL, currentWindowLabel } from "@/api/window";

/**
 * Which window this store is the tab strip of.
 *
 * Read once, at module scope, because it never changes: a webview belongs to one window for its
 * whole life. Every window runs its own copy of this module over its own key in the one shared
 * `localStorage`, which is the whole of what keeps two windows' tabs apart — the store itself never
 * learns that there is more than one window.
 */
const WINDOW_LABEL = currentWindowLabel();

/** One open tab: an identity, the two labels it may carry, and its own stores. */
export interface Tab {
  id: string;
  /** The subtree root's title, or `null` for a tab showing the whole tree. Derived, and rewritten
   * from the subtree descriptor every time the tab is navigated — never a place to put a name. */
  title: string | null;
  /** The name the user gave this tab, which wins over `title` while it is set; `null` when none. */
  customTitle: string | null;
  stores: TabStores;
}

interface TabsStore {
  tabs: Tab[];
  activeTabId: string;
  /** Opens a tab after the active one and activates it. Returns its id. */
  openTab: (state?: TabState) => string;
  /** Closes a tab. Returns false — and changes nothing — when it is the only tab left. */
  closeTab: (id: string) => boolean;
  activateTab: (id: string) => void;
  /** Activates the nth tab (0-based); a position past the end does nothing. */
  activateAt: (index: number) => void;
  /** Moves `delta` tabs along the strip, wrapping at both ends. */
  cycleTab: (delta: number) => void;
  /** Reorders the strip by dropping the tab at `fromIndex` at `toIndex`. */
  moveTab: (fromIndex: number, toIndex: number) => void;
  setTabTitle: (id: string, title: string | null) => void;
  /** Names a tab, or — given a blank name — takes the name off and hands it back to `title`. */
  renameTab: (id: string, name: string) => void;
  /** Opens a tab handed over by another window, after the active one, and activates it. */
  adoptTab: (tab: PersistedTab) => void;
}

function newTabId(): string {
  return crypto.randomUUID();
}

/**
 * Writes the whole strip down. Called for any change that alters what a restart should restore —
 * including changes made *inside* a tab, which the per-tab subscriptions below forward here.
 */
function saveTabs(): void {
  const { tabs, activeTabId } = useTabsStore.getState();
  writePersistedTabs(WINDOW_LABEL, { activeTabId, tabs: tabs.map(persistTab) });
}

/**
 * A tab in the shape it is written down in — and handed to another window in.
 *
 * One shape for both, because a tab that moves between windows and a tab that comes back after a
 * restart are the same tab arriving by two routes; giving the move its own wire format would be a
 * second description of a tab, free to drift from the first.
 */
export function persistTab(tab: Tab): PersistedTab {
  return {
    id: tab.id,
    title: tab.title,
    customTitle: tab.customTitle,
    state: readTabState(tab.stores),
  };
}

/**
 * Builds a tab and wires the four stores whose state outlives a restart back to the save.
 *
 * Only a change that is actually persisted triggers a write — a selection or a collapsed node is
 * per-tab working state and would otherwise write the strip down on every arrow key.
 */
function makeTab({ id, title, customTitle, state }: PersistedTab): Tab {
  const stores = createTabStores(state);
  stores.view.subscribe(saveTabs);
  stores.filter.subscribe((s, previous) => { if (s.filter !== previous.filter) saveTabs(); });
  stores.listFilter.subscribe((s, previous) => { if (s.filter !== previous.filter) saveTabs(); });
  stores.mindmap.subscribe((s, previous) => {
    if (s.subtreeRootId !== previous.subtreeRootId || s.expandedHabitGroupIds !== previous.expandedHabitGroupIds) saveTabs();
  });
  return { id, title, customTitle, stores };
}

/**
 * The strip as it comes back from storage, or a single tab carrying whatever a pre-tabs session
 * had, or — for a first run — one default tab. An existing user always gets their view back as one
 * tab rather than a blank board.
 */
function initialTabs(): { tabs: Tab[]; activeTabId: string } {
  const persisted = readPersistedTabs(WINDOW_LABEL);
  if (persisted !== null) {
    return {
      tabs: persisted.tabs.map((tab) => makeTab(tab)),
      activeTabId: persisted.activeTabId,
    };
  }
  const id = newTabId();
  // The pre-tabs session belongs to the window that would have had it, which is the only window a
  // session written before windows existed ever had. A torn-off window starts fresh.
  const legacy = WINDOW_LABEL === BOOTSTRAP_WINDOW_LABEL ? legacyTabState() : null;
  const state = legacy ?? freshTabState();
  return { tabs: [makeTab({ id, title: null, customTitle: null, state })], activeTabId: id };
}

/**
 * The tabs themselves — which are open, their order, and which one is active. The only new store
 * tabs introduce; everything a tab *contains* lives in the per-tab instances it holds.
 *
 * Closing the last tab is refused here rather than handled: an empty strip is not a state the app
 * has, and what should happen instead — closing the window — is not a store's business. See
 * `use-tab-commands`.
 */
export const useTabsStore = create<TabsStore>()((set, get) => ({
  ...initialTabs(),

  openTab: (state = freshTabState()) => {
    const id = newTabId();
    set((s) => {
      const at = s.tabs.findIndex((tab) => tab.id === s.activeTabId);
      const tabs = [...s.tabs];
      tabs.splice(at + 1, 0, makeTab({ id, title: null, customTitle: null, state }));
      return { tabs, activeTabId: id };
    });
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return false;
    const at = tabs.findIndex((tab) => tab.id === id);
    if (at === -1) return false;
    const remaining = tabs.filter((tab) => tab.id !== id);
    // Closing the active tab hands focus to its right-hand neighbour, or to the new last tab.
    const successor = remaining[Math.min(at, remaining.length - 1)];
    set({ tabs: remaining, activeTabId: id === activeTabId && successor !== undefined ? successor.id : activeTabId });
    return true;
  },

  activateTab: (id) => {
    if (get().tabs.some((tab) => tab.id === id)) set({ activeTabId: id });
  },

  activateAt: (index) => {
    const tab = get().tabs[index];
    if (tab !== undefined) set({ activeTabId: tab.id });
  },

  cycleTab: (delta) => {
    const { tabs, activeTabId } = get();
    const at = tabs.findIndex((tab) => tab.id === activeTabId);
    if (at === -1) return;
    const next = tabs[((at + delta) % tabs.length + tabs.length) % tabs.length];
    if (next !== undefined) set({ activeTabId: next.id });
  },

  moveTab: (fromIndex, toIndex) => {
    const current = get().tabs;
    const moved = current[fromIndex];
    if (moved === undefined || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return;
    const tabs = [...current];
    tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    set({ tabs });
  },

  // Written on every publish of the subtree descriptor, so an unchanged label must not `set` at
  // all: a no-op `set` still notifies, and every notification writes the strip to storage.
  setTabTitle: (id, title) => {
    const current = get().tabs;
    const tab = current.find((candidate) => candidate.id === id);
    if (tab === undefined || tab.title === title) return;
    set({ tabs: current.map((candidate) => (candidate.id === id ? { ...candidate, title } : candidate)) });
  },

  // A name lives *beside* the derived label rather than in it: `setTabTitle` keeps writing `title`
  // on every navigation, so a name written there would vanish the next time the tab moved. Blanking
  // the name is how you get the derived label back — and it is correct the moment it reappears,
  // because it was maintained all along.
  renameTab: (id, name) => {
    const trimmed = name.trim();
    const customTitle = trimmed === "" ? null : trimmed;
    const current = get().tabs;
    const tab = current.find((candidate) => candidate.id === id);
    if (tab === undefined || tab.customTitle === customTitle) return;
    set({ tabs: current.map((candidate) => (candidate.id === id ? { ...candidate, customTitle } : candidate)) });
  },

  // The arriving tab keeps its own id where it can, so a tab that is moved and moved back is the
  // same tab throughout. Ids are minted per window and a collision is only possible when a tab
  // comes back to a window that has since opened one of its own with that id — in which case the
  // arriving tab takes a new id, because two tabs with one id is the worse of the two problems.
  adoptTab: (tab) => {
    set((s) => {
      const id = s.tabs.some((candidate) => candidate.id === tab.id) ? newTabId() : tab.id;
      const at = s.tabs.findIndex((candidate) => candidate.id === s.activeTabId);
      const tabs = [...s.tabs];
      tabs.splice(at + 1, 0, makeTab({ ...tab, id }));
      return { tabs, activeTabId: id };
    });
  },
}));

/** Keeps the provider-less readers (`useViewStore.getState()`, and tests) on the active tab. */
function publishActive(): void {
  const { tabs, activeTabId } = useTabsStore.getState();
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  if (active === undefined) throw new Error("The tab strip is empty, which cannot happen");
  setActiveTabStores(active.stores);
}

/**
 * Rebuilds the strip from storage, exactly as launching the app does — the restore path, callable.
 * Every tab is replaced, so anything a tab was holding in working state is gone.
 */
export function reloadTabs(): void {
  useTabsStore.setState(initialTabs());
}

publishActive();
useTabsStore.subscribe((state, previous) => {
  if (state.activeTabId !== previous.activeTabId || state.tabs !== previous.tabs) publishActive();
  saveTabs();
});
