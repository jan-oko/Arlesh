import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { newTabId, persistTab, useTabsStore } from "@/stores/use-tabs-store";
import { forgetPersistedTabs, freshTabState, writePersistedTabs } from "@/stores/tab-persistence";
import { closeWindow, openBoardWindow, focusBoardWindow } from "@/api/window";
import { newWindowLabel } from "@/api/window-label";
import { sendTabToWindow } from "@/api/board";

/** Everything the tab shortcuts and the strip's controls do. */
export interface TabCommands {
  /** Opens a tab at the current tab's subtree root, and activates it. */
  openTab: () => void;
  /** Opens a new window holding one tab, started the same way {@link TabCommands.openTab} starts one. */
  openWindow: () => void;
  /** Closes a tab — the active one by default. Closing the last one closes the window. */
  closeTab: (id?: string) => void;
  nextTab: () => void;
  previousTab: () => void;
  /** Jumps to the nth tab (1-based, as `Ctrl+1`–`Ctrl+9` name them). */
  jumpToTab: (position: number) => void;
  /**
   * Takes a tab out of this window and into a new one of its own.
   *
   * Refuses out loud when it is the only tab, rather than doing nothing: see the implementation.
   */
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
  const { t } = useTranslation(["common"]);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const open = useTabsStore((s) => s.openTab);
  const close = useTabsStore((s) => s.closeTab);
  const activateAt = useTabsStore((s) => s.activateAt);
  const cycleTab = useTabsStore((s) => s.cycleTab);
  const adoptTab = useTabsStore((s) => s.adoptTab);

  /** Where a newly opened tab starts: at the current tab's subtree, with everything else fresh. */
  const startingState = useCallback(() => {
    const active = tabs.find((tab) => tab.id === activeTabId);
    return freshTabState(active?.stores.mindmap.getState().subtreeRootId ?? null);
  }, [tabs, activeTabId]);

  const openTab = useCallback(() => {
    // A new tab starts where you are looking — opening one to check something nearby should not
    // cost the navigation back. Everything else about it is fresh.
    open(startingState());
  }, [open, startingState]);

  // A new window is a new tab that happens to be somewhere else, so it starts exactly where
  // `Ctrl+T` would have started one: at the subtree you are looking at, with fresh filters. That
  // is the useful answer as well as the consistent one — a second window is usually opened to put
  // *nearby* work on another monitor, and starting it at the true root would cost the navigation
  // back every time. A window torn off carries its tab's whole state instead, because there the
  // tab already exists and is being moved rather than made.
  const openWindow = useCallback(() => {
    const label = newWindowLabel();
    const id = newTabId();
    writePersistedTabs(label, {
      activeTabId: id,
      tabs: [{ id, title: null, customTitle: null, state: startingState() }],
    });
    void openBoardWindow(label).catch((error: unknown) => {
      console.error("[arlesh] could not open a new window:", error);
      forgetPersistedTabs(label);
    });
  }, [startingState]);

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
      if (tab === undefined) return;

      // Tearing off the only tab would move the window rather than divide it, leaving the window
      // it came from with nothing in it. The menu can hide an entry that does not apply; a chord
      // cannot, so it says why — an inert key is exactly what the refusal policy exists to stop.
      // It goes through the view's one notice slot, which all three views draw, rather than
      // inventing a second channel for the same kind of message.
      if (tabs.length <= 1) {
        // `nodeId` is vestigial — nothing reads it, and this refusal is about the tab, not a node.
        tab.stores.mindmap.getState().showToast({ nodeId: "", message: t("common:tearOffLastTab") });
        return;
      }

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
    [tabs, close, adoptTab, t],
  );

  // Removed first, sent second, and given back if the send fails. The other way round — send,
  // then remove once the send resolved — left the tab in **both** windows whenever the removal
  // did not follow, which on WebKitGTK is what a drag between windows produced. A tab can be in
  // one window at a time, so the window giving it up lets go before it is handed over.
  //
  // The tab is read from the store as it is **now**, not from the strip this callback closed
  // over: a claim arrives from another window at any moment, and a stale strip could hand over a
  // tab that has already gone. A tab that is not here any more is not this window's to move.
  const moveTabToWindow = useCallback(
    (id: string, label: string) => {
      const strip = useTabsStore.getState().tabs;
      const tab = strip.find((candidate) => candidate.id === id);
      if (tab === undefined) {
        return;
      }
      const persisted = persistTab(tab);
      // The last tab cannot be removed from a strip; its window closes once the tab has arrived.
      const isLast = strip.length <= 1;
      if (!isLast) close(id);

      void sendTabToWindow(label, persisted)
        .then(() => {
          if (isLast) void closeWindow();
          return focusBoardWindow(label);
        })
        .catch((error: unknown) => {
          console.error("[arlesh] could not move the tab to the other window:", error);
          if (!isLast) adoptTab(persisted);
        });
    },
    [close, adoptTab],
  );

  const nextTab = useCallback(() => cycleTab(1), [cycleTab]);
  const previousTab = useCallback(() => cycleTab(-1), [cycleTab]);
  const jumpToTab = useCallback((position: number) => activateAt(position - 1), [activateAt]);

  return useMemo(
    () => ({
      openTab, openWindow, closeTab, nextTab, previousTab, jumpToTab, tearOffTab, moveTabToWindow,
    }),
    [openTab, openWindow, closeTab, nextTab, previousTab, jumpToTab, tearOffTab, moveTabToWindow],
  );
}
