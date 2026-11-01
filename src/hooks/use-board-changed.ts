import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onBoardChanged } from "@/api/board";
import type { BoardRevision } from "@/api/board";
import { isNews, latestOf, useBoardRevisionStore } from "@/stores/board-revision-store";

/**
 * How long an announced change waits before the window decides whether it is news.
 *
 * In Client mode the server announces a device's own write to that device too, and the
 * announcement can beat the write's response back across the Tauri bridge. The reload that follows
 * the write has not started yet, so the window holds the old revision and the echo looks like
 * news. A short wait lets the write's own reload start; the echo is then judged when that load
 * ends, and is not news. Another device's change pays this wait as latency, which it can afford.
 */
export const SETTLE_MS = 150;

/**
 * Reloads the board whenever the board changed somewhere else.
 *
 * This is the whole of cross-window consistency on the frontend, and it is deliberately one line
 * of behaviour: an edit made anywhere ends in the **same reload** that already runs after a local
 * edit. Inventing a second refresh path would mean two ways of getting the board onto the screen,
 * which is two things to keep agreeing. The Mindmap loads in a single request, so the reload is
 * cheap enough to make unconditionally on a desktop.
 *
 * In Standalone the window that made the change is not told — it reloaded on the way back from
 * its own command — so this never fires for your own edits. In Client mode it does: the server
 * announces every committed write to every device, the writer's own included. Those events carry
 * the revision the board reached, and an event for a revision the window already holds is skipped
 * rather than reloaded for (`src/stores/board-revision-store.ts`). An event that carries none, or
 * from a server that has restarted since the board was loaded, always reloads.
 *
 * `reload` is held in a ref rather than named as a dependency: it is rebuilt whenever the data hook
 * rebuilds it, and resubscribing on each of those would tear the listener down and put it back up
 * in a gap an event could fall through.
 */
export function useBoardChanged(reload: () => Promise<void>): void {
  const latest = useRef(reload);

  useEffect(() => {
    latest.current = reload;
  }, [reload]);

  useEffect(() => {
    let subscribed = true;
    let unlisten: UnlistenFn | null = null;
    // The newest change heard and not yet acted on, and the timer or the wait that will judge it.
    let target: BoardRevision | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopWaiting: (() => void) | null = null;

    const settle = (): void => {
      timer = null;
      if (target === null) return;
      const { held, inFlight } = useBoardRevisionStore.getState();
      if (!isNews(held, target)) {
        target = null;
        return;
      }
      if (inFlight > 0) {
        // A load is under way: it may be the one that brings the change. Judge it when it ends.
        stopWaiting ??= useBoardRevisionStore.subscribe((state) => {
          if (state.inFlight > 0) return;
          stopWaiting?.();
          stopWaiting = null;
          settle();
        });
        return;
      }
      target = null;
      void latest.current();
    };

    void onBoardChanged((change) => {
      if (change === null) {
        // No revision to compare (Standalone, or an older server): reload, as ever.
        void latest.current();
        return;
      }
      if (!isNews(useBoardRevisionStore.getState().held, change)) return;
      target = latestOf(target, change);
      timer ??= setTimeout(settle, SETTLE_MS);
    }).then((stop) => {
      // The view can unmount while the subscription is still being set up, in which case there is
      // nothing to keep and the listener has to be taken straight back down.
      if (subscribed) unlisten = stop;
      else stop();
    });

    return () => {
      subscribed = false;
      unlisten?.();
      if (timer !== null) clearTimeout(timer);
      stopWaiting?.();
    };
  }, []);
}
