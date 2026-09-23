import { useEffect } from "react";
import "@/styles/tokens.css";
import TabStrip from "@/components/TabStrip/TabStrip";
import ActiveTab from "@/components/ActiveTab/ActiveTab";
import HotkeysModal from "@/components/HotkeysModal/HotkeysModal";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { TabStoresContext } from "@/stores/tab-stores-context";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { useCloseToTraySync } from "@/hooks/use-close-to-tray";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useForgetClosedWindows, useTabInbox } from "@/hooks/use-window-session";
import { useWindowTitle } from "@/hooks/use-window-title";
import { TAB_BINDINGS } from "@/utils/hotkeys/tab-bindings";
import styles from "./App.module.css";

export default function App() {
  const theme = useThemeStore((s) => s.theme);
  const hotkeysOpen = useHotkeysStore((s) => s.isOpen);
  const isFullscreen = useFullscreenStore((s) => s.isFullscreen);
  const closeHotkeys = useHotkeysStore((s) => s.close);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const {
    openTab, openWindow, closeTab, nextTab, previousTab, jumpToTab, tearOffTab,
  } = useTabCommands();
  // Only the tear-off consults this; everything else in the table stays live behind a modal.
  const isInputCaptured = useIsInputCaptured();

  useCloseToTraySync();
  // Every window is the same thing, so this is all it takes to be one of several: accept a tab
  // another window hands over, and — in the first window only — forget the tabs of windows that
  // are no longer open.
  useTabInbox();
  useForgetClosedWindows();
  useWindowTitle();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Tab shortcuts are live behind a modal — unlike a view binding, opening or switching a tab is
  // never ambiguous about what it would act on. The tear-off is the one exception, and carries its
  // own guard rather than taking the whole table off; `tab-bindings.ts` says why.
  useHotkeys(
    TAB_BINDINGS,
    {
      isInputCaptured,
      onOpenTab: openTab,
      onOpenWindow: openWindow,
      onCloseTab: () => closeTab(),
      onTearOffTab: () => tearOffTab(activeTabId),
      onNextTab: nextTab,
      onPreviousTab: previousTab,
      onJumpToTab: jumpToTab,
    },
    true,
  );

  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className={styles.shell}>
      {!isFullscreen && <TabStrip />}
      {active !== undefined && (
        <TabStoresContext.Provider value={active.stores}>
          <ActiveTab />
        </TabStoresContext.Provider>
      )}
      {hotkeysOpen && <HotkeysModal onClose={closeHotkeys} />}
    </div>
  );
}
