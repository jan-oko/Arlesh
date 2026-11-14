import { useEffect, useRef } from "react";
import { useRowCutoutClearance } from "@/hooks/use-cutout-clearance";
import TopBar from "@/components/TopBar/TopBar";
import PhoneTopBar from "@/components/PhoneTopBar/PhoneTopBar";
import TopBarSquare from "@/components/PhoneTopBar/TopBarSquare";
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
import { useSelectModeStore } from "@/stores/use-select-mode-store";
import { useGlobalHotkeys } from "@/hooks/use-global-hotkeys";
import { useTabTitle } from "@/hooks/use-tab-title";
import { useTouchLayout } from "@/hooks/use-media-query";
import styles from "./ActiveTab.module.css";
import { useTwoFingerPreset } from "@/hooks/use-two-finger-preset";

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
  const isTouchLayout = useTouchLayout();
  const paletteOpen = usePaletteStore((s) => s.isOpen);
  const viewsRef = useRef<HTMLDivElement>(null);
  useRowCutoutClearance(viewsRef, view);

  useTabTitle();
  useGlobalHotkeys();
  useTwoFingerPreset();
  // The palette's Select mode builds one view's selection; another view starts with taps that select.
  useEffect(() => () => useSelectModeStore.getState().stop(), [view]);

  return (
    <>
      {!isFullscreen && (isTouchLayout ? <PhoneTopBar /> : <TopBar />)}
      {/* Every view spans the screen, under a cutout and the side bars. The Mindmap canvas is panned
          and needs nothing; in the others a row or card that the camera overlaps keeps its content
          clear of it (`data-cutout-row`, `use-cutout-clearance.ts`). */}
      {view === "mindmap" && <MindmapView />}
      {view !== "mindmap" && (
        <div ref={viewsRef} className={styles.views}>
          {view === "list" && <ListView />}
          {view === "plan" && <PlanView />}
          {view === "steps" && <StepsView />}
          {view === "zen" && <ZenView />}
        </div>
      )}
      {/* Full screen hides these too, leaving only the hot square in the bottom-right corner (tap:
          Open, long-press: the palette) and the three-finger tap, which toggles it back off. */}
      {isTouchLayout && (isFullscreen
        ? <TopBarSquare corner />
        : <BottomChrome showActionBar showNav />)}
      {paletteOpen && <CommandPalette showTabs={!isTouchLayout} />}
    </>
  );
}
