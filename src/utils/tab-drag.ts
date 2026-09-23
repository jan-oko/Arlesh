/**
 * What a dragged tab carries, and what its drop and its end mean.
 *
 * A tab drag is an ordinary HTML drag, and the platform carries it between windows: the drag
 * session is the desktop's (on Wayland the compositor's data device, on X11 XDND), so a drag that
 * leaves one Arlesh window and enters another is delivered to the second one's webview like any
 * other drag. The receiving window reads what the tab is and where it came from off the drag
 * itself, which is why nothing here needs to know where any window is — the desktop already knows.
 *
 * Two WebKitGTK facts shape this module:
 *
 * - **A drag with no data never drops.** WebKitGTK only fires `drop` once it has received the
 *   drag's data (bugs.webkit.org 265857), and a drag that set none has nothing to receive. The
 *   payload is therefore not optional, even for a reorder inside one strip.
 * - **The payload travels under a type of Arlesh's own**, never `text/plain`. A plain-text drag
 *   would be accepted by a terminal or an editor it was released over, which would paste the
 *   payload there and — because the drop was taken — stop the tab from becoming a window.
 */

/** The drag type a tab travels under. Any drag without it is not a tab and is left alone. */
export const TAB_DRAG_TYPE = "application/x-arlesh-tab";

/** What a dragged tab carries: which tab, and which window it is leaving. */
export interface TabDragPayload {
  tabId: string;
  window: string;
}

/** The payload as the drag carries it. */
export function encodeTabDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The payload a drop carried, or `null` for one that is not a tab of ours.
 *
 * Anything else can be dropped on a window — a file, a selection from another app — and none of it
 * is a tab, so a payload that does not parse is ignored rather than guessed at.
 */
export function decodeTabDrag(raw: string): TabDragPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { tabId, window } = parsed;
  if (typeof tabId !== "string" || typeof window !== "string") return null;
  return { tabId, window };
}

/** Whether a drag in progress is a tab, judged by its types — its data is unreadable until the drop. */
export function carriesTab(types: readonly string[]): boolean {
  return types.includes(TAB_DRAG_TYPE);
}

/** What a tab dropped on a window means for that window. */
export type TabDrop =
  /** A tab of this window, dropped on this window: reorder it, or, off the strip, nothing. */
  | { kind: "own" }
  /** A tab of another window: ask that window to hand it over. */
  | { kind: "claim"; from: string; tabId: string };

/** Reads a drop, from the window that received it. */
export function tabDrop(payload: TabDragPayload, ownWindow: string): TabDrop {
  if (payload.window === ownWindow) return { kind: "own" };
  return { kind: "claim", from: payload.window, tabId: payload.tabId };
}

/**
 * Whether a drag that has ended should become a window of its own.
 *
 * Every Arlesh window accepts a dragged tab anywhere on it, so a drag that **nothing accepted** —
 * `dropEffect` `"none"` — was released over no Arlesh window: the desktop, or an app that does not
 * take our type. That is the tear-off.
 *
 * Anything else was taken: by this window (a reorder, or nothing), or by another, which asks for
 * the tab on its own through the claim. The end of the drag has nothing further to do in either
 * case. The error this leans towards is the safe one: a platform that reported a stale effect for
 * a drop outside every window would make the gesture do nothing, never conjure a window.
 */
export function tearsOff(dropEffect: string): boolean {
  return dropEffect === "none";
}
