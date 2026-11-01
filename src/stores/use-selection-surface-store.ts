import { create } from "zustand";
import type { NodeKind } from "@/utils/tree-layout";

interface SelectionSurfaceStore {
  /** The kind of each selected node, in no particular order; empty with nothing selected. */
  kinds: readonly NodeKind[];
  /** Whether the mounted view holds a selection of several — what the palette's Select toggle needs. */
  multiSelect: boolean;
  publish: (kinds: readonly NodeKind[], multiSelect: boolean) => void;
}

/**
 * What the mounted view has selected, by kind — all the action bar needs to choose its context
 * (`docs/spec/touch.md`). A view publishes it with `usePublishSelection`; the bindings themselves
 * still read their own view's selection, so this is never what a command acts on.
 */
export const useSelectionSurfaceStore = create<SelectionSurfaceStore>()((set) => ({
  kinds: [],
  multiSelect: false,
  publish: (kinds, multiSelect) => set({ kinds, multiSelect }),
}));
