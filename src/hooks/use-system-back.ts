import { useEffect } from "react";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { quitApp } from "@/api/tray";
import { useTabsStore } from "@/stores/use-tabs-store";
import { stepBack } from "@/utils/back-navigation";
import { dismissTopSheet } from "@/utils/dismiss-sheet";
import { goUpScope } from "@/utils/scope-up-registry";
import { isAndroid } from "@/utils/platform";
import type { TabStores } from "@/stores/tab-stores";

/** Steps out of the stepped-into node of the active tab, if it is in one. */
function leaveSubtree(stores: TabStores | undefined): boolean {
  if (stores === undefined) return false;
  const mindmap = stores.mindmap.getState();
  if (mindmap.subtreeRootId === null) return false;
  // One level up: the crumb just above the current one (`null` is the true root, which
  // `exitSubtree` takes as "leave the subtree"). Without the published chain, straight out.
  const ancestors = mindmap.subtreeNav?.ancestors ?? [];
  const parent = ancestors[ancestors.length - 1];
  if (parent === undefined) mindmap.exitToRoot();
  else mindmap.exitSubtree(parent.id);
  return true;
}

/**
 * Android's system back: closes a sheet, leaves a stepped-into node or goes up a scope, and leaves
 * the app only at the root. Registering a listener is what stops the system leaving on its own, so
 * nothing but this decides. Does nothing off Android.
 */
export function useSystemBack(activeStores: () => TabStores | undefined): void {
  useEffect(() => {
    if (!isAndroid()) return;
    let stopped = false;
    let stop: (() => Promise<void>) | null = null;
    void onBackButtonPress(() => {
      stepBack({
        dismissSheet: dismissTopSheet,
        leaveSubtree: () => leaveSubtree(activeStores()),
        upScope: goUpScope,
        exit: () => { void quitApp(); },
      });
    }).then((listener) => {
      if (stopped) void listener.unregister();
      else stop = () => listener.unregister();
    });
    return () => {
      stopped = true;
      void stop?.();
    };
  }, [activeStores]);
}

/** The active tab's stores, read when back is pressed rather than when the hook was set up. */
export function activeTabStores(): TabStores | undefined {
  const { tabs, activeTabId } = useTabsStore.getState();
  return (tabs.find((tab) => tab.id === activeTabId) ?? tabs[0])?.stores;
}
