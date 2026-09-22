import { useHotkeys } from "@/hooks/use-hotkeys";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useQuit } from "@/hooks/use-close-to-tray";
import { useSubtreeExits } from "@/hooks/use-subtree-nav";
import { useFilterStore } from "@/stores/use-filter-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useViewStore } from "@/stores/use-view-store";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";

/**
 * Registers the app-level bindings and supplies everything they act on.
 *
 * It is a hook rather than a few lines inside `ActiveTab` because the global table and a view's
 * table are only ever mounted *together* in the running app — the chords promoted out of the views
 * (the subtree exits, the node search, the filter menu) are dispatched here while the modal or the
 * row they end up affecting is drawn by the view. A view's own integration test has to mount both
 * to assert what the user actually experiences, and duplicating this wiring in a test would let the
 * two drift.
 *
 * Every handle comes from a tab store, so nothing here needs a loaded tree — which is what makes
 * these bindings tab-level rather than view-level in the first place.
 */
export function useGlobalHotkeys(): void {
  const setView = useViewStore((s) => s.setView);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  const quit = useQuit();
  // The guarded bindings alone consult this; quitting and the cheat-sheet stay live behind a modal.
  const isInputCaptured = useIsInputCaptured();
  const { subtreeRootId, onExitSubtree, onExitToRoot } = useSubtreeExits();
  const openSearch = useMindmapStore((s) => s.openSearch);
  const toggleFilterPopover = useFilterStore((s) => s.toggleFilterPopover);

  useHotkeys(
    GLOBAL_BINDINGS,
    {
      isInputCaptured,
      onSetView: setView,
      onToggleHotkeys: toggleHotkeys,
      onToggleFullscreen: toggleFullscreen,
      onQuit: quit,
      subtreeRootId,
      onExitSubtree,
      onExitToRoot,
      onOpenSearch: openSearch,
      onToggleFilter: toggleFilterPopover,
    },
    true,
  );
}
