import { create } from "zustand";

export const CLIPBOARD_OP = {
  CUT: "cut",
  COPY: "copy",
} as const;

export type ClipboardOperation = "cut" | "copy";

export interface Clipboard {
  operation: ClipboardOperation;
  nodeIds: string[];
}

export interface PendingToast {
  nodeId: string;
  message: string;
}

interface MindmapState {
  selectedNodeId: string | null;
  selectedNodeIds: ReadonlySet<string>;
  subtreeRootId: string | null;
  clipboard: Clipboard | null;
  collapsedNodeIds: ReadonlySet<string>;
  pendingToast: PendingToast | null;

  selectNode: (id: string | null) => void;
  addToSelection: (id: string) => void;
  setSelection: (ids: ReadonlySet<string>, anchorId: string) => void;
  enterSubtree: (id: string) => void;
  exitSubtree: (parentSubtreeId: string | null) => void;
  exitToRoot: () => void;
  setClipboard: (clipboard: Clipboard | null) => void;
  toggleCollapsed: (id: string) => void;
  showToast: (toast: PendingToast) => void;
  clearToast: () => void;
}

export const useMindmapStore = create<MindmapState>((set) => ({
  selectedNodeId: null,
  selectedNodeIds: new Set(),
  subtreeRootId: null,
  clipboard: null,
  collapsedNodeIds: new Set(),
  pendingToast: null,

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
