import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "./gesture";

/**
 * The commands that act on windows: closing this one, opening another, listing them, focusing one.
 *
 * What a window *is*, as far as the frontend is concerned, is a **label**: it identifies the window
 * to the backend and it is the key that window's tab strip is stored under, which is what keeps two
 * windows' tabs apart in one shared `localStorage`. Reading and minting labels is
 * `@/api/window-label`, which is a separate module because the tab store needs it and must not
 * reach Tauri to get it.
 *
 * The backend owns the list of windows and their geometry, because it is the only layer that can
 * tell a window that was really closed from one that was hidden to the tray or taken down by a
 * quit. See `src-tauri/src/windows.rs`.
 */

/**
 * Closes the window this app is running in.
 *
 * Reached by closing the last tab, and by handing the last tab to another window: a window with no
 * tabs is not a state the app has, so the gesture that would produce one closes the window instead
 * — the browser behaviour the tab shortcuts are copied from. What *that* close means is the
 * backend's decision, and only for the last window: with others still open it simply closes, and
 * with none left it is governed by the close-to-tray setting.
 */
export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

/**
 * Opens a new window under `label`, beside the one that asked for it.
 *
 * The label is minted by the caller rather than by the backend because the new window's tab strip
 * is written to storage under it **before** this call — so the window finds its own tabs on boot
 * and no tab ever travels through an event that could arrive before the window listening for it
 * does.
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

/**
 * Which window the pointer is over, for a tab that has just been dropped.
 *
 * `null` means no window — the desktop, which is the tear-off. It **throws** when the platform
 * would not give up the cursor position, which is a different thing and must not be read as the
 * desktop: see `utils/tab-drag`.
 */
export async function windowAtCursor(): Promise<string | null> {
  return invoke<string | null>("window_at_cursor");
}

/**
 * Tells the backend what this window's active tab is called, for the title and the tray menu.
 *
 * Only the tab name crosses: the window's **number** is fixed for its life and is the backend's,
 * so the two are composed on that side. A frontend that built the whole title would need to be
 * told the number, and then two places would know how a window is named.
 */
export async function setWindowTitle(tab: string): Promise<void> {
  await invoke<null>("set_window_title", { tab });
}
