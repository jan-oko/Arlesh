import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import { useViewStore } from "@/stores/use-view-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useQuit } from "@/hooks/use-close-to-tray";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useTabTitle } from "@/hooks/use-tab-title";
import { GLOBAL_BINDINGS, isRecursiveExpandArmed } from "@/utils/hotkeys/global-bindings";

/**
 * Everything one tab shows: its top bar and whichever of the two views it is on.
 *
 * It renders under that tab's store provider, so every hook below it — the top bar's filters, the
 * view's subtree root, the selection — reads the tab it belongs to and nothing else. That is the
 * whole of what makes two tabs independent, and it is why the view-level bindings declared here
 * act on the active tab without knowing that tabs exist.
 */
export default function ActiveTab() {
  const view = useViewStore((s) => s.view);
  const toggleView = useViewStore((s) => s.toggleView);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
  const toggleFullscreen = useFullscreenStore((s) => s.toggle);
  // Ctrl+Shift+/ belongs to the Mindmap's recursive expand whenever there is a cell to expand, and
  // to the cheat-sheet otherwise. The two bindings live in different tables dispatched by different
  // listeners, so nothing orders them — only these guards keep one of the two firing. The
  // condition is exactly when the Mindmap's own bindings are live: its view is on screen, nothing
  // has captured the keyboard (including the sheet itself, which this chord has to be able to
  // close), and something is selected.
  const selectedNodeId = useMindmapStore((s) => s.selectedNodeId);
  const isInputCaptured = useIsInputCaptured();
  const armed = isRecursiveExpandArmed({ isMindmapOnScreen: view === "mindmap", selectedNodeId, isInputCaptured });
  const quit = useQuit();

  useTabTitle();
  useHotkeys(
    GLOBAL_BINDINGS,
    { onToggleView: toggleView, onToggleHotkeys: toggleHotkeys, onToggleFullscreen: toggleFullscreen, isRecursiveExpandArmed: armed, onQuit: quit },
    true,
  );

  return (
    <>
      {!isFullscreen && <TopBar />}
      {view === "mindmap" ? <MindmapView /> : <ListView />}
    </>
  );
}
