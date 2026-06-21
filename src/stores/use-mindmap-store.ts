import { create } from "zustand";

export type ClipboardOperation = "cut" | "copy";

export interface Clipboard {
  operation: ClipboardOperation;
  nodeId: string;
}

export interface PendingToast {
  nodeId: string;
  message: string;
}

interface MindmapState {
  selectedNodeId: string | null;
  subtreeRootId: string | null;
  clipboard: Clipboard | null;
  collapsedNodeIds: ReadonlySet<string>;
  pendingToast: PendingToast | null;

  selectNode: (id: string | null) => void;
  enterSubtree: (id: string) => void;
  exitSubtree: () => void;
  exitToRoot: () => void;
  setClipboard: (clipboard: Clipboard | null) => void;
  toggleCollapsed: (id: string) => void;
  showToast: (toast: PendingToast) => void;
  clearToast: () => void;
}

export const useMindmapStore = create<MindmapState>((set) => ({
  selectedNodeId: null,
  subtreeRootId: null,
  clipboard: null,
  collapsedNodeIds: new Set(),
  pendingToast: null,

  selectNode: (id) => set({ selectedNodeId: id }),

  enterSubtree: (id) => set({ subtreeRootId: id, selectedNodeId: id }),

  exitSubtree: () =>
    set((state) => ({
      subtreeRootId: state.subtreeRootId === null ? null : null,
      selectedNodeId: state.subtreeRootId,
    })),

  exitToRoot: () => set({ subtreeRootId: null, selectedNodeId: null }),

  setClipboard: (clipboard) => set({ clipboard }),

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

  showToast: (toast) => set({ pendingToast: toast }),
  clearToast: () => set({ pendingToast: null }),
}));
