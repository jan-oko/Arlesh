import type { UnlistenFn } from "@tauri-apps/api/event";
import { onBoardChanged } from "@/api/board";
import type { BoardChange } from "@/api/board";

/** How often a mounted, visible window looks at the producer's head. */
export const HEAD_CHECK_MS = 60_000;

/** How long after the last event it applied a window looks at the head, while it is quiet. */
export const IDLE_HEAD_CHECK_MS = 5_000;

/** How often a mounted, visible window works its board's digests out again from the values it holds. */
export const RECOMPUTE_MS = 600_000;

/** What the window's board does about what the watcher hears and the times it names. */
export interface BoardWatch {
  /** An event arrived (`null` for one that could not be read: the board is then loaded whole). */
  applyChange: (change: BoardChange | null) => void;
  /** Compare the board with the producer's head. */
  checkHead: () => Promise<void>;
  /** Work the digests out again from the values held, and compare them. */
  recompute: () => Promise<void>;
}

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Keeps the window's board true while a view of it is mounted, and returns the function that stops.
 *
 * Three things, none of which reloads by itself (ADR 0020): every `board-changed` event is handed
 * to the board to apply; the producer's head is checked every minute and five seconds after the
 * last event, while the window is visible; and the digests are worked out again when the window
 * becomes visible and every ten minutes. What a check finds is for the board to answer, because
 * only it knows what it holds.
 *
 * Called **once per window**, by the shared board (`src/stores/use-board-store.ts`); a view of the
 * board does not listen. There is one path for the changes whatever their source: this one hears
 * the Tauri event, and `applyChange` is all the board needs.
 */
export function watchBoardChanges(watch: BoardWatch): () => void {
  let subscribed = true;
  let unlisten: UnlistenFn | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const check = (): void => {
    if (visible()) void watch.checkHead();
  };

  const afterEvent = (): void => {
    if (idle !== null) clearTimeout(idle);
    idle = setTimeout(() => {
      idle = null;
      check();
    }, IDLE_HEAD_CHECK_MS);
  };

  void onBoardChanged((change) => {
    watch.applyChange(change);
    afterEvent();
  }).then((stop) => {
    // The window can drop the board while the subscription is still being set up, in which case
    // there is nothing to keep and the listener has to be taken straight back down.
    if (subscribed) unlisten = stop;
    else stop();
  });

  const heads = setInterval(check, HEAD_CHECK_MS);
  const recomputes = setInterval(() => {
    if (visible()) void watch.recompute();
  }, RECOMPUTE_MS);
  const onVisibility = (): void => {
    if (!visible()) return;
    void watch.recompute();
    check();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  return () => {
    subscribed = false;
    unlisten?.();
    if (idle !== null) clearTimeout(idle);
    clearInterval(heads);
    clearInterval(recomputes);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}
