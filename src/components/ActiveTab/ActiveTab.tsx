import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import PlanView from "@/components/PlanView/PlanView";
import StepsView from "@/components/StepsView/StepsView";
import { useViewStore } from "@/stores/use-view-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useTabTitle } from "@/hooks/use-tab-title";

/**
 * Everything one tab shows: its top bar and whichever view it is on.
 *
 * It renders under that tab's store provider, so every hook below it — the top bar's filters, the
 * view's subtree root, the selection — reads the tab it belongs to and nothing else. That is the
 * whole of what makes two tabs independent, and it is why the view-level bindings declared here
 * act on the active tab without knowing that tabs exist.
 */
export default function ActiveTab() {
  const view = useViewStore((s) => s.view);
  const isFullscreen = useFullscreenStore((s) => s.isFullscreen);

  useTabTitle();
  useGlobalHotkeys();

  return (
    <>
      {!isFullscreen && <TopBar />}
      {view === "mindmap" && <MindmapView />}
      {view === "list" && <ListView />}
      {view === "plan" && <PlanView />}
      {view === "steps" && <StepsView />}
    </>
  );
}
