import { emitTo, listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { PersistedTab } from "@/stores/tab-persistence";
import { parsePersistedTab } from "@/stores/tab-persistence";

/**
 * The two things windows say to each other.
 *
 * **The board changed** — emitted by the backend after a Gesture commits, to every window but the
 * one that made the change. It carries no payload: it is a signal to reload, not a diff, and the
 * reload it asks for is the same one that already runs after every local edit. See
 * `src-tauri/src/board.rs`.
 *
 * **A tab arrived** — emitted by a window that is handing one of its tabs to another. This one
 * does carry a payload, because a tab is state rather than a signal; it is the same shape the tab
 * is persisted in, so a tab that moves and a tab that is restored are read by one parser.
 *
 * Both are wrapped here rather than called from a hook, so `@tauri-apps/api/event` has one door
 * the way `invoke` has one in `src/api/gesture.ts`.
 */

/** The backend's event name. Must match `BOARD_CHANGED` in `src-tauri/src/board.rs`. */
const BOARD_CHANGED = "board-changed";

/** The event a window sends when it hands a tab to another window. */
const TAB_MOVED = "tab-moved";

/** Unsubscribes nothing, for a webview with no event bus — a unit test's jsdom. */
function unsubscribed(): void {}

/**
 * Calls `onChanged` whenever another window commits a change to the board.
 *
 * Resolves to the unsubscribe. A webview with no Tauri host hears nothing and says so by resolving
 * to a no-op rather than rejecting: a view that cannot be told about other windows still works,
 * and there are no other windows to be told about.
 */
export async function onBoardChanged(onChanged: () => void): Promise<UnlistenFn> {
  return listen(BOARD_CHANGED, () => onChanged()).catch(() => unsubscribed);
}

/** Hands `tab` to the window labelled `label`. */
export async function sendTabToWindow(label: string, tab: PersistedTab): Promise<void> {
  await emitTo(label, TAB_MOVED, tab);
}

/**
 * Calls `onTab` with each tab another window hands this one.
 *
 * A payload that does not parse is dropped rather than half-adopted: a tab is only worth opening
 * if it is the tab that was sent, and the alternative is a window gaining an empty strip entry
 * that nothing can explain.
 */
export async function onTabMoved(onTab: (tab: PersistedTab) => void): Promise<UnlistenFn> {
  return listen(TAB_MOVED, (event) => {
    const tab = parsePersistedTab(event.payload);
    if (tab !== null) onTab(tab);
  }).catch(() => unsubscribed);
}
