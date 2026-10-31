import TopBar from "@/components/TopBar/TopBar";
import PhoneTopBar from "@/components/PhoneTopBar/PhoneTopBar";
import BottomChrome from "@/components/BottomChrome/BottomChrome";
import CommandPalette from "@/components/CommandPalette/CommandPalette";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import PlanView from "@/components/PlanView/PlanView";
import StepsView from "@/components/StepsView/StepsView";
import ZenView from "@/components/ZenView/ZenView";
import { useViewStore } from "@/stores/use-view-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useTabTitle } from "@/hooks/use-tab-title";
import { usePhoneLayout, useShowsActionBar } from "@/hooks/use-media-query";

/**
 * Everything one tab shows: its top bar and whichever view it is on — and, in the phone layout or
 * on a touch-only device, the action bar and the bottom navigation beneath it (`docs/spec/touch.md`).
 *
 * It renders under that tab's store provider, so every hook below it — the top bar's filters, the
 * view's subtree root, the selection — reads the tab it belongs to and nothing else. That is the
 * whole of what makes two tabs independent, and it is why the view-level bindings declared here
 * act on the active tab without knowing that tabs exist.
 */
export default function ActiveTab() {
  const view = useViewStore((s) => s.view);
  const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
  const isPhone = usePhoneLayout();
  const showsActionBar = useShowsActionBar();
  const paletteOpen = usePaletteStore((s) => s.isOpen);

  useTabTitle();
  useGlobalHotkeys();

  return (
    <>
      {!isFullscreen && (isPhone ? <PhoneTopBar /> : <TopBar />)}
      {view === "mindmap" && <MindmapView />}
      {view === "list" && <ListView />}
      {view === "plan" && <PlanView />}
      {view === "steps" && <StepsView />}
      {view === "zen" && <ZenView />}
      {/* Full screen keeps these: on a phone they are the only way back out of it. */}
      {(showsActionBar || isPhone) && <BottomChrome showActionBar={showsActionBar} showNav={isPhone} />}
      {paletteOpen && <CommandPalette showTabs={!isPhone} />}
    </>
  );
}
