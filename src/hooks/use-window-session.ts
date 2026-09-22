import { useEffect } from "react";
import { onTabMoved } from "@/api/board";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { boardWindowLabels } from "@/api/window";
import { currentWindowLabel } from "@/api/window-label";
import { forgetPersistedTabs, persistedWindowLabels } from "@/stores/tab-persistence";
import { useTabsStore } from "@/stores/use-tabs-store";

/**
 * Opens a tab another window has handed to this one.
 *
 * The only way a tab arrives from outside, and the reason moving a tab *back* is a menu entry
 * rather than a drag: a drag is captured by the window it began in, so the other window never
 * hears about it and there is nothing for it to accept.
 */
export function useTabInbox(): void {
  const adoptTab = useTabsStore((s) => s.adoptTab);

  useEffect(() => {
    let subscribed = true;
    let unlisten: UnlistenFn | null = null;

    void onTabMoved(adoptTab).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });

    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, [adoptTab]);
}

/**
 * Drops the stored tabs of windows that are no longer open.
 *
 * Runs once, at startup, and only in the **first** window — the one the backend reopened first —
 * so that several windows do not each do the same sweep. It is safe at that moment for a reason
 * that is not obvious: the backend reopens every window of the session before any of them runs a
 * line of JavaScript, so a stored label with no window is a window that really went.
 *
 * What is swept is a snapshot taken before the question was asked, never whatever is stale by the
 * time the answer arrives — see {@link persistedWindowLabels}.
 */
export function useForgetClosedWindows(): void {
  useEffect(() => {
    const stored = persistedWindowLabels();
    void boardWindowLabels()
      .then((live) => {
        const first = live[0];
        if (first === undefined || first !== currentWindowLabel()) return;
        const open = new Set(live);
        for (const label of stored) {
          if (!open.has(label)) forgetPersistedTabs(label);
        }
      })
      // No answer is no list of windows, and deleting on a guess is how a session is lost.
      .catch(() => {});
  }, []);
}
