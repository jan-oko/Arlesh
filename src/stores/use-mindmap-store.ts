import { createStore, type StoreApi } from "zustand";
import { tabStoreHook } from "@/stores/tab-stores-context";

export interface PendingToast {
  nodeId: string;
  message: string;
}

/** One level above the one you are in: a step on the breadcrumb, and a way back out to that level. */
export interface SubtreeCrumb {
  /** The subtree to re-root at — `null` is the true root, which is nobody's subtree. */
  id: string | null;
  title: string;
}

/** Data the top bar needs to draw the subtree breadcrumb. Pushed by whichever view is mounted, via
 * `use-subtree-nav` — the top bar holds no tree of its own. */
export interface SubtreeNav {
  /**
   * Every level above the one you are in, the true root first. **Never empty** while a subtree is
   * entered: the shallowest subtree there is still sits under the true root.
   */
  ancestors: readonly SubtreeCrumb[];
  /** The subtree you are currently inside. Named in the bar, since it is trimmed from the paths. */
  currentTitle: string;
}

export interface MindmapStore {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  subtreeRootId: string | null;
  collapsedNodeIds: ReadonlySet<string>;
  /**
   * The folded Habit-history nodes the user has opened.
   *
   * The inverse of `collapsedNodeIds`, because the default is the inverse: a run of passed
   * iterations is drawn folded on every load, so "not listed" has to mean folded, and only an
   * expansion is worth writing down.
   */
  expandedRunIds: ReadonlySet<string>;
  pendingToast: PendingToast | null;
  subtreeNav: SubtreeNav | null;

  selectNode: (id: string | null) => void;
  addToSelection: (id: string) => void;
  setSelection: (ids: ReadonlySet<string>, anchorId: string) => void;
  enterSubtree: (id: string) => void;
  exitSubtree: (parentSubtreeId: string | null) => void;
  exitToRoot: () => void;
  toggleCollapsed: (id: string) => void;
  toggleRunExpanded: (id: string) => void;
  showToast: (toast: PendingToast) => void;
  clearToast: () => void;
  setSubtreeNav: (nav: SubtreeNav | null) => void;
}

/**
 * Where **one tab** is and what it has picked: its subtree root, its selection, its collapsed
 * nodes and its pending toast. Both views in a tab share this store, which is why entering a
 * subtree in the List View and switching to the Mindmap leaves you in the same place — and why
 * doing it in one tab leaves every other tab where it was.
 *
 * The clipboard used to live here and no longer does: it is app-wide (`use-clipboard-store`).
 */
export function createMindmapStore(
  subtreeRootId: string | null = null,
  expandedRunIds: ReadonlySet<string> = new Set(),
): StoreApi<MindmapStore> {
  return createStore<MindmapStore>()((set) => ({
    selectedNodeId: null,
    selectedNodeIds: new Set(),
    subtreeRootId,
    collapsedNodeIds: new Set(),
    expandedRunIds,
    pendingToast: null,
    subtreeNav: null,

    selectNode: (id) =>
      set({
        selectedNodeId: id,
        selectedNodeIds: id !== null ? new Set([id]) : new Set(),
      }),

    addToSelection: (id) =>
      set((state) => {
        const next = new Set(state.selectedNodeIds);
        if (next.has(id)) {
          next.delete(id);
          const newAnchor = next.size > 0 ? (next.values().next().value ?? null) : null;
          return { selectedNodeIds: next, selectedNodeId: newAnchor };
        }
        next.add(id);
        return { selectedNodeIds: next };
      }),

    setSelection: (ids, anchorId) =>
      set({ selectedNodeIds: ids, selectedNodeId: anchorId }),

    enterSubtree: (id) =>
      set({ subtreeRootId: id, selectedNodeId: id, selectedNodeIds: new Set([id]) }),

    exitSubtree: (parentSubtreeId) =>
      set((state) => ({
        subtreeRootId: parentSubtreeId,
        selectedNodeId: state.subtreeRootId,
        selectedNodeIds: state.subtreeRootId !== null ? new Set([state.subtreeRootId]) : new Set(),
      })),

    exitToRoot: () =>
      set({ subtreeRootId: null, selectedNodeId: null, selectedNodeIds: new Set() }),

    setSubtreeNav: (subtreeNav) => set({ subtreeNav }),

    toggleCollapsed: (id) =>
      set((state) => {
        const next = new Set(state.collapsedNodeIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { collapsedNodeIds: next };
      }),

    toggleRunExpanded: (id) =>
      set((state) => {
        const next = new Set(state.expandedRunIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { expandedRunIds: next };
      }),

    showToast: (toast) => set({ pendingToast: toast }),
    clearToast: () => set({ pendingToast: null }),
  }));
}

export const useMindmapStore = tabStoreHook<MindmapStore>((stores) => stores.mindmap);
