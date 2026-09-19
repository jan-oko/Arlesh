import { createContext, useContext } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import type { TabStores } from "@/stores/tab-stores";

/**
 * The tab whose stores the components below this provider read.
 *
 * Every per-tab store (`useViewStore`, `useFilterStore`, `useListFilterStore`, `useMindmapStore`)
 * is a hook over *this* bundle rather than over a module-level singleton, which is what lets two
 * tabs hold two filter sets, two subtree roots and two views at once. Component code keeps calling
 * the same hooks with the same signatures and never learns that tabs exist — the whole substitution
 * happens here.
 */
export const TabStoresContext = createContext<TabStores | null>(null);

/**
 * The active tab's bundle, for readers outside any provider.
 *
 * It is a store rather than a plain variable so that a component rendered without a provider still
 * re-renders when the active tab changes. `use-tabs-store` keeps it pointed at the active tab.
 */
const activeTabStoresStore = createStore<{ stores: TabStores | null }>()(() => ({ stores: null }));

/** Points the provider-less readers at a tab's stores. Called by `use-tabs-store` on activation. */
export function setActiveTabStores(stores: TabStores): void {
  activeTabStoresStore.setState({ stores });
}

function requireStores(stores: TabStores | null): TabStores {
  if (stores === null) throw new Error("No active tab: a per-tab store was read before any tab existed");
  return stores;
}

/** The active tab's stores, read imperatively (tests, and the `getState`/`setState` accessors). */
export function activeTabStores(): TabStores {
  return requireStores(activeTabStoresStore.getState().stores);
}

/** The bundle the calling component should read — its provider's, or the active tab's. */
export function useTabStores(): TabStores {
  const fromProvider = useContext(TabStoresContext);
  const active = useStore(activeTabStoresStore, (s) => s.stores);
  return requireStores(fromProvider ?? active);
}

/**
 * A per-tab store's public surface: the selector hook components use, plus the imperative
 * accessors, which always address the **active** tab rather than any provider's.
 */
export interface TabStoreHook<T> {
  <U>(selector: (state: T) => U): U;
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
  subscribe: (listener: (state: T, previous: T) => void) => () => void;
}

/**
 * Builds the hook for one slot of the per-tab bundle. `pick` names the slot, so a store module
 * declares where it lives in a tab and nothing else has to know.
 */
export function tabStoreHook<T>(pick: (stores: TabStores) => StoreApi<T>): TabStoreHook<T> {
  function useTabStore<U>(selector: (state: T) => U): U {
    return useStore(pick(useTabStores()), selector);
  }
  return Object.assign(useTabStore, {
    getState: (): T => pick(activeTabStores()).getState(),
    setState: (partial: Partial<T> | ((state: T) => Partial<T>)): void => {
      pick(activeTabStores()).setState(partial);
    },
    subscribe: (listener: (state: T, previous: T) => void): (() => void) =>
      pick(activeTabStores()).subscribe(listener),
  });
}
