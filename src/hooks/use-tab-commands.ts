import { useCallback, useMemo } from "react";
import { persistTab, useTabsStore } from "@/stores/use-tabs-store";
import { forgetPersistedTabs, freshTabState, writePersistedTabs } from "@/stores/tab-persistence";
import { closeWindow, newWindowLabel, openBoardWindow, focusBoardWindow } from "@/api/window";
import { sendTabToWindow } from "@/api/board";

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
  /** Takes a tab out of this window and into a new one of its own. */
  tearOffTab: (id: string) => void;
  /** Hands a tab to the window labelled `label`, which opens it and comes to the front. */
  moveTabToWindow: (id: string, label: string) => void;
}

/**
 * The tab gestures, in one place, because each is a decision the store deliberately does not make:
 * where a new tab starts, what closing the last tab means, and what it takes to move a tab into
 * another window. The store is the strip of *this* window and knows about no other; everything
 * that crosses a window boundary is here.
 */
export function useTabCommands(): TabCommands {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const open = useTabsStore((s) => s.openTab);
  const close = useTabsStore((s) => s.closeTab);
  const activateAt = useTabsStore((s) => s.activateAt);
  const cycleTab = useTabsStore((s) => s.cycleTab);
  const adoptTab = useTabsStore((s) => s.adoptTab);

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

  // A tab leaves this window by being written down under the new window's label *before* the
  // window is asked for. The new window finds its own strip on boot, so the tab never travels
  // through an event that could arrive before the window listening for it does — and a window that
  // fails to open gives the tab straight back rather than leaving it nowhere.
  const tearOffTab = useCallback(
    (id: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      // Tearing off the only tab would move the window rather than divide it, which is a gesture
      // with no effect and a window that briefly has none.
      if (tab === undefined || tabs.length <= 1) return;

      const persisted = persistTab(tab);
      const label = newWindowLabel();
      writePersistedTabs(label, { activeTabId: persisted.id, tabs: [persisted] });
      close(id);

      void openBoardWindow(label).catch((error: unknown) => {
        console.error("[arlesh] could not tear the tab off into its own window:", error);
        forgetPersistedTabs(label);
        adoptTab(persisted);
      });
    },
    [tabs, close, adoptTab],
  );

  // Sent first, removed second: a hand-over that never arrives leaves the tab exactly where it
  // was, which is the only failure worth designing for here.
  const moveTabToWindow = useCallback(
    (id: string, label: string) => {
      const tab = tabs.find((candidate) => candidate.id === id);
      if (tab === undefined) return;

      void sendTabToWindow(label, persistTab(tab))
        .then(() => {
          if (!close(id)) void closeWindow();
          return focusBoardWindow(label);
        })
        .catch((error: unknown) => {
          console.error("[arlesh] could not move the tab to the other window:", error);
        });
    },
    [tabs, close],
  );

  const nextTab = useCallback(() => cycleTab(1), [cycleTab]);
  const previousTab = useCallback(() => cycleTab(-1), [cycleTab]);
  const jumpToTab = useCallback((position: number) => activateAt(position - 1), [activateAt]);

  return useMemo(
    () => ({ openTab, closeTab, nextTab, previousTab, jumpToTab, tearOffTab, moveTabToWindow }),
    [openTab, closeTab, nextTab, previousTab, jumpToTab, tearOffTab, moveTabToWindow],
  );
}
