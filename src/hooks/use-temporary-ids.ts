import { useEffect, useRef } from "react";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";

/** What a holder of id-keyed UI state does when a created node's id changes under it. */
interface TemporaryIdHandlers {
  /** A create was answered: `temporaryId` is now `realId` (ADR 0012, decision 8). Must be a no-op
   * for a holder that keeps neither. */
  onResolved?: (temporaryId: string, realId: string) => void;
  /** Creates left the board unanswered (refused, flushed or cancelled), by their temporary ids,
   * with the parent each hung under. Must be a no-op for a holder that keeps none. */
  onRemoved?: (removed: ReadonlyArray<{ id: string; parentId: string }>) => void;
}

/**
 * Keeps a piece of id-keyed UI state (the selection, the open inline editor, the collapsed nodes)
 * pointed at the right node while a created node changes id (ADR 0012, decision 8).
 *
 * The store calls back in the same tick as the lane changes, so a React batch holds the rewrite
 * and the board that names the real node together: no frame draws the selection on nothing. On
 * mount it also catches up with every alias already made, for a holder that was not mounted when
 * its create was answered (a tab switched away from meanwhile).
 */
export function useTemporaryIds(handlers: TemporaryIdHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const store = usePendingWritesStore.getState();
    for (const [temporaryId, realId] of store.aliases) latest.current.onResolved?.(temporaryId, realId);
    const offResolved = store.subscribeResolved((temporaryId, realId) => latest.current.onResolved?.(temporaryId, realId));
    const offRemoved = store.subscribeRemoved((removed) => latest.current.onRemoved?.(removed));
    return () => {
      offResolved();
      offRemoved();
    };
  }, []);
}

/**
 * The React key for a node: the id it was created under, if it was created in this window, else
 * its own. A created node changes id when the server answers, and a changed key would remount its
 * row and drop the title the user is typing into it.
 */
export function useStableKeys(): (nodeId: string) => string {
  const origins = usePendingWritesStore((s) => s.origins);
  return (nodeId) => origins.get(nodeId) ?? nodeId;
}
