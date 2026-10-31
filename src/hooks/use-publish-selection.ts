import { useEffect } from "react";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import type { NodeKind } from "@/utils/tree-layout";

/**
 * Publishes the view's selection by kind for the action bar, and clears it when the view goes.
 * `multiSelect` says the view can hold several, which offers the palette's Select toggle. Keyed on
 * the joined kinds, so a fresh array of the same kinds on every render writes nothing.
 */
export function usePublishSelection(kinds: readonly NodeKind[], multiSelect = false): void {
  const key = kinds.join(" ");
  useEffect(() => {
    useSelectionSurfaceStore.getState().publish(kinds, multiSelect);
    // `key` is `kinds`, compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, multiSelect]);
  useEffect(() => () => useSelectionSurfaceStore.getState().publish([], false), []);
}
