import { useEffect } from "react";
import "@/styles/tokens.css";
import TabStrip from "@/components/TabStrip/TabStrip";
import ActiveTab from "@/components/ActiveTab/ActiveTab";
import HotkeysModal from "@/components/HotkeysModal/HotkeysModal";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { TabStoresContext } from "@/stores/tab-stores-context";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { TAB_BINDINGS } from "@/utils/hotkeys/tab-bindings";
import styles from "./App.module.css";

export default function App() {
  const theme = useThemeStore((s) => s.theme);
  const hotkeysOpen = useHotkeysStore((s) => s.isOpen);
  const closeHotkeys = useHotkeysStore((s) => s.close);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const { openTab, closeTab, nextTab, previousTab, jumpToTab } = useTabCommands();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Tab shortcuts are unconditionally live — unlike a view binding, switching tabs is never
  // ambiguous about what it would act on, so an open modal is no reason to suppress it.
  useHotkeys(
    TAB_BINDINGS,
    { onOpenTab: openTab, onCloseTab: () => closeTab(), onNextTab: nextTab, onPreviousTab: previousTab, onJumpToTab: jumpToTab },
    true,
  );

  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className={styles.shell}>
      <TabStrip />
      {active !== undefined && (
        <TabStoresContext.Provider value={active.stores}>
          <ActiveTab />
        </TabStoresContext.Provider>
      )}
      {hotkeysOpen && <HotkeysModal onClose={closeHotkeys} />}
    </div>
  );
}
