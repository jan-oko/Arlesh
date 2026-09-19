import { useCallback, useMemo } from "react";
import { useTabsStore } from "@/stores/use-tabs-store";
import { freshTabState } from "@/stores/tab-persistence";
import { closeWindow } from "@/api/window";

/** Everything the tab shortcuts and the strip's controls do. */
export interface TabCommands {
  /** Opens a tab at the current tab's subtree root, and activates it. */
  openTab: () => void;
  /** Closes a tab — the active one by default. Closing the last one closes the window. */
  closeTab: (id?: string) => void;
  nextTab: () => void;
  previousTab: () => void;
  /** Jumps to the nth tab (1-based, as `Ctrl+1`–`Ctrl+9` name them). */
  jumpToTab: (position: number) => void;
}

/**
 * The tab gestures, in one place, because each is a decision the store deliberately does not make:
 * where a new tab starts, and what closing the last tab means.
 */
export function useTabCommands(): TabCommands {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const open = useTabsStore((s) => s.openTab);
  const close = useTabsStore((s) => s.closeTab);
  const activateAt = useTabsStore((s) => s.activateAt);
  const cycleTab = useTabsStore((s) => s.cycleTab);

  const openTab = useCallback(() => {
    // A new tab starts where you are looking — opening one to check something nearby should not
    // cost the navigation back. Everything else about it is fresh.
    const active = tabs.find((tab) => tab.id === activeTabId);
    open(freshTabState(active?.stores.mindmap.getState().subtreeRootId ?? null));
  }, [open, tabs, activeTabId]);

  const closeTab = useCallback(
    (id?: string) => {
      if (!close(id ?? activeTabId)) void closeWindow();
    },
    [close, activeTabId],
  );

  const nextTab = useCallback(() => cycleTab(1), [cycleTab]);
  const previousTab = useCallback(() => cycleTab(-1), [cycleTab]);
  const jumpToTab = useCallback((position: number) => activateAt(position - 1), [activateAt]);

  return useMemo(
    () => ({ openTab, closeTab, nextTab, previousTab, jumpToTab }),
    [openTab, closeTab, nextTab, previousTab, jumpToTab],
  );
}
