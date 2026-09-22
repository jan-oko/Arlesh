import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "./gesture";

/**
 * The window this webview is running in, and the other windows beside it.
 *
 * Every Arlesh window is the same thing — a tab strip with one or more tabs — so nothing here is
 * about "the main one". What a window *is*, as far as the frontend is concerned, is a **label**:
 * it identifies the window to the backend and it is the key that window's tab strip is stored
 * under, which is what keeps two windows' tabs apart in one shared `localStorage`.
 *
 * The backend owns the list of windows and their geometry, because it is the only layer that can
 * tell a window that was really closed from one that was hidden to the tray or taken down by a
 * quit. See `src-tauri/src/windows.rs`.
 */

/** The label of the window Arlesh opens on a first run. */
export const BOOTSTRAP_WINDOW_LABEL = "main";

/**
 * This webview's window label.
 *
 * Falls back to the bootstrap label when there is no Tauri host to ask — a unit test's jsdom — so
 * that a stored strip written by the one window a test has is read back by it. Under test there is
 * exactly one window and it is the first, which is what the fallback says.
 */
export function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return BOOTSTRAP_WINDOW_LABEL;
  }
}

/**
 * Closes the window this app is running in.
 *
 * Reached by closing the last tab, and by the tab menu's tear-off leaving a window empty: a window
 * with no tabs is not a state the app has, so the gesture that would produce one closes the window
 * instead — the browser behaviour the tab shortcuts are copied from. What *that* close means is
 * the backend's decision, and only for the last window: with others still open it simply closes,
 * and with none left it is governed by the close-to-tray setting.
 */
export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

/**
 * A label for a window that does not exist yet.
 *
 * Minted here because the new window's tabs are written to storage under it before the window is
 * asked for — see {@link openBoardWindow}. The prefix is for a reader of the stored keys and of a
 * log line; nothing parses it.
 */
export function newWindowLabel(): string {
  return `board-${crypto.randomUUID()}`;
}

/**
 * Opens a new window under `label`, beside the one that asked for it.
 *
 * The label is minted here rather than by the backend because the new window's tab strip is
 * written to storage under it **before** this call — so the window finds its own tabs on boot and
 * no tab ever travels through an event that could arrive before the window listening for it does.
 */
export async function openBoardWindow(label: string): Promise<void> {
  await invoke<null>("open_board_window", { label });
}

/** The labels of every open window, oldest first — this one among them. */
export async function boardWindowLabels(): Promise<string[]> {
  return invoke<string[]>("board_windows");
}

/** Brings another window to the front, for a tab that has just been moved into it. */
export async function focusBoardWindow(label: string): Promise<void> {
  await invoke<null>("focus_board_window", { label });
}
