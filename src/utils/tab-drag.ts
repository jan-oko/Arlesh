/**
 * What a drag that started on a tab meant, once it has ended.
 *
 * Inside the strip a drag is a reorder, and the strip's own drop handler has already dealt with it.
 * Outside it, **where the pointer was let go decides**: over another window the tab moves into that
 * window, over the desktop it becomes a window of its own. Drag-out and drag-in are then one
 * gesture rather than two, which is the version worth having.
 *
 * An HTML drag cannot answer this by itself. HTML5 drag-and-drop is per-webview: the target
 * window's webview never sees a dragover from a drag that began in another, so there is no drop
 * event to listen for. The target is resolved by **geometry** instead — the backend knows where
 * every window is, and answers which one the pointer was over. This module holds what to do with
 * that answer.
 */

/** What the end of a tab drag turned out to mean. */
export type TabDrop =
  /** The strip took the drop: a reorder, already done. */
  | { kind: "reorder" }
  /** Released over another window: hand the tab to it. */
  | { kind: "move"; label: string }
  /** Released over no window: the tab becomes a window of its own. */
  | { kind: "tearOff" }
  /** Released over the window it came from, or nowhere we can act on: do nothing. */
  | { kind: "nothing" };

/** What the backend said the pointer was over, or `null` for "no window", or `undefined` for "could not tell". */
export type DropTarget = string | null | undefined;

/**
 * Reads the end of a drag.
 *
 * Four answers, and the two that do nothing are not the same thing. A drop **on the strip** is a
 * reorder that has already happened. A drop on **this window** — its board, its strip's empty
 * space, its title bar — is a drag that went nowhere, and a window cannot move a tab to itself.
 *
 * A target the platform **could not tell us** also does nothing, and that is the deliberate choice
 * rather than the lazy one: the alternative is reading an unknown position as "the desktop" and
 * tearing off a window the user never asked for. A gesture that has to be repeated costs a
 * keystroke; a window that appears from nowhere costs finding and closing it.
 */
export function tabDrop(target: DropTarget, ownWindow: string, droppedOnStrip: boolean): TabDrop {
  if (droppedOnStrip) return { kind: "reorder" };
  if (target === undefined) return { kind: "nothing" };
  if (target === null) return { kind: "tearOff" };
  if (target === ownWindow) return { kind: "nothing" };
  return { kind: "move", label: target };
}
