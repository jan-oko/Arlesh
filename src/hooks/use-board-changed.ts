import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onBoardChanged } from "@/api/board";

/**
 * Reloads the board whenever another window changes it.
 *
 * This is the whole of cross-window consistency on the frontend, and it is deliberately one line
 * of behaviour: an edit made anywhere ends in the **same reload** that already runs after a local
 * edit. Inventing a second refresh path would mean two ways of getting the board onto the screen,
 * which is two things to keep agreeing. The Mindmap loads in a single request, so the reload is
 * cheap enough to make unconditionally.
 *
 * The window that made the change is not told — it reloaded on the way back from its own command
 * — so this never fires for your own edits and never doubles a read.
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

    void onBoardChanged(() => {
      void latest.current();
    }).then((stop) => {
      // The view can unmount while the subscription is still being set up, in which case there is
      // nothing to keep and the listener has to be taken straight back down.
      if (subscribed) unlisten = stop;
      else stop();
    });

    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, []);
}
