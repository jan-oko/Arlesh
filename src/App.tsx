import { useEffect, useState } from "react";
import "@/styles/tokens.css";
import TabStrip from "@/components/TabStrip/TabStrip";
import ActiveTab from "@/components/ActiveTab/ActiveTab";
import PlanClampPrompt from "@/components/PlanClampPrompt/PlanClampPrompt";
import ScopeClampPrompt from "@/components/ScopeClampPrompt/ScopeClampPrompt";
import HotkeysModal from "@/components/HotkeysModal/HotkeysModal";
import ServerBanner from "@/components/ServerBanner/ServerBanner";
import FirstRunChooser from "@/components/FirstRunChooser/FirstRunChooser";
import SettingsModal from "@/components/SettingsModal/SettingsModal";
import { runStandalone } from "@/api/client-mode";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { useClientModeSync } from "@/hooks/use-client-mode";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useFullscreenStore } from "@/stores/use-fullscreen-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { TabStoresContext } from "@/stores/tab-stores-context";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useTabCommands } from "@/hooks/use-tab-commands";
import { activeTabStores, useSystemBack } from "@/hooks/use-system-back";
import { useCloseToTraySync } from "@/hooks/use-close-to-tray";
import { useAgentCapacitySync } from "@/hooks/use-agent-capacity";
import { useIsInputCaptured } from "@/hooks/use-input-capture";
import { useForgetClosedWindows, useTabInbox } from "@/hooks/use-window-session";
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
  // The agent capacity lock is the backend's, shared with every window and with agents over the
  // MCP; this keeps this window's copy of it current.
  useAgentCapacitySync();
  // Standalone or Client, and how the server is doing — for the top bar and the banner.
  useClientModeSync();
  // Android's back button; a no-op elsewhere.
  useSystemBack(activeTabStores);
  const firstRun = useClientModeStore((s) => s.status?.first_run === true);
  const answered = useClientModeStore((s) => s.answered);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  // A build with no Standalone mode (the phone) has no question to ask: it goes straight to
  // *Connect to a server*, and stays there until a server is chosen.
  const standaloneAvailable = useClientModeStore((s) => s.status?.standalone_available !== false);
  const [serverRequested, setServerSettings] = useState(false);
  const serverSettings = serverRequested || (firstRun && !standaloneAvailable);
  // Every window is the same thing, so this is all it takes to be one of several: accept a tab
  // another window hands over, and — in the first window only — forget the tabs of windows that
  // are no longer open.
  useTabInbox();
  useForgetClosedWindows();

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
      <ServerBanner />
      {active !== undefined && (
        <TabStoresContext.Provider value={active.stores}>
          <ActiveTab />
        </TabStoresContext.Provider>
      )}
      {/* Read once, as the sheet opens: the view chords are off while it holds the keyboard, so the
          view it opened over is the view it closes over. */}
      {hotkeysOpen && <HotkeysModal onClose={closeHotkeys} view={active?.stores.view.getState().view} />}
      {/* Any view's editor, drag or Plan writer may ask these, so they hang above them all. */}
      <PlanClampPrompt />
      <ScopeClampPrompt />
      {firstRun && !serverSettings && (
        <FirstRunChooser
          onStandalone={() => { answered(); void runStandalone(); }}
          onServer={() => setServerSettings(true)}
        />
      )}
      {serverSettings && (
        <SettingsModal
          initialPage="server"
          onClose={() => setServerSettings(false)}
          onOpenHotkeys={() => { setServerSettings(false); toggleHotkeys(); }}
        />
      )}
    </div>
  );
}
