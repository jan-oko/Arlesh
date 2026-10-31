import { useEffect } from "react";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import type { NodeKind } from "@/utils/tree-layout";

/**
 * Publishes the view's selection by kind for the action bar, and clears it when the view goes.
 * Keyed on the joined kinds, so a fresh array of the same kinds on every render writes nothing.
 */
export function usePublishSelection(kinds: readonly NodeKind[]): void {
  const key = kinds.join(" ");
  useEffect(() => {
    useSelectionSurfaceStore.getState().setKinds(kinds);
    // `key` is `kinds`, compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => useSelectionSurfaceStore.getState().setKinds([]), []);
}
