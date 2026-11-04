import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { BoardRevision } from "@/api/board";

/**
 * Which revision of the server's board one view holds (Client mode; Standalone never sets one).
 *
 * It is one per window, because the window holds one copy of the board (`use-board-store.ts`); the
 * views over it derive their trees from that copy and keep no revision of their own. (When each
 * view loaded its own copy, a revision shared between them made the first view to reload leave
 * the rest judging the same event "already held", stale until a write of their own.)
 *
 * The server counts every committed write and stamps `/board` and each `board-changed` event with
 * the count and with the epoch, the run of the server it counts in. A window that holds revision
 * `r` already shows every change up to `r`, so an event for `r` or less is not news, and the
 * reload it would ask for is a 750 KB fetch for nothing. That is what a device's own write used
 * to cost it twice: once for the reload after the write, once for the server's echo of it.
 *
 * - `held` is the revision of the board the window last loaded, `null` before the first load and
 *   always in Standalone.
 * - `inFlight` counts loads that have started and not finished. A load that started before an
 *   event may or may not contain what the event announces, so the event is judged when it ends.
 *
 * A write's own response is deliberately not recorded here. It does not carry the board, only the
 * node it wrote, and the board derives more than that (rollups, what blocks what, inherited
 * Plans), so the reload after a write stays; it is the echo that is skipped.
 */
export interface BoardRevisionStore {
  held: BoardRevision | null;
  inFlight: number;
  /** A load of the board has begun. */
  loadStarted: () => void;
  /** A load finished having read the board at `revision` (`null` when the backend states none). */
  loadFinished: (revision: BoardRevision | null) => void;
  /** A load ended without a board. */
  loadFailed: () => void;
}

export type BoardRevisionTracker = StoreApi<BoardRevisionStore>;

/** A fresh tracker for a window's copy of the board. */
export function createBoardRevisionTracker(): BoardRevisionTracker {
  return createStore<BoardRevisionStore>()((set) => ({
    held: null,
    inFlight: 0,
    loadStarted: () => set((state) => ({ inFlight: state.inFlight + 1 })),
    loadFinished: (revision) =>
      set((state) => ({
        inFlight: Math.max(0, state.inFlight - 1),
        held: newerOf(state.held, revision),
      })),
    loadFailed: () => set((state) => ({ inFlight: Math.max(0, state.inFlight - 1) })),
  }));
}

/**
 * The revision a window holds once a load read at `loaded` finishes. Loads can end out of order,
 * and an older one finishing last must not make the window forget what it has seen. A new epoch
 * replaces the old whatever its number.
 */
function newerOf(held: BoardRevision | null, loaded: BoardRevision | null): BoardRevision | null {
  if (loaded === null) return null;
  if (held === null || held.epoch !== loaded.epoch) return loaded;
  return held.revision > loaded.revision ? held : loaded;
}

/**
 * Whether an event stamped `change` tells a window holding `held` something it does not know.
 * Yes when either is unknown, when the server has restarted (another epoch: its numbers start
 * again, so no comparison means anything), and when the event is past what the window holds.
 */
export function isNews(held: BoardRevision | null, change: BoardRevision | null): boolean {
  if (held === null || change === null) return true;
  if (held.epoch !== change.epoch) return true;
  return change.revision > held.revision;
}

/** The newer of two events' stamps, for a window that has heard several before it acts. */
export function latestOf(a: BoardRevision | null, b: BoardRevision): BoardRevision {
  if (a === null || a.epoch !== b.epoch) return b;
  return a.revision >= b.revision ? a : b;
}
